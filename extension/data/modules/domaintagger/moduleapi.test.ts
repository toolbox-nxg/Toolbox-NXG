/**
 * Tests for domain-tag persistence now that per-tag edits are conflict-safe. The
 * versioned wiki transport is faked in-memory (with `previous`-based conflict
 * semantics) so the real `mutateWikiPage` loop runs: two mods tagging different
 * domains concurrently must both survive, and a newer-schema page must be refused.
 */

// @vitest-environment node
import {beforeEach, describe, expect, it, vi,} from 'vitest'

const readWikiPageVersioned = vi.hoisted(() => vi.fn())
const writeWikiPageConditional = vi.hoisted(() => vi.fn())
vi.mock('../../api/resources/wikiVersioned', () => ({readWikiPageVersioned, writeWikiPageConditional,}),)

const positiveTextFeedback = vi.hoisted(() => vi.fn())
const negativeTextFeedback = vi.hoisted(() => vi.fn())
const neutralTextFeedback = vi.hoisted(() => vi.fn())
vi.mock('../../store/feedback', () => ({positiveTextFeedback, negativeTextFeedback, neutralTextFeedback,}),)

vi.mock('../../util/persistence/cache', () => ({clearCache: vi.fn(async () => {},),}),)
// DOMPurify needs a DOM; these tests only feed it trusted fixtures.
vi.mock('../../util/data/purify', () => ({purifyObject: vi.fn(),}),)

// The real wiki resource, mod-subs lookup, and wiki migration all load the
// browser-only HTTP transport at module init; stub them out.
const readFromWiki = vi.hoisted(() => vi.fn())
const getWikiRevisions = vi.hoisted(() => vi.fn())
vi.mock('../../api/resources/wiki', () => ({readFromWiki, getWikiRevisions,}),)
const isModSub = vi.hoisted(() => vi.fn())
vi.mock('../../api/resources/modSubs', () => ({isModSub,}),)
const recoverLegacyDomainTags = vi.hoisted(() => vi.fn())
const refreshClassicConfigInlineFields = vi.hoisted(() => vi.fn().mockResolvedValue({ok: true,},))
const unsyncedClassicEditsWarning = vi.hoisted(() => vi.fn().mockResolvedValue(undefined,))
vi.mock('../config/moduleapi', () => ({refreshClassicConfigInlineFields, unsyncedClassicEditsWarning,}),)
vi.mock('../../util/wiki/wikiMigration', () => ({recoverLegacyDomainTags,}),)

import {domainTagsCodec,} from '../../util/wiki/schemas/domaintags/codec'
import type {DomainTag, DomainTagsData,} from '../../util/wiki/schemas/domaintags/schema'
import {
	getDomainTagsData,
	incrementDomainStat,
	invalidateDomainTagsCache,
	saveDomainTag,
	saveDomainTagsData,
} from './moduleapi'

const clone = <T,>(v: T,): T => JSON.parse(JSON.stringify(v,),) as T

/** In-memory domain tags page with `previous`-based conflict semantics. */
function fakeWiki () {
	let data: DomainTagsData = {ver: 1, showCounts: false, tags: [],}
	let rev: string | undefined
	let n = 0
	let beforeNextWrite: (() => void) | null = null

	readWikiPageVersioned.mockImplementation(async () => ({data: clone(data,), rev,}))
	writeWikiPageConditional.mockImplementation(
		async (_s: string, _p: string, next: DomainTagsData, _r: string, prev: string | undefined,) => {
			if (beforeNextWrite) {
				const fn = beforeNextWrite
				beforeNextWrite = null
				fn()
			}
			if (prev !== rev) { return {ok: false, conflict: true, data: clone(data,), rev: rev!,} }
			data = clone(next,)
			rev = `rev${++n}`
			return {ok: true,}
		},
	)
	return {
		get: () => data,
		seed (tags: DomainTag[],) {
			data = {ver: 1, showCounts: false, tags: clone(tags,),}
			rev = `rev${++n}`
		},
		makeUnparseable () {
			readWikiPageVersioned.mockResolvedValue({
				data: {ver: 1, showCounts: false, tags: [],},
				rev: 'rX',
				unparseable: {reason: 'newer schema',},
			},)
		},
		injectConcurrentWrite (fn: (current: DomainTagsData,) => void,) {
			beforeNextWrite = () => {
				fn(data,)
				rev = `rev${++n}`
			}
		},
	}
}

