/** Tests for the pure UserOverviewTab helpers. */

import {describe, expect, it, vi,} from 'vitest'

import type {ModNote, ModNoteModActionData,} from '../../shared/modnotes/schema'
import {
	classifyContent,
	createNotesAccumulator,
	formatShortDate,
	type ModNotesSummary,
	processNote,
	recentRemovalLimit,
	snapshotNotes,
	summarizeBans,
	summarizeModNotes,
	toBanEntry,
	truncateText,
} from './UserOverviewTab.helpers'

let nextNoteId = 0

function makeModNote (
	action: string,
	actionData: Partial<ModNoteModActionData> = {},
	createdAt = 1700000000,
): ModNote {
	nextNoteId++
	return {
		id: `note_${nextNoteId}`,
		created_at: createdAt,
		type: 'MOD_ACTION',
		operator: 'mod1',
		subreddit: 'testsub',
		user: 'testuser',
		label: null,
		description: null,
		details: null,
		user_note_data: null,
		mod_action_data: {action, details: null, description: null, reddit_id: null, ...actionData,},
	}
}

async function* toAsyncIterable (notes: ModNote[],): AsyncGenerator<ModNote> {
	for (const note of notes) {
		yield note
	}
}

/** Summarizes notes (newest first) without progress reporting or cancellation. */
async function summarize (notes: ModNote[],): Promise<ModNotesSummary | null> {
	return summarizeModNotes(toAsyncIterable(notes,), new AbortController().signal, () => {},)
}

describe('processNote', () => {
	it('ignores notes without mod action data', () => {
		const accumulator = createNotesAccumulator()
		const note = {...makeModNote('banuser',), mod_action_data: null,}
		expect(processNote(note, accumulator,),).toBe(false,)
		expect(snapshotNotes(accumulator,),).toEqual(snapshotNotes(createNotesAccumulator(),),)
	})

	it('ignores unrelated mod actions', () => {
		const accumulator = createNotesAccumulator()
		expect(processNote(makeModNote('lock', {reddit_id: 't3_a',},), accumulator,),).toBe(false,)
		expect(accumulator.seenContentIds.size,).toBe(0,)
	})

	it('leaves bans to the separate ban history read', () => {
		const accumulator = createNotesAccumulator()
		expect(processNote(makeModNote('banuser',), accumulator,),).toBe(false,)
		expect(snapshotNotes(accumulator,),).toEqual(snapshotNotes(createNotesAccumulator(),),)
	})

	it('returns true only when a recent removal is added', () => {
		const accumulator = createNotesAccumulator()
		expect(processNote(makeModNote('removecomment', {reddit_id: 't1_a',},), accumulator,),).toBe(true,)
		expect(processNote(makeModNote('removecomment', {reddit_id: 't1_a',},), accumulator,),).toBe(false,)
	})

	it('counts a removal without a fullname but does not preview it', () => {
		const accumulator = createNotesAccumulator()
		expect(processNote(makeModNote('removecomment',), accumulator,),).toBe(false,)
		expect(accumulator.comments,).toEqual({total: 1, removals: [],},)
	})
})

describe('snapshotNotes', () => {
	it('does not share arrays with the accumulator', () => {
		const accumulator = createNotesAccumulator()
		const snapshot = snapshotNotes(accumulator,)
		processNote(makeModNote('removecomment', {reddit_id: 't1_a',},), accumulator,)
		processNote(makeModNote('removelink', {reddit_id: 't3_a',},), accumulator,)
		expect(snapshot.comments,).toEqual({total: 0, removals: [],},)
		expect(snapshot.posts,).toEqual({total: 0, removals: [],},)
	})
})

