/** Pure helper functions for the UserOverviewTab component, extracted for testability. */

import type {ModNote,} from '../../shared/modnotes/schema'

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
	redditId: string | null
	contentType: 'comment' | 'post'
}

/** Processed result from mod notes for a user in a subreddit. */
export interface ModNotesResult {
	bans: BanEntry[]
	currentlyBanned: boolean
	totalRemovalCount: number
	recentRemovals: RemovalEntry[]
}

/** Mutable accumulator for streaming processNote calls. */
export interface NotesAccumulator {
	bans: BanEntry[]
	currentlyBanned: boolean | null
	totalRemovalCount: number
	recentRemovals: RemovalEntry[]
	seenContentIds: Set<string>
}

/** Input for classifying a comment or post. */
export interface CommentBodyInput {
	body: string | undefined
	author: string
	bannedBy: string | boolean | null | undefined
}

/** Classification of a comment or post. */
export type CommentClassification = 'deleted' | 'removed-by-reddit' | 'available'

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',]

/** Creates a fresh accumulator for use with processNote. */
export function createNotesAccumulator (): NotesAccumulator {
	return {
		bans: [],
		currentlyBanned: null,
		totalRemovalCount: 0,
		recentRemovals: [],
		seenContentIds: new Set(),
	}
}

/**
 * Processes a single mod note into an accumulator.
 * Notes must be fed newest-first so the first action seen for a content ID is its
 * terminal state: an approval encountered before its older removal prevents that
 * removal from being counted.
 * @param note The mod note to process.
 * @param acc Accumulator to mutate in place.
 */
export function processNote (note: ModNote, acc: NotesAccumulator,): void {
	const modData = note.mod_action_data
	if (modData === null) { return }

	if (modData.action === 'banuser' || modData.action === 'unbanuser') {
		if (acc.currentlyBanned === null) {
			acc.currentlyBanned = modData.action === 'banuser'
		}
	}

	if (modData.action === 'banuser') {
		acc.bans.push({
			id: note.id,
			duration: modData.details ?? 'permanent',
			date: new Date(note.created_at * 1000,),
			moderator: note.operator,
			reason: modData.description,
		},)
	}

	const isRemoval = modData.action === 'removecomment' || modData.action === 'removelink'
	const isApproval = modData.action === 'approvecomment' || modData.action === 'approvelink'

	if (isRemoval || isApproval) {
		const id = modData.reddit_id
		if (id !== null) {
			if (acc.seenContentIds.has(id,)) { return }
			acc.seenContentIds.add(id,)
		}
		if (isRemoval) {
			acc.totalRemovalCount++
			if (acc.recentRemovals.length < 3) {
				acc.recentRemovals.push({
					date: new Date(note.created_at * 1000,),
					redditId: id,
					contentType: modData.action === 'removelink' ? 'post' : 'comment',
				},)
			}
		}
	}
}

/**
 * Finalizes an accumulator into a ModNotesResult.
 * @param acc The accumulator to finalize.
 * @returns The finalized result.
 */
export function finalizeNotes (acc: NotesAccumulator,): ModNotesResult {
	return {
		bans: acc.bans,
		currentlyBanned: acc.currentlyBanned ?? false,
		totalRemovalCount: acc.totalRemovalCount,
		recentRemovals: acc.recentRemovals,
	}
}

/**
 * Convenience wrapper: processes an array of mod notes (newest-first) and returns the result.
 * @param notes Array of mod notes, newest first.
 * @returns Structured result with bans, ban status, all-time removal count, and recent removals.
 */
export function processModNotes (notes: ModNote[],): ModNotesResult {
	const acc = createNotesAccumulator()
	for (const note of notes) { processNote(note, acc,) }
	return finalizeNotes(acc,)
}

/**
 * Classifies a comment or post as deleted, removed by Reddit, or available.
 * @param input Content body, author, and bannedBy field.
 * @returns The classification of the content.
 */
export function classifyCommentBody (input: CommentBodyInput,): CommentClassification {
	if (input.author === '[deleted]' || input.body === '[deleted]') {
		return 'deleted'
	}
	if (input.bannedBy === true || input.bannedBy === 'reddit') {
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
	const day = String(date.getDate(),).padStart(2, '0',)
	const month = monthNames[date.getMonth()]!
	const year = String(date.getFullYear(),).slice(-2,)
	return `${day} ${month} ${year}`
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