const tag = (name: string, color = '#cee3f8',): DomainTag => ({name, color, approvalCount: 0, removalCount: 0,})

beforeEach(() => {
	vi.clearAllMocks()
	invalidateDomainTagsCache()
},)

describe('saveDomainTag', () => {
	it('adds a new tag', async () => {
		const wiki = fakeWiki()
		await saveDomainTag('sub', tag('example.com',),)
		expect(wiki.get().tags.map((t,) => t.name),).toEqual(['example.com',],)
		expect(positiveTextFeedback,).toHaveBeenCalled()
		// 6.x reads tags off the classic config page, so it is rewritten too.
		expect(refreshClassicConfigInlineFields,).toHaveBeenCalledWith('sub', 'save tag "example.com"',)
	})

	it('shows the 6.x overwrite warning, checked before the write', async () => {
		fakeWiki()
		unsyncedClassicEditsWarning.mockResolvedValueOnce('overwrote 6.x changes',)
		await saveDomainTag('sub', tag('example.com',),)
		expect(unsyncedClassicEditsWarning.mock.invocationCallOrder[0],).toBeLessThan(
			writeWikiPageConditional.mock.invocationCallOrder[0]!,
		)
		expect(negativeTextFeedback,).toHaveBeenCalledWith('overwrote 6.x changes', {duration: 10_000,},)
		expect(positiveTextFeedback,).not.toHaveBeenCalled()
	})

	it('warns when the classic config page could not be rewritten', async () => {
		fakeWiki()
		refreshClassicConfigInlineFields.mockResolvedValueOnce({ok: false, message: 'no wiki permission',},)
		await saveDomainTag('sub', tag('example.com',),)
		expect(negativeTextFeedback.mock.calls[0]![0],).toContain('no wiki permission',)
	})

	it('keeps a concurrently-added different tag when a write conflicts', async () => {
		const wiki = fakeWiki()
		wiki.injectConcurrentWrite((current,) => current.tags.push(tag('other.com',),))
		await saveDomainTag('sub', tag('mine.com',),)
		expect(wiki.get().tags.map((t,) => t.name).sort(),).toEqual(['mine.com', 'other.com',],)
	})

	it('preserves counts when updating an existing tag', async () => {
		const wiki = fakeWiki()
		wiki.seed([{name: 'example.com', color: '#fff', approvalCount: 5, removalCount: 3,},],)
		await saveDomainTag('sub', {name: 'example.com', color: '#000', approvalCount: 0, removalCount: 0,},)
		const stored = wiki.get().tags[0]!
		expect(stored,).toMatchObject({color: '#000', approvalCount: 5, removalCount: 3,},)
	})

	it('no-ops (no write) when deleting a tag that does not exist', async () => {
		fakeWiki()
		await saveDomainTag('sub', {name: 'ghost.com', color: 'none', approvalCount: 0, removalCount: 0,},)
		expect(writeWikiPageConditional,).not.toHaveBeenCalled()
		expect(positiveTextFeedback,).not.toHaveBeenCalled()
	})

	it('refuses to overwrite a newer-schema page and surfaces an error', async () => {
		const wiki = fakeWiki()
		wiki.makeUnparseable()
		await saveDomainTag('sub', tag('example.com',),)
		expect(writeWikiPageConditional,).not.toHaveBeenCalled()
		expect(negativeTextFeedback,).toHaveBeenCalled()
	})
})

describe('incrementDomainStat', () => {
	it('bumps the counter without rewriting the classic config page', async () => {
		const wiki = fakeWiki()
		wiki.seed([tag('example.com',),],)
		readFromWiki.mockResolvedValue({ok: true, data: clone(wiki.get(),),},)

		await incrementDomainStat('sub', 'example.com', 'approve',)

		expect(wiki.get().tags[0]!.approvalCount,).toBe(1,)
		// Counts are not on the classic page; rewriting it on every approve/remove would be pure churn.
		expect(refreshClassicConfigInlineFields,).not.toHaveBeenCalled()
		expect(unsyncedClassicEditsWarning,).not.toHaveBeenCalled()
	})
})