describe('summarizeModNotes', () => {
	it('returns an empty summary for no notes', async () => {
		expect(await summarize([],),).toEqual({
			comments: {total: 0, removals: [],},
			posts: {total: 0, removals: [],},
			capped: false,
		},)
	})

	it('separates comment and post removals', async () => {
		const result = await summarize([
			makeModNote('removelink', {reddit_id: 't3_a',}, 1700000200,),
			makeModNote('removecomment', {reddit_id: 't1_a',}, 1700000100,),
		],)
		expect(result?.posts,).toEqual({
			total: 1,
			removals: [{redditId: 't3_a', date: new Date(1700000200 * 1000,),},],
		},)
		expect(result?.comments,).toEqual({
			total: 1,
			removals: [{redditId: 't1_a', date: new Date(1700000100 * 1000,),},],
		},)
	})

	it('keeps every removal, newest first, so they can be paged through', async () => {
		const comments = [1, 2, 3, 4, 5,].map((index,) =>
			makeModNote('removecomment', {reddit_id: `t1_${index}`,}, 1700000100 - index,)
		)
		const result = await summarize(comments,)
		expect(result?.comments.total,).toBe(5,)
		expect(result?.comments.removals.map((removal,) => removal.redditId),).toEqual([
			't1_1',
			't1_2',
			't1_3',
			't1_4',
			't1_5',
		],)
	})

	it('reports progress only for the first removals of each type', () => {
		const accumulator = createNotesAccumulator()
		const added = [1, 2, 3, 4,].map((index,) =>
			processNote(makeModNote('removecomment', {reddit_id: `t1_${index}`,},), accumulator,)
		)
		expect(added,).toEqual([true, true, true, false,],)
		expect(accumulator.comments.removals,).toHaveLength(4,)
		expect(recentRemovalLimit,).toBe(3,)
	})

	it('finds post removals even when the newest removals are all comments', async () => {
		const result = await summarize([
			...[1, 2, 3, 4,].map((index,) => makeModNote('removecomment', {reddit_id: `t1_${index}`,},)),
			makeModNote('removelink', {reddit_id: 't3_old',},),
		],)
		expect(result?.comments.removals,).toHaveLength(4,)
		expect(result?.posts.removals.map((removal,) => removal.redditId),).toEqual(['t3_old',],)
	})

	it('counts removals as spam', async () => {
		const result = await summarize([
			makeModNote('spamcomment', {reddit_id: 't1_a',},),
			makeModNote('spamlink', {reddit_id: 't3_a',},),
		],)
		expect(result?.comments.total,).toBe(1,)
		expect(result?.posts.total,).toBe(1,)
	})

	it('does not count a spam removal that was later approved', async () => {
		const result = await summarize([
			makeModNote('approvecomment', {reddit_id: 't1_a',}, 1700000100,),
			makeModNote('spamcomment', {reddit_id: 't1_a',}, 1700000000,),
		],)
		expect(result?.comments,).toEqual({total: 0, removals: [],},)
	})

	it('reads at most the scan limit and marks the result capped', async () => {
		const read = vi.fn()
		async function* notes (): AsyncGenerator<ModNote> {
			for (let index = 0; index < 10; index++) {
				read()
				yield makeModNote('removecomment', {reddit_id: `t1_${index}`,},)
			}
		}
		const result = await summarizeModNotes(notes(), new AbortController().signal, () => {}, 4,)
		expect(result,).toMatchObject({comments: {total: 4,}, capped: true,},)
		// The note past the limit is only read to learn that there are more.
		expect(read,).toHaveBeenCalledTimes(5,)
	})

	it('reads the whole history when there is no limit (Count all)', async () => {
		const notes = [1, 2, 3, 4, 5, 6,].map((index,) => makeModNote('removecomment', {reddit_id: `t1_${index}`,},))
		const result = await summarizeModNotes(
			toAsyncIterable(notes,),
			new AbortController().signal,
			() => {},
			Infinity,
		)
		expect(result,).toMatchObject({comments: {total: 6,}, capped: false,},)
	})

	it('is not capped when the history ends exactly at the limit', async () => {
		const notes = [1, 2, 3, 4,].map((index,) => makeModNote('removecomment', {reddit_id: `t1_${index}`,},))
		const result = await summarizeModNotes(toAsyncIterable(notes,), new AbortController().signal, () => {}, 4,)
		expect(result,).toMatchObject({comments: {total: 4,}, capped: false,},)
	})

	it('does not double-count the same item removed twice', async () => {
		const result = await summarize([
			makeModNote('removecomment', {reddit_id: 't1_abc',}, 1700000100,),
			makeModNote('removecomment', {reddit_id: 't1_abc',}, 1700000000,),
		],)
		expect(result?.comments.total,).toBe(1,)
		expect(result?.comments.removals,).toHaveLength(1,)
	})

	it.each(
		[
			['approvecomment', 'removecomment', 't1_abc', 'comments',],
			['approvelink', 'removelink', 't3_xyz', 'posts',],
		] as const,
	)('does not count a removal later reversed by %s', async (approval, removal, redditId, key,) => {
		const result = await summarize([
			makeModNote(approval, {reddit_id: redditId,}, 1700000100,),
			makeModNote(removal, {reddit_id: redditId,}, 1700000000,),
		],)
		expect(result?.[key],).toEqual({total: 0, removals: [],},)
	},)

	it('counts a removal that was approved and then removed again', async () => {
		const result = await summarize([
			makeModNote('removecomment', {reddit_id: 't1_abc',}, 1700000200,),
			makeModNote('approvecomment', {reddit_id: 't1_abc',}, 1700000100,),
			makeModNote('removecomment', {reddit_id: 't1_abc',}, 1700000000,),
		],)
		expect(result?.comments.total,).toBe(1,)
	})

	it('reports partial snapshots as recent removals are found', async () => {
		const onRecentRemoval = vi.fn()
		await summarizeModNotes(
			toAsyncIterable([
				makeModNote('removecomment', {reddit_id: 't1_a',},),
				makeModNote('banuser',),
				makeModNote('removelink', {reddit_id: 't3_a',},),
			],),
			new AbortController().signal,
			onRecentRemoval,
		)
		expect(onRecentRemoval,).toHaveBeenCalledTimes(2,)
		expect(onRecentRemoval.mock.calls[0]?.[0],).toMatchObject({comments: {total: 1,}, posts: {total: 0,},},)
		expect(onRecentRemoval.mock.calls[1]?.[0],).toMatchObject({comments: {total: 1,}, posts: {total: 1,},},)
	})

	it('stops reading and returns null when aborted', async () => {
		const controller = new AbortController()
		const read = vi.fn()
		async function* notes (): AsyncGenerator<ModNote> {
			yield makeModNote('removecomment', {reddit_id: 't1_a',},)
			controller.abort()
			yield makeModNote('removecomment', {reddit_id: 't1_b',},)
			read()
			yield makeModNote('removecomment', {reddit_id: 't1_c',},)
		}
		const onRecentRemoval = vi.fn()
		expect(await summarizeModNotes(notes(), controller.signal, onRecentRemoval,),).toBeNull()
		expect(onRecentRemoval,).toHaveBeenCalledTimes(1,)
		expect(read,).not.toHaveBeenCalled()
	})
})

