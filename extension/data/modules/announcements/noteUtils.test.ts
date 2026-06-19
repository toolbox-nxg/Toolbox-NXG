/** Tests for the announcement id generation and note-append helpers. */

// @vitest-environment node
import {describe, expect, it,} from 'vitest'

import {appendNote, filterByPublishAt, formatDateStamp, generateAnnouncementId, isHttpUrl,} from './noteUtils'
import type {AnnouncementNote, AnnouncementsWikiData,} from './types'

/** Builds a minimal note with the given id for list-shape tests. */
const noteWithId = (id: string,): AnnouncementNote => ({id, title: 't', body: 'b',})

describe('formatDateStamp', () => {
	it('zero-pads month and day', () => {
		expect(formatDateStamp(new Date(2026, 0, 5,),),).toBe('2026-01-05',)
		expect(formatDateStamp(new Date(2026, 11, 31,),),).toBe('2026-12-31',)
	})
})

describe('generateAnnouncementId', () => {
	const today = new Date(2026, 5, 13,) // 2026-06-13

	it('starts at 1 for an empty list', () => {
		expect(generateAnnouncementId([], today,),).toBe('2026-06-13-1',)
	})

	it('increments past notes already stamped with today', () => {
		const notes = [noteWithId('2026-06-13-1',), noteWithId('2026-06-13-2',),]
		expect(generateAnnouncementId(notes, today,),).toBe('2026-06-13-3',)
	})

	it('ignores notes from other dates when counting', () => {
		const notes = [
			noteWithId('2026-06-12-1',),
			noteWithId('2026-06-13-1',),
			noteWithId('2025-06-13-9',),
		]
		expect(generateAnnouncementId(notes, today,),).toBe('2026-06-13-2',)
	})

	it('does not reuse a freed index after a removal (avoids duplicate ids)', () => {
		// Published -1 and -2, then -1 was removed; the next id must be -3, not -2 (which
		// a count-based scheme would hand out, colliding with the surviving -2).
		const notes = [noteWithId('2026-06-13-2',),]
		expect(generateAnnouncementId(notes, today,),).toBe('2026-06-13-3',)
	})
})

describe('appendNote', () => {
	const base: AnnouncementsWikiData = {version: 1, notes: [noteWithId('2026-06-12-1',),],}

	it('prepends the new note (newest first) and preserves version', () => {
		const result = appendNote(base, noteWithId('2026-06-13-1',),)
		expect(result.version,).toBe(1,)
		expect(result.notes.map((n,) => n.id),).toEqual(['2026-06-13-1', '2026-06-12-1',],)
	})

	it('does not mutate the original document', () => {
		appendNote(base, noteWithId('2026-06-13-1',),)
		expect(base.notes.map((n,) => n.id),).toEqual(['2026-06-12-1',],)
	})
})

describe('isHttpUrl', () => {
	it('accepts absolute http and https URLs', () => {
		expect(isHttpUrl('https://www.reddit.com/r/toolbox_nxg',),).toBe(true,)
		expect(isHttpUrl('http://example.com',),).toBe(true,)
	})

	it('rejects non-http(s) schemes that URL still parses', () => {
		expect(isHttpUrl('javascript:alert(1)',),).toBe(false,)
		expect(isHttpUrl('data:text/html,<script>1</script>',),).toBe(false,)
	})

	it('rejects unparseable / relative values', () => {
		expect(isHttpUrl('not a url',),).toBe(false,)
		expect(isHttpUrl('/r/toolbox_nxg',),).toBe(false,)
		expect(isHttpUrl('',),).toBe(false,)
	})
})

describe('filterByPublishAt', () => {
	const now = 1_000_000

	/** Note with an explicit publishAt. */
	const at = (id: string, publishAt: number,): AnnouncementNote => ({...noteWithId(id,), publishAt,})

	it('keeps notes with no publishAt', () => {
		const notes = [noteWithId('a',),]
		expect(filterByPublishAt(notes, now,),).toEqual(notes,)
	})

	it('keeps notes due now or in the past, drops future ones', () => {
		const past = at('past', now - 1,)
		const exactly = at('now', now,)
		const future = at('future', now + 1,)
		expect(filterByPublishAt([past, exactly, future,], now,).map((n,) => n.id),)
			.toEqual(['past', 'now',],)
	})
})