describe('saveDomainTagsData (bulk replace)', () => {
	it('replaces the entire tag set', async () => {
		const wiki = fakeWiki()
		wiki.seed([tag('old.com',),],)
		await saveDomainTagsData('sub', {ver: 1, showCounts: true, tags: [tag('new.com',),],}, 'bulk edit',)
		expect(wiki.get(),).toMatchObject({showCounts: true, tags: [{name: 'new.com',},],},)
	})
})

describe('getDomainTagsData legacy repair', () => {
	/** Serves `page` as the current domain tags page to the plain (unversioned) read. */
	function mockPage (page: DomainTagsData | null,) {
		readFromWiki.mockResolvedValue(page ? {ok: true, data: clone(page,),} : {ok: false, reason: 'no_page',},)
	}

	it('restores lost tags into an untouched empty stub, quietly', async () => {
		const wiki = fakeWiki()
		mockPage(wiki.get(),)
		isModSub.mockResolvedValue(true,)
		getWikiRevisions.mockResolvedValue([{id: 'r1',},],)
		recoverLegacyDomainTags.mockResolvedValue([{name: 'example.com', color: 'red', note: 'n',},],)

		await getDomainTagsData('sub',)

		await vi.waitFor(() => expect(writeWikiPageConditional,).toHaveBeenCalled())
		expect(wiki.get(),).toMatchObject({
			tags: [{name: 'example.com', color: 'red', note: 'n', approvalCount: 0, removalCount: 0,},],
			repairs: ['legacyDomainTags',],
		},)
		expect(positiveTextFeedback,).not.toHaveBeenCalled()
		expect(neutralTextFeedback,).not.toHaveBeenCalled()
		await vi.waitFor(() => expect(refreshClassicConfigInlineFields,).toHaveBeenCalled())
	})

	it('only marks a page edited since creation - it may have been emptied on purpose', async () => {
		const wiki = fakeWiki()
		mockPage(wiki.get(),)
		isModSub.mockResolvedValue(true,)
		getWikiRevisions.mockResolvedValue([{id: 'r2',}, {id: 'r1',},],)

		await getDomainTagsData('sub',)

		await vi.waitFor(() => expect(writeWikiPageConditional,).toHaveBeenCalled())
		expect(recoverLegacyDomainTags,).not.toHaveBeenCalled()
		expect(wiki.get(),).toMatchObject({tags: [], repairs: ['legacyDomainTags',],},)
	})

	it('skips the repair once marked, and for non-moderators', async () => {
		mockPage({ver: 1, showCounts: false, tags: [], repairs: ['legacyDomainTags',],},)
		await getDomainTagsData('marked',)

		mockPage({ver: 1, showCounts: false, tags: [],},)
		isModSub.mockResolvedValue(false,)
		await getDomainTagsData('foreign',)
		await new Promise((resolve,) => setTimeout(resolve, 0,))

		expect(getWikiRevisions,).not.toHaveBeenCalled()
		expect(writeWikiPageConditional,).not.toHaveBeenCalled()
	})

	it('seeds a newly created page from the legacy history and marks it', async () => {
		const wiki = fakeWiki()
		mockPage(null,)
		isModSub.mockResolvedValue(true,)
		recoverLegacyDomainTags.mockResolvedValue([{name: 'example.com', color: 'red',},],)

		const data = await getDomainTagsData('sub',)

		expect(data.tags.map((t,) => t.name),).toEqual(['example.com',],)
		expect(wiki.get(),).toMatchObject({tags: [{name: 'example.com',},], repairs: ['legacyDomainTags',],},)
		// Seeded from the classic page, so there is nothing to write back to it.
		expect(refreshClassicConfigInlineFields,).not.toHaveBeenCalled()
	})
})

describe('domainTagsCodec', () => {
	it('refuses invalid JSON', () => {
		expect(domainTagsCodec.parse('nope',).ok,).toBe(false,)
	})

	it('refuses an out-of-range schema version', () => {
		expect(domainTagsCodec.parse('{"ver":999,"tags":[]}',).ok,).toBe(false,)
	})

	it('accepts and normalizes a valid page', () => {
		const parsed = domainTagsCodec.parse('{"ver":1,"showCounts":true,"tags":[]}',)
		expect(parsed.ok,).toBe(true,)
	})
})
