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

/** A comment removal entry extracted from mod notes. */
export interface RemovalEntry {
	date: Date
	redditId: string | null
}

/** Processed result from mod notes for a user in a subreddit. */
export interface ModNotesResult {
	bans: BanEntry[]
	currentlyBanned: boolean
	totalRemovalCount: number
	recentRemovals: RemovalEntry[]
}

/** Input for classifying a comment body. */
export interface CommentBodyInput {
	body: string | undefined
	author: string
	spam: boolean | undefined
	bannedBy: string | boolean | null | undefined
}

/** Classification of a comment body. */
export type CommentClassification = 'deleted' | 'removed-by-reddit' | 'available'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',]

/**
 * Processes mod notes (newest-first from API) into a structured result.
 * Each unique reddit_id is counted once — the same comment removed by both automod
 * and a moderator produces two removecomment entries but counts as one removal.
 * @param notes Array of mod notes, newest first.
 * @returns Structured result with bans, ban status, all-time removal count, and recent removals.
 */
export function processModNotes (notes: ModNote[],): ModNotesResult {
	const bans: BanEntry[] = []
	let currentlyBanned: boolean | null = null
	let totalRemovalCount = 0
	const recentRemovals: RemovalEntry[] = []
	const seenCommentIds = new Set<string>()

	for (const note of notes) {
		const modData = note.mod_action_data
		if (modData === null) { continue }

		if (modData.action === 'banuser' || modData.action === 'unbanuser') {
			if (currentlyBanned === null) {
				currentlyBanned = modData.action === 'banuser'
			}
		}

		if (modData.action === 'banuser') {
			bans.push({
				id: note.id,
				duration: modData.details ?? 'permanent',
				date: new Date(note.created_at * 1000,),
				moderator: note.operator,
				reason: modData.description,
			},)
		}

		if (modData.action === 'removecomment') {
			const id = modData.reddit_id
			if (id === null || !seenCommentIds.has(id,)) {
				if (id !== null) { seenCommentIds.add(id,) }
				totalRemovalCount++
				if (recentRemovals.length < 3) {
					recentRemovals.push({date: new Date(note.created_at * 1000,), redditId: id,},)
				}
			}
		}
	}

	return {
		bans,
		currentlyBanned: currentlyBanned ?? false,
		totalRemovalCount,
		recentRemovals,
	}
}

/**
 * Classifies a comment body as deleted, removed by Reddit, or available.
 * @param input Comment body, author, spam flag, and bannedBy field.
 * @returns The classification of the comment.
 */
export function classifyCommentBody (input: CommentBodyInput,): CommentClassification {
	if (input.author === '[deleted]' || input.body === '[deleted]') {
		return 'deleted'
	}
	if (input.spam === true || input.bannedBy === true || input.bannedBy === 'reddit') {
		return 'removed-by-reddit'
	}
	return 'available'
}

/**
 * Formats a date as DD Mon YY (e.g. "14 Jun 25").
 * @param date The date to format.
 * @returns The formatted date string.
 */
export function formatBanDate (date: Date,): string {
	const day = String(date.getDate(),).padStart(2, '0',)
	const month = MONTH_NAMES[date.getMonth()]!
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