describe('toBanEntry', () => {
	it('records a ban with its fields', () => {
		const note = makeModNote('banuser', {details: '30 days', description: 'rule violation',}, 1700000000,)
		expect(toBanEntry({...note, operator: 'mod_alice',},),).toEqual({
			id: note.id,
			duration: '30 days',
			date: new Date(1700000000 * 1000,),
			moderator: 'mod_alice',
			reason: 'rule violation',
		},)
	})

	it('defaults ban duration to permanent', () => {
		expect(toBanEntry(makeModNote('banuser',),),).toMatchObject({duration: 'permanent',},)
	})

	it('ignores unbans and notes without mod action data', () => {
		expect(toBanEntry(makeModNote('unbanuser',),),).toBeNull()
		expect(toBanEntry({...makeModNote('banuser',), mod_action_data: null,},),).toBeNull()
	})
})

describe('summarizeBans', () => {
	it('collects every ban, newest first, skipping unbans', async () => {
		const result = await summarizeBans(
			toAsyncIterable([
				makeModNote('banuser', {details: '7 days',}, 1700000300,),
				makeModNote('unbanuser', {}, 1700000200,),
				makeModNote('banuser', {}, 1700000100,),
			],),
			new AbortController().signal,
		)
		expect(result?.map((ban,) => ban.duration),).toEqual(['7 days', 'permanent',],)
	})

	it('returns null when aborted', async () => {
		const controller = new AbortController()
		async function* notes (): AsyncGenerator<ModNote> {
			yield makeModNote('banuser',)
			controller.abort()
			yield makeModNote('banuser',)
		}
		expect(await summarizeBans(notes(), controller.signal,),).toBeNull()
	})
})

describe('classifyContent', () => {
	it('classifies as deleted when the author is [deleted]', () => {
		expect(classifyContent({text: 'some text', author: '[deleted]', bannedBy: null,},),).toBe('deleted',)
	})

	it('classifies as deleted when the text is [deleted]', () => {
		expect(classifyContent({text: '[deleted]', author: 'alice', bannedBy: null,},),).toBe('deleted',)
	})

	it('classifies as removed-by-reddit when bannedBy is "reddit"', () => {
		expect(classifyContent({text: 'text', author: 'alice', bannedBy: 'reddit',},),).toBe('removed-by-reddit',)
	})

	it.each([true, 'some_mod', null, undefined,],)('classifies as available when bannedBy is %s', (bannedBy,) => {
		expect(classifyContent({text: 'text', author: 'alice', bannedBy,},),).toBe('available',)
	},)
})

describe('formatShortDate', () => {
	// The reader's locale decides the order and month names, so check the parts, not the layout.
	it('shows the zero-padded day, short month and two-digit year', () => {
		const date = new Date(2024, 0, 3,)
		const month = new Intl.DateTimeFormat(undefined, {month: 'short',},).format(date,)
		const formatted = formatShortDate(date,)
		expect(formatted,).toContain('03',)
		expect(formatted,).toContain(month,)
		expect(formatted,).toContain('24',)
		expect(formatted,).not.toContain('2024',)
	})
})

describe('truncateText', () => {
	it('returns text unchanged when shorter than maxLength', () => {
		expect(truncateText('hello', 10,),).toBe('hello',)
	})

	it('truncates with "..." when longer than maxLength', () => {
		expect(truncateText('hello world', 5,),).toBe('hello...',)
	})

	it('returns text unchanged at exact boundary', () => {
		expect(truncateText('hello', 5,),).toBe('hello',)
	})
})
