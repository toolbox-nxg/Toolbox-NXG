/** Pure helper functions for the UserOverviewTab component, extracted for testability. */

import type {ModNote,} from '../../shared/modnotes/schema'

/** Number of most-recent removals previewed per content type before "Show more". */
export const recentRemovalLimit = 3

/** How many more removals each "Show more" click previews. */
export const removalPageSize = 10

/**
 * Most mod actions read when counting removals. Users with a long history (often mostly
 * AutoModerator) would otherwise cost dozens of requests; past this the totals show as "N+".
 */
export const removalScanLimit = 500

/** Kind of content a removal applies to. */
export type ContentType = 'comment' | 'post'

/** A ban entry extracted from mod notes. */
export interface BanEntry {
	id: string
	duration: string
	date: Date
	moderator: string
	reason: string | null
}

/** A content removal entry extracted from mod notes. */
export interface RemovalEntry {
	date: Date
	/** Fullname of the removed comment or post. */
	redditId: string
}

/** Removal total and every counted removal for one content type. */
export interface RemovalSummary {
	/** Removals whose latest mod action is still a removal, deduplicated by item. */
	total: number
	/** Every counted removal that has a fullname, newest first; the tab previews them a page at a time. */
	removals: RemovalEntry[]
}

/** Processed removals from a user's mod actions in a subreddit. */
export interface ModNotesSummary {
	comments: RemovalSummary
	posts: RemovalSummary
	/** True when the history was longer than `removalScanLimit`, so the totals are a lower bound. */
	capped: boolean
}

/** Mutable accumulator for streaming `processNote` calls. */
export interface NotesAccumulator {
	comments: RemovalSummary
	posts: RemovalSummary
	/** Items whose latest removal or approval has already been seen. */
	seenContentIds: Set<string>
}

/** Input for classifying a comment or post. */
export interface ContentClassificationInput {
	/** Comment body or post title. */
	text: string | undefined
	author: string
	bannedBy: string | boolean | null | undefined
}

/** Classification of a comment or post. */
export type ContentClassification = 'deleted' | 'removed-by-reddit' | 'available'

// Removing as spam logs its own action, but it is still a removal.
const removalActions = new Map<string, ContentType>([
	['removecomment', 'comment',],
	['spamcomment', 'comment',],
	['removelink', 'post',],
	['spamlink', 'post',],
],)
const approvalActions = new Set(['approvecomment', 'approvelink',],)

/** Creates a fresh accumulator for use with `processNote`. */
export function createNotesAccumulator (): NotesAccumulator {
	return {
		comments: {total: 0, removals: [],},
		posts: {total: 0, removals: [],},
		seenContentIds: new Set(),
	}
}

/**
 * Processes a single mod note into an accumulator.
 * Notes must be fed newest-first so the first removal or approval seen for an item
 * is its current state: an approval seen before an older removal stops that
 * removal from being counted.
 * @param note The mod note to process.
 * @param accumulator Accumulator to mutate in place.
 * @returns True when one of the first `recentRemovalLimit` removals of a type was added, so
 * the first previews can load before the walk finishes.
 */
export function processNote (note: ModNote, accumulator: NotesAccumulator,): boolean {
	const actionData = note.mod_action_data
	if (actionData === null) { return false }

	const removedType = removalActions.get(actionData.action,)
	if (!removedType && !approvalActions.has(actionData.action,)) { return false }

	const redditId = actionData.reddit_id
	if (redditId !== null) {
		if (accumulator.seenContentIds.has(redditId,)) { return false }
		accumulator.seenContentIds.add(redditId,)
	}
	if (!removedType) { return false }

	const summary = removedType === 'post' ? accumulator.posts : accumulator.comments
	summary.total++
	// Without a fullname there is nothing to preview, so it only counts toward the total
	if (redditId === null) { return false }
	summary.removals.push({date: new Date(note.created_at * 1000,), redditId,},)
	return summary.removals.length <= recentRemovalLimit
}

