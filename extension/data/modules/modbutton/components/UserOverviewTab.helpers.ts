/** Pure helper functions for the UserOverviewTab component, extracted for testability. */

import type {ModNote,} from '../../shared/modnotes/schema'

/** Number of most-recent removals previewed per content type. */
export const recentRemovalLimit = 3

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

/** Removal totals and most-recent entries for one content type. */
export interface RemovalSummary {
	/** Removals whose latest mod action is still a removal, deduplicated by item. */
	total: number
	/** Up to `recentRemovalLimit` removals, newest first. */
	recent: RemovalEntry[]
}

/** Processed result from mod notes for a user in a subreddit. */
export interface ModNotesSummary {
	bans: BanEntry[]
	comments: RemovalSummary
	posts: RemovalSummary
}

/** Mutable accumulator for streaming `processNote` calls. */
export interface NotesAccumulator extends ModNotesSummary {
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

const removalActions = new Map<string, ContentType>([['removecomment', 'comment',], ['removelink', 'post',],],)
const approvalActions = new Set(['approvecomment', 'approvelink',],)

const shortDateFormat = new Intl.DateTimeFormat('en-US', {day: '2-digit', month: 'short', year: '2-digit',},)

/** Creates a fresh accumulator for use with `processNote`. */
export function createNotesAccumulator (): NotesAccumulator {
	return {
		bans: [],
		comments: {total: 0, recent: [],},
		posts: {total: 0, recent: [],},
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
 * @returns True when a removal was added to one of the `recent` lists.
 */
export function processNote (note: ModNote, accumulator: NotesAccumulator,): boolean {
	const actionData = note.mod_action_data
	if (actionData === null) { return false }
	const date = new Date(note.created_at * 1000,)

	if (actionData.action === 'banuser') {
		accumulator.bans.push({
			id: note.id,
			duration: actionData.details ?? 'permanent',
			date,
			moderator: note.operator,
			reason: actionData.description,
		},)
		return false
	}

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
	if (redditId === null || summary.recent.length >= recentRemovalLimit) { return false }
	summary.recent.push({date, redditId,},)
	return true
}

/**
 * Copies an accumulator's current results, so the snapshot stays unchanged when
 * the accumulator keeps being updated.
 * @param accumulator The accumulator to snapshot.
 * @returns A summary that does not share arrays with the accumulator.
 */
export function snapshotNotes (accumulator: NotesAccumulator,): ModNotesSummary {
	return {
		bans: [...accumulator.bans,],
		comments: {total: accumulator.comments.total, recent: [...accumulator.comments.recent,],},
		posts: {total: accumulator.posts.total, recent: [...accumulator.posts.recent,],},
	}
}

/**
 * Walks a user's mod notes (newest first) and summarizes bans and removals.
 * @param notes Mod notes, newest first.
 * @param signal Stops the walk (and the underlying paging) when aborted.
 * @param onRecentRemoval Called with a snapshot each time a recent removal is found,
 * so previews can load before the full history has been counted.
 * @returns The complete summary, or null if the walk was aborted.
 */
export async function summarizeModNotes (
	notes: AsyncIterable<ModNote>,
	signal: AbortSignal,
	onRecentRemoval: (summary: ModNotesSummary,) => void,
): Promise<ModNotesSummary | null> {
	const accumulator = createNotesAccumulator()
	for await (const note of notes) {
		if (signal.aborted) { return null }
		if (processNote(note, accumulator,)) {
			onRecentRemoval(snapshotNotes(accumulator,),)
		}
	}
	return signal.aborted ? null : snapshotNotes(accumulator,)
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
 * Formats a date as DD Mon YY (e.g. "14 Jun 25").
 * @param date The date to format.
 * @returns The formatted date string.
 */
export function formatShortDate (date: Date,): string {
	const parts = new Map(shortDateFormat.formatToParts(date,).map((part,) => [part.type, part.value,]),)
	return `${parts.get('day',)} ${parts.get('month',)} ${parts.get('year',)}`
}

/**
 * Truncates text to a maximum length, appending an ellipsis if truncated.
 * @param text The text to truncate.
 * @param maxLength The maximum allowed length before truncation.
 * @returns The original text if within limit, or a truncated version with ellipsis.
 */
export function truncateText (text: string, maxLength: number,): string {
	if (text.length <= maxLength) { return text }
	return `${text.slice(0, maxLength,)}…`
}
