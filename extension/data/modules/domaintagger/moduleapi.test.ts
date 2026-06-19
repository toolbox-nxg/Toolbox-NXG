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

// getDomainTagsData (unused by these tests) imports the real wiki resource and the
// mod-subs lookup, both of which load the browser-only HTTP transport at module
// init; stub them out.
vi.mock('../../api/resources/wiki', () => ({readFromWiki: vi.fn(),}),)
vi.mock('../../api/resources/modSubs', () => ({isModSub: vi.fn(),}),)

import {domainTagsCodec,} from '../../util/wiki/schemas/domaintags/codec'
import type {DomainTag, DomainTagsData,} from '../../util/wiki/schemas/domaintags/schema'
import {saveDomainTag, saveDomainTagsData,} from './moduleapi'

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
},)

describe('saveDomainTag', () => {
	it('adds a new tag', async () => {
		const wiki = fakeWiki()
		await saveDomainTag('sub', tag('example.com',),)
		expect(wiki.get().tags.map((t,) => t.name),).toEqual(['example.com',],)
		expect(positiveTextFeedback,).toHaveBeenCalled()
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

describe('saveDomainTagsData (bulk replace)', () => {
	it('replaces the entire tag set', async () => {
		const wiki = fakeWiki()
		wiki.seed([tag('old.com',),],)
		await saveDomainTagsData('sub', {ver: 1, showCounts: true, tags: [tag('new.com',),],}, 'bulk edit',)
		expect(wiki.get(),).toMatchObject({showCounts: true, tags: [{name: 'new.com',},],},)
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
