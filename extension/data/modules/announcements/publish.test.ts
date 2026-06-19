/**
 * Tests for the announcements read-modify-write data access. The versioned wiki
 * transport is faked in-memory (with `previous`-based conflict semantics) so the real
 * `mutateWikiPage` loop runs, and the codec's schema-refusal guarantee — never
 * overwrite a page we cannot interpret — is exercised end to end.
 */

// @vitest-environment node
import {beforeEach, describe, expect, it, vi,} from 'vitest'

const readWikiPageVersioned = vi.hoisted(() => vi.fn())
const writeWikiPageConditional = vi.hoisted(() => vi.fn())
vi.mock('../../api/resources/wikiVersioned', () => ({readWikiPageVersioned, writeWikiPageConditional,}),)

import {nowInSeconds,} from '../../util/data/time'
import {announcementsCodec, INVALID_JSON_REASON, UNEXPECTED_FORMAT_REASON,} from './codec'
import {getAnnouncements, publishAnnouncement, removeAnnouncement, updateAnnouncement,} from './publish'
import type {AnnouncementNote, AnnouncementsWikiData,} from './types'

const clone = <T,>(v: T,): T => JSON.parse(JSON.stringify(v,),) as T

/** In-memory announcements page with `previous`-based conflict semantics. */
function fakeWiki () {
	let data: AnnouncementsWikiData = {version: 1, notes: [],}
	let rev: string | undefined
	let n = 0
	let beforeNextWrite: (() => void) | null = null

	readWikiPageVersioned.mockImplementation(async () => ({data: clone(data,), rev,}))
	writeWikiPageConditional.mockImplementation(
		async (_s: string, _p: string, next: AnnouncementsWikiData, _r: string, prev: string | undefined,) => {
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
		seed (notes: AnnouncementNote[],) {
			data = {version: 1, notes: clone(notes,),}
			rev = `rev${++n}`
		},
		/** Make the read return content the codec refuses (a future schema version). */
		makeUnparseable () {
			readWikiPageVersioned.mockResolvedValue({
				data: {version: 1, notes: [],},
				rev: 'rX',
				unparseable: {reason: UNEXPECTED_FORMAT_REASON,},
			},)
		},
		injectConcurrentWrite (fn: (current: AnnouncementsWikiData,) => void,) {
			beforeNextWrite = () => {
				fn(data,)
				rev = `rev${++n}`
			}
		},
	}
}

const note = (overrides: Partial<AnnouncementNote> = {},): Omit<AnnouncementNote, 'id'> => ({
	title: 'Hello',
	body: 'World',
	...overrides,
})

beforeEach(() => {
	vi.clearAllMocks()
},)

describe('publishAnnouncement', () => {
	it('appends a note with a generated id and defaulted publishAt', async () => {
		const wiki = fakeWiki()
		const result = await publishAnnouncement(note(),)
		expect(result.ok,).toBe(true,)
		expect(wiki.get().notes,).toHaveLength(1,)
		const stored = wiki.get().notes[0]!
		expect(stored.id,).toBeTruthy()
		expect(stored.publishAt,).toBeTypeOf('number',)
	})

	it('keeps a concurrently-published note when a write conflicts', async () => {
		const wiki = fakeWiki()
		wiki.injectConcurrentWrite((current,) => {
			current.notes.unshift({id: 'other', title: 'O', body: 'B', publishAt: 1,},)
		},)
		const result = await publishAnnouncement(note({title: 'Mine',},),)
		expect(result.ok,).toBe(true,)
		const titles = wiki.get().notes.map((x,) => x.title).sort()
		expect(titles,).toEqual(['Mine', 'O',],)
	})

	it('refuses to overwrite a page it cannot interpret', async () => {
		const wiki = fakeWiki()
		wiki.makeUnparseable()
		const result = await publishAnnouncement(note(),)
		expect(result,).toEqual({ok: false, reason: UNEXPECTED_FORMAT_REASON,},)
		expect(writeWikiPageConditional,).not.toHaveBeenCalled()
	})
})

describe('updateAnnouncement', () => {
	it('edits a still-scheduled note', async () => {
		const future = nowInSeconds() + 10_000
		const wiki = fakeWiki()
		wiki.seed([{id: 'a', title: 'Old', body: 'B', publishAt: future,},],)
		const result = await updateAnnouncement('a', note({title: 'New', publishAt: future,},),)
		expect(result.ok,).toBe(true,)
		expect(wiki.get().notes[0]!.title,).toBe('New',)
	})

	it('refuses to edit a note that has gone live (no write)', async () => {
		const past = nowInSeconds() - 10
		const wiki = fakeWiki()
		wiki.seed([{id: 'a', title: 'Live', body: 'B', publishAt: past,},],)
		const result = await updateAnnouncement('a', note(),)
		expect(result,).toEqual({ok: false, reason: expect.stringContaining('already gone live',),},)
		expect(writeWikiPageConditional,).not.toHaveBeenCalled()
	})

	it('reports when the target note no longer exists (no write)', async () => {
		fakeWiki()
		const result = await updateAnnouncement('missing', note(),)
		expect(result,).toEqual({ok: false, reason: 'This announcement no longer exists.',},)
		expect(writeWikiPageConditional,).not.toHaveBeenCalled()
	})
})

describe('removeAnnouncement', () => {
	it('removes an existing note', async () => {
		const wiki = fakeWiki()
		wiki.seed([{id: 'a', title: 'A', body: 'B', publishAt: 1,}, {id: 'b', title: 'B', body: 'B', publishAt: 1,},],)
		const result = await removeAnnouncement('a',)
		expect(result.ok,).toBe(true,)
		expect(wiki.get().notes.map((x,) => x.id),).toEqual(['b',],)
	})

	it('treats an already-absent note as success without writing', async () => {
		fakeWiki()
		const result = await removeAnnouncement('missing',)
		expect(result,).toEqual({ok: true,},)
		expect(writeWikiPageConditional,).not.toHaveBeenCalled()
	})
})

describe('getAnnouncements', () => {
	it('returns the stored notes', async () => {
		const wiki = fakeWiki()
		wiki.seed([{id: 'a', title: 'A', body: 'B', publishAt: 1,},],)
		const result = await getAnnouncements()
		expect(result,).toEqual({ok: true, notes: [{id: 'a', title: 'A', body: 'B', publishAt: 1,},],},)
	})

	it('surfaces an unparseable page as a typed failure', async () => {
		const wiki = fakeWiki()
		wiki.makeUnparseable()
		const result = await getAnnouncements()
		expect(result,).toEqual({ok: false, reason: UNEXPECTED_FORMAT_REASON,},)
	})
})

describe('announcementsCodec', () => {
	it('refuses invalid JSON', () => {
		expect(announcementsCodec.parse('not json',),).toEqual({ok: false, reason: INVALID_JSON_REASON,},)
	})

	it('refuses an unexpected schema (newer version)', () => {
		expect(announcementsCodec.parse('{"version":2,"notes":[]}',),)
			.toEqual({ok: false, reason: UNEXPECTED_FORMAT_REASON,},)
	})

	it('accepts a well-formed doc', () => {
		const parsed = announcementsCodec.parse('{"version":1,"notes":[]}',)
		expect(parsed,).toEqual({ok: true, data: {version: 1, notes: [],},},)
	})
})