/**
 * Copies an accumulator's current results, so the snapshot stays unchanged when
 * the accumulator keeps being updated.
 * @param accumulator The accumulator to snapshot.
 * @param capped Whether the read stopped at `removalScanLimit`.
 * @returns A summary that does not share arrays with the accumulator.
 */
export function snapshotNotes (accumulator: NotesAccumulator, capped = false,): ModNotesSummary {
	return {
		comments: {total: accumulator.comments.total, removals: [...accumulator.comments.removals,],},
		posts: {total: accumulator.posts.total, removals: [...accumulator.posts.removals,],},
		capped,
	}
}

/**
 * Walks a user's mod actions (newest first) and summarizes removals, reading at most
 * `limit` of them.
 * @param notes Mod actions, newest first.
 * @param signal Stops the walk (and the underlying paging) when aborted.
 * @param onRecentRemoval Called with a snapshot each time one of the first removals of a type is found,
 * so previews can load before the walk has finished.
 * @param limit Most mod actions to read; the summary is marked `capped` when there were more.
 * @returns The summary, or null if the walk was aborted.
 */
export async function summarizeModNotes (
	notes: AsyncIterable<ModNote>,
	signal: AbortSignal,
	onRecentRemoval: (summary: ModNotesSummary,) => void,
	limit = removalScanLimit,
): Promise<ModNotesSummary | null> {
	const accumulator = createNotesAccumulator()
	let read = 0
	// Leaving the loop early ends the generator, so no further pages are requested.
	for await (const note of notes) {
		if (signal.aborted) { return null }
		if (read === limit) { return snapshotNotes(accumulator, true,) }
		read++
		if (processNote(note, accumulator,)) {
			onRecentRemoval(snapshotNotes(accumulator,),)
		}
	}
	return signal.aborted ? null : snapshotNotes(accumulator,)
}

/**
 * Turns a mod note into a ban entry.
 * @param note A mod note, typically from the `BAN` filter.
 * @returns The ban, or null when the note is not a ban (e.g. an unban).
 */
export function toBanEntry (note: ModNote,): BanEntry | null {
	const actionData = note.mod_action_data
	if (actionData?.action !== 'banuser') { return null }
	return {
		id: note.id,
		duration: actionData.details ?? 'permanent',
		date: new Date(note.created_at * 1000,),
		moderator: note.operator,
		reason: actionData.description,
	}
}

/**
 * Collects every ban from a user's ban history. This is read separately from the removals
 * (with the `BAN` filter), so it is complete and quick even when the removal count is capped.
 * @param notes Ban mod notes, newest first.
 * @param signal Stops the walk (and the underlying paging) when aborted.
 * @returns The bans, newest first, or null if the walk was aborted.
 */
export async function summarizeBans (notes: AsyncIterable<ModNote>, signal: AbortSignal,): Promise<BanEntry[] | null> {
	const bans: BanEntry[] = []
	for await (const note of notes) {
		if (signal.aborted) { return null }
		const ban = toBanEntry(note,)
		if (ban) { bans.push(ban,) }
	}
	return signal.aborted ? null : bans
}

/**
 * Classifies a comment or post as deleted, removed by Reddit, or available.
 * @param input Content text, author, and `banned_by` value.
 * @returns The classification of the content.
 */
export function classifyContent (input: ContentClassificationInput,): ContentClassification {
	if (input.author === '[deleted]' || input.text === '[deleted]') {
		return 'deleted'
	}
	if (input.bannedBy === 'reddit') {
		return 'removed-by-reddit'
	}
	return 'available'
}

/**
 * Truncates text to a maximum length, appending "..." if truncated.
 * @param text The text to truncate.
 * @param maxLength The maximum allowed length before truncation.
 * @returns The original text if within limit, or a truncated version with "..." appended.
 */
export function truncateText (text: string, maxLength: number,): string {
	if (text.length <= maxLength) { return text }
	return `${text.slice(0, maxLength,)}...`
}
