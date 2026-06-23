/** Pure helper functions and types for the UserNotesManagerOverlay: filtering, sorting, statistics, and prune preview. */

import {byteLength, zlibDeflate,} from '../../../util/data/encoding'
import {daysToMilliseconds,} from '../../../util/data/time'
import {isNoteActive,} from '../../../util/wiki/schemas/usernotes/schema'
import type {
	ArchivedMode,
	PruneOptions,
	UserNoteColor,
	UserNoteEntry,
	UsernotesUser,
} from '../../../util/wiki/schemas/usernotes/schema'

/** Column by which the manager browse table can be sorted. */
export type UserNotesManagerSortKey = 'username' | 'date' | 'kind' | 'noteCount' | 'moderator'
/** Sort order for the manager browse table. */
export type SortDirection = 'asc' | 'desc'

/** Active filter values for the manager browse view. */
export interface UserNotesManagerFilters {
	/** Username substring filter. */
	userText: string
	/** Note text substring filter. */
	contentText: string
	/** Note kind key filter: empty array shows all kinds, otherwise only matching kinds are shown. */
	kind: string[]
	/** Moderator username filter, or `'all'` to show all mods. */
	moderator: string
	/**
	 * Controls which archived notes are visible, sharing the prune executor's
	 * {@link ArchivedMode} vocabulary:
	 * - `'exclude'` (default): archived notes are hidden.
	 * - `'include'`: archived notes are shown alongside active notes.
	 * - `'only'`: only archived notes are shown.
	 */
	archived?: ArchivedMode
}

/** Persisted preferences for the manager browse view, extending the active filters. */
export interface UserNotesManagerPreferences extends UserNotesManagerFilters {
	sortKey: UserNotesManagerSortKey
	sortDirection: SortDirection
	pageSize: number
}

/** A usernote user augmented with the unfiltered original notes for display totals. */
export interface ManagerUser extends UsernotesUser {
	/** The full unfiltered note list before search filters were applied. */
	originalNotes?: UserNoteEntry[]
}

/** Aggregate note statistics for a set of users. */
export interface NoteStats {
	/** Number of users who have at least one note. */
	userCount: number
	/** Number of users who have zero notes (usually after pruning). */
	emptyUserCount: number
	noteCount: number
	oldestNoteTime: number | null
	newestNoteTime: number | null
	/** Per-type note counts sorted by the subreddit's configured type order. */
	typeCounts: Array<{key: string; label: string; color: string; count: number}>
}

/** A single row in the prune preview sample list. */
export interface PrunePreviewRow {
	user: string
	note: UserNoteEntry
	/** Human-readable label for the note's kind. */
	kindLabel: string
}

/** Result of a dry-run prune operation for preview display. */
export interface PrunePreview {
	/** The remaining users after the prune rules have been applied. */
	users: Record<string, UsernotesUser>
	prunedNotes: number
	/** Users that would lose all their notes (their records are retained). */
	prunedUsers: number
	totalNotes: number
	totalUsers: number
	/** Up to `sampleSize` matching rows for display in the preview table. */
	sampleRows: PrunePreviewRow[]
	/**
	 * The stable indexes of every matched note, keyed by username - the single
	 * source of truth for "what would be pruned". The real prune seeds its
	 * match set from this (then adds account-status matches) and drives both
	 * delete and archive from it, instead of re-deriving the set.
	 */
	matched: Map<string, Set<number>>
}

/** Comprehensive statistics for the Statistics tab of the usernotes manager. */
export interface UserNotesStatistics {
	totalUsers: number
	usersWithNotes: number
	emptyUsers: number
	totalNotes: number
	averageNotesPerUser: number
	maxNotesOnUser: number
	notesWithLinks: number
	notesWithoutLinks: number
	notesWithTypes: number
	notesWithoutTypes: number
	uniqueModerators: number
	averageNoteLength: number
	longestNoteLength: number
	/** Number of archived notes (hidden by default but kept). */
	archivedNotes: number
	/** Number of non-archived (visible) notes. */
	activeNotes: number
	/** Estimated compressed wiki storage used, in bytes. */
	storageBytesUsed: number
	storageBytesRemaining: number
	/** Percentage of the wiki storage limit consumed (0-100). */
	storagePercentUsed: number
	oldestNoteTime: number | null
	newestNoteTime: number | null
	/** Note counts grouped into age ranges. */
	ageBuckets: Array<{label: string; count: number}>
	typeCounts: Array<{key: string; label: string; color: string; count: number}>
	/** Top 10 moderators by note count. */
	moderatorCounts: Array<{name: string; count: number}>
	/** Top 10 users by note count. */
	topUsers: Array<{name: string; count: number; newestNoteTime: number | null}>
}

/** Maximum usernotes wiki page size in bytes (1 MB Reddit limit). */
export const usernotesWikiMaxBytes = 1_048_576

/**
 * Actual wiki storage usage for the manager's statistics tab.
 * `legacy` means the single legacy `usernotes` page, bound by Reddit's 1MB
 * allowance for that path; `sharded` means the NXG layout, where capacity is
 * effectively unlimited because pages split automatically near the per-page
 * limit.
 */
export type UsernotesStorageInfo =
	| {mode: 'legacy'; totalBytes: number}
	| {
		mode: 'sharded'
		totalBytes: number
		shardCount: number
		largestShardBytes: number
		/** Size of the 6.x legacy mirror page, present when compatibility writes are enabled. */
		legacyCompatBytes?: number
	}
const defaultKindKey = '__none'

function textIncludes (value: string | undefined, search: string,) {
	return value?.toLowerCase().includes(search.trim().toLowerCase(),) ?? false
}

function squashPermalink (permalink: string | undefined,): string {
	if (!permalink) { return '' }
	const commentsLinkRe = /\/comments\/(\w+)\/(?:[^/]+\/(?:(\w+))?)?/
	const modmailLinkRe = /\/messages\/(\w+)/
	const linkMatches = permalink.match(commentsLinkRe,)
	const modmailMatches = permalink.match(modmailLinkRe,)
	if (linkMatches) {
		let squashed = `l,${linkMatches[1]}`
		if (linkMatches[2] !== undefined) { squashed += `,${linkMatches[2]}` }
		return squashed
	}
	if (modmailMatches) { return `m,${modmailMatches[1]}` }
	return ''
}

function getConstantId (pool: string[], value: string,) {
	const existing = pool.indexOf(value,)
	if (existing !== -1) { return existing }
	pool.push(value,)
	return pool.length - 1
}

/**
 * Estimates the compressed wiki storage size that the given users list would occupy.
 * Uses the same deflate + JSON encoding path as the actual save operation.
 */
export function estimateUsernotesStorageBytes (users: UsernotesUser[],): number {
	const constants = {users: [] as string[], warnings: [] as string[],}
	const deflatedUsers: Record<string, {ns: Array<{n: string; t: number; m: number; l: string; w: number}>}> = {}

	for (const user of users) {
		if (user.notes.length === 0) { continue }
		deflatedUsers[user.name] = {
			ns: user.notes.filter((note,): note is UserNoteEntry => note !== undefined).map((note,) => ({
				n: note.note,
				t: note.time,
				m: getConstantId(constants.users, note.mod,),
				l: squashPermalink(note.link,),
				w: getConstantId(constants.warnings, note.type ?? '',),
			})),
		}
	}

	return byteLength(JSON.stringify({
		ver: 6,
		constants,
		blob: zlibDeflate(JSON.stringify(deflatedUsers,),),
	},),)
}

/**
 * Returns the storage key used for a note type, substituting a sentinel for undefined/empty.
 * Ensures notes with no type have a consistent key for grouping and filtering.
 */
export function normalizeKindKey (key: string | undefined,) {
	return key || defaultKindKey
}

/**
 * Formats a count with a localized number and a singular/plural noun, e.g.
 * `statLabel(1, 'note')` -> `"1 note"`, `statLabel(3, 'note')` -> `"3 notes"`.
 * @param count The quantity to render.
 * @param singular The noun to use when `count` is 1.
 * @param plural The noun to use otherwise; defaults to `singular` + `'s'`.
 */
export function statLabel (count: number, singular: string, plural = `${singular}s`,) {
	return `${count.toLocaleString()} ${count === 1 ? singular : plural}`
}

/**
 * Returns the display label for a note type key.
 * @returns The configured label, or `'No type'` when the key is absent/empty.
 */
export function getKindLabel (colors: UserNoteColor[], key: string | undefined,) {
	if (!key) { return 'No type' }
	return colors.find((color,) => color.key === key)?.text || key
}

/**
 * Returns the hex color string for a note type key.
 * @returns The configured color, or an empty string when the key is absent/empty.
 */
export function getKindColor (colors: UserNoteColor[], key: string | undefined,) {
	if (!key) { return '' }
	return colors.find((color,) => color.key === key)?.color || ''
}

/** Computes aggregate note statistics (counts, timestamps, per-type breakdown) for a set of users. */
export function getNoteStats (users: UsernotesUser[], colors: UserNoteColor[],): NoteStats {
	const typeCounts = new Map<string, number>()
	let noteCount = 0
	let oldestNoteTime: number | null = null
	let newestNoteTime: number | null = null

	for (const user of users) {
		for (const note of user.notes) {
			noteCount += 1
			oldestNoteTime = oldestNoteTime == null ? note.time : Math.min(oldestNoteTime, note.time,)
			newestNoteTime = newestNoteTime == null ? note.time : Math.max(newestNoteTime, note.time,)
			const key = normalizeKindKey(note.type,)
			typeCounts.set(key, (typeCounts.get(key,) ?? 0) + 1,)
		}
	}

	return {
		userCount: users.filter((user,) => user.notes.length > 0).length,
		emptyUserCount: users.filter((user,) => user.notes.length === 0).length,
		noteCount,
		oldestNoteTime,
		newestNoteTime,
		typeCounts: [...typeCounts.entries(),]
			.map(([key, count,],) => ({
				key,
				label: getKindLabel(colors, key === defaultKindKey ? undefined : key,),
				color: getKindColor(colors, key === defaultKindKey ? undefined : key,),
				count,
			}))
			.sort((a, b,) => {
				const aIndex = colors.findIndex((color,) => color.key === a.key)
				const bIndex = colors.findIndex((color,) => color.key === b.key)
				if (aIndex !== -1 && bIndex !== -1) { return aIndex - bIndex }
				if (aIndex !== -1) { return -1 }
				if (bIndex !== -1) { return 1 }
				return a.label.localeCompare(b.label,)
			},),
	}
}

/**
 * Computes the full statistics object shown in the Statistics tab of the manager overlay.
 * @param users The users (with their notes) to aggregate.
 * @param colors The note-color definitions used to bucket notes by type.
 * @param now Current timestamp in ms; injectable for testing.
 */
export function getUserNotesStatistics (
	users: UsernotesUser[],
	colors: UserNoteColor[],
	now = Date.now(),
): UserNotesStatistics {
	const stats = getNoteStats(users, colors,)
	const moderatorCounts = new Map<string, number>()
	const ageBuckets = [
		{label: 'Last 30 days', maxAge: daysToMilliseconds(30,), count: 0,},
		{label: '30-90 days', minAge: daysToMilliseconds(30,), maxAge: daysToMilliseconds(90,), count: 0,},
		{label: '90-180 days', minAge: daysToMilliseconds(90,), maxAge: daysToMilliseconds(180,), count: 0,},
		{label: '180-365 days', minAge: daysToMilliseconds(180,), maxAge: daysToMilliseconds(365,), count: 0,},
		{label: '1-2 years', minAge: daysToMilliseconds(365,), maxAge: daysToMilliseconds(730,), count: 0,},
		{label: '2+ years', minAge: daysToMilliseconds(730,), count: 0,},
	]
	let notesWithLinks = 0
	let notesWithoutLinks = 0
	let notesWithTypes = 0
	let notesWithoutTypes = 0
	let totalNoteLength = 0
	let longestNoteLength = 0
	let maxNotesOnUser = 0
	let archivedNotes = 0
	// The legacy-page estimate only counts active notes - that's all the v6
	// mirror holds.
	const storageBytesUsed = estimateUsernotesStorageBytes(
		users.map((user,) => ({...user, notes: user.notes.filter(isNoteActive,),})),
	)

	for (const user of users) {
		maxNotesOnUser = Math.max(maxNotesOnUser, user.notes.length,)
		for (const note of user.notes) {
			if (!isNoteActive(note,)) { archivedNotes += 1 }
			if (note.link) { notesWithLinks += 1 }
			else { notesWithoutLinks += 1 }
			if (note.type) { notesWithTypes += 1 }
			else { notesWithoutTypes += 1 }
			moderatorCounts.set(note.mod || 'unknown', (moderatorCounts.get(note.mod || 'unknown',) ?? 0) + 1,)
			totalNoteLength += note.note.length
			longestNoteLength = Math.max(longestNoteLength, note.note.length,)

			// `now` and the bucket bounds are ms; `note.time` is seconds.
			const age = now - note.time * 1000
			const bucket = ageBuckets.find(({minAge = 0, maxAge,},) =>
				age >= minAge && (maxAge == null || age < maxAge)
			)
			if (bucket) { bucket.count += 1 }
		}
	}

	return {
		totalUsers: users.length,
		usersWithNotes: stats.userCount,
		emptyUsers: stats.emptyUserCount,
		totalNotes: stats.noteCount,
		archivedNotes,
		activeNotes: stats.noteCount - archivedNotes,
		averageNotesPerUser: stats.userCount ? stats.noteCount / stats.userCount : 0,
		maxNotesOnUser,
		notesWithLinks,
		notesWithoutLinks,
		notesWithTypes,
		notesWithoutTypes,
		uniqueModerators: moderatorCounts.size,
		averageNoteLength: stats.noteCount ? totalNoteLength / stats.noteCount : 0,
		longestNoteLength,
		storageBytesUsed,
		storageBytesRemaining: Math.max(0, usernotesWikiMaxBytes - storageBytesUsed,),
		storagePercentUsed: storageBytesUsed / usernotesWikiMaxBytes * 100,
		oldestNoteTime: stats.oldestNoteTime,
		newestNoteTime: stats.newestNoteTime,
		ageBuckets: ageBuckets.map(({label, count,},) => ({label, count,})),
		typeCounts: stats.typeCounts,
		moderatorCounts: [...moderatorCounts.entries(),]
			.map(([name, count,],) => ({name, count,}))
			.sort((a, b,) => b.count - a.count || a.name.localeCompare(b.name,))
			.slice(0, 10,),
		topUsers: users
			.filter((user,) => user.notes.length > 0)
			.map((user,) => ({
				name: user.name,
				count: user.notes.length,
				newestNoteTime: newestNoteTime(user,),
			}))
			.sort((a, b,) =>
				b.count - a.count || (b.newestNoteTime ?? 0) - (a.newestNoteTime ?? 0) || a.name.localeCompare(b.name,)
			)
			.slice(0, 10,),
	}
}

/**
 * Filters and maps users based on the active browse-view filters.
 * Users whose notes don't match any filter criterion are excluded entirely.
 */
export function filterUsers (users: UsernotesUser[], filters: UserNotesManagerFilters,): ManagerUser[] {
	const userSearch = filters.userText.trim().toLowerCase()
	const noteSearch = filters.contentText.trim().toLowerCase()

	return users.map((user,) => {
		const notes = user.notes.filter((note,) => {
			const isArchived = !isNoteActive(note,)
			const archived = filters.archived ?? 'exclude'
			if (archived === 'only') {
				if (!isArchived) { return false }
			} else if (archived === 'exclude') {
				if (isArchived) { return false }
			}
			if (noteSearch && !textIncludes(note.note, noteSearch,)) { return false }
			if (filters.kind.length > 0 && !filters.kind.includes(normalizeKindKey(note.type,),)) { return false }
			if (filters.moderator && filters.moderator !== 'all' && note.mod !== filters.moderator) { return false }
			return true
		},)
		return {...user, notes, originalNotes: user.notes,}
	},).filter((user,) => {
		if (userSearch && !user.name.toLowerCase().includes(userSearch,)) { return false }
		return user.notes.length > 0
	},)
}

function newestNoteTime (user: UsernotesUser,) {
	// Guard the empty case: spreading no args into Math.max yields -Infinity.
	if (user.notes.length === 0) { return 0 }
	return Math.max(...user.notes.map((note,) => note.time),)
}

function oldestNoteTime (user: UsernotesUser,) {
	// Guard the empty case: spreading no args into Math.min yields +Infinity.
	if (user.notes.length === 0) { return 0 }
	return Math.min(...user.notes.map((note,) => note.time),)
}

function primaryKindLabel (user: UsernotesUser, colors: UserNoteColor[],) {
	return user.notes.map((note,) => getKindLabel(colors, note.type,)).sort((a, b,) => a.localeCompare(b,))[0] ?? ''
}

function primaryModerator (user: UsernotesUser,) {
	return user.notes.map((note,) => note.mod || '').sort((a, b,) => a.localeCompare(b,))[0] ?? ''
}

function compareValues (a: string | number, b: string | number,) {
	if (typeof a === 'number' && typeof b === 'number') { return a - b }
	return String(a,).localeCompare(String(b,), undefined, {sensitivity: 'base',},)
}

/**
 * Sorts a list of manager users by the given key and direction, also sorting each user's notes internally.
 * @param users The users to sort.
 * @param sortKey The column to sort by.
 * @param direction Sort direction.
 * @param colors Used to resolve kind labels for kind-based sorting.
 */
export function sortUsers (
	users: ManagerUser[],
	sortKey: UserNotesManagerSortKey,
	direction: SortDirection,
	colors: UserNoteColor[],
): ManagerUser[] {
	const sorted = users.map((user,) => {
		const notes = [...user.notes,].sort((a, b,) => {
			if (sortKey === 'date') {
				return direction === 'asc' ? a.time - b.time : b.time - a.time
			}
			if (sortKey === 'kind') {
				return compareValues(getKindLabel(colors, a.type,), getKindLabel(colors, b.type,),)
					|| compareValues(b.time, a.time,)
			}
			if (sortKey === 'moderator') {
				return compareValues(a.mod || '', b.mod || '',) || compareValues(b.time, a.time,)
			}
			return b.time - a.time
		},)
		return {...user, notes,}
	},).sort((a, b,) => {
		let result = 0
		if (sortKey === 'username') {
			result = compareValues(a.name, b.name,)
		} else if (sortKey === 'date') {
			const aTime = direction === 'asc' ? oldestNoteTime(a,) : newestNoteTime(a,)
			const bTime = direction === 'asc' ? oldestNoteTime(b,) : newestNoteTime(b,)
			result = compareValues(aTime, bTime,)
		} else if (sortKey === 'kind') {
			result = compareValues(primaryKindLabel(a, colors,), primaryKindLabel(b, colors,),)
		} else if (sortKey === 'noteCount') {
			result = compareValues(a.notes.length, b.notes.length,)
		} else if (sortKey === 'moderator') {
			result = compareValues(primaryModerator(a,), primaryModerator(b,),)
		}
		if (result === 0) { return compareValues(a.name, b.name,) }
		return direction === 'asc' ? result : -result
	},)

	return sorted
}

function shouldPruneNoteByType (note: UserNoteEntry, options: PruneOptions,) {
	if (options.pruneNoteTypeMode === 'all') { return true }
	if (!options.pruneNoteTypes?.length) { return options.pruneNoteTypeMode !== 'include' }
	const selected = options.pruneNoteTypes.includes(normalizeKindKey(note.type,),)
	return options.pruneNoteTypeMode === 'include' ? selected : !selected
}

/**
 * Decides whether a note is eligible for pruning given the archived-handling
 * mode. Shared between the dry-run preview and the real prune executor so the
 * two never diverge.
 * @param note The note to test.
 * @param options Prune rules; only `pruneArchived` is consulted here.
 */
export function shouldPruneNoteByArchived (note: UserNoteEntry, options: PruneOptions,) {
	const mode = options.pruneArchived ?? 'include'
	if (mode === 'only') { return !isNoteActive(note,) }
	if (mode === 'exclude') { return isNoteActive(note,) }
	return true
}

/**
 * Performs a dry-run prune based on age and type rules, returning a preview of what would be removed.
 * Account-status checks (deleted/suspended/inactive) are not performed here; they run during the real prune.
 * @param users The users (keyed by name) to evaluate for pruning.
 * @param options Prune rules (age threshold, note-type filters).
 * @param colors The note-color definitions used to resolve note types.
 * @param now Current timestamp in ms; injectable for testing.
 * @param sampleSize Maximum number of matching note rows to include in the preview.
 */
export function createPrunePreview (
	users: Record<string, UsernotesUser>,
	options: PruneOptions,
	colors: UserNoteColor[],
	now = Date.now(),
	sampleSize = 20,
): PrunePreview {
	const nextUsers = JSON.parse(JSON.stringify(users,),) as Record<string, UsernotesUser>
	const totalNotes = Object.values(nextUsers,).reduce((acc, user,) => acc + user.notes.length, 0,)
	const totalUsers = Object.keys(nextUsers,).length
	const sampleRows: PrunePreviewRow[] = []
	const matched = new Map<string, Set<number>>()
	let prunedNotes = 0
	let prunedUsers = 0

	if (options.pruneByNoteAge) {
		const limit = options.pruneByNoteAgeLimit || daysToMilliseconds(options.pruneByNoteAgeDays ?? 0,)
		const ageThreshold = now - limit
		for (const [username, user,] of Object.entries(nextUsers,)) {
			user.notes = user.notes.filter((note,) => {
				const prune = note.time * 1000 < ageThreshold && shouldPruneNoteByType(note, options,)
					&& shouldPruneNoteByArchived(note, options,)
				if (!prune) { return true }
				// A note is reported as pruned exactly when it enters `matched`, the
				// set that drives the real prune. The codec always assigns an index on
				// load (legacy by position, NXG by repair), so this guard only fires
				// for malformed in-memory data - a note with no index can't be
				// addressed by the apply path, so we must not count, sample, or remove
				// it here either, keeping preview and execution in lockstep.
				if (note.index === undefined) { return true }
				const indexes = matched.get(username,) ?? matched.set(username, new Set(),).get(username,)!
				indexes.add(note.index,)
				prunedNotes += 1
				if (sampleRows.length < sampleSize) {
					sampleRows.push({
						user: username,
						note,
						kindLabel: getKindLabel(colors, note.type,),
					},)
				}
				return false
			},)
			// A user emptied by the age prune keeps their record (with
			// `nextIndex`) so deleted note indexes are never reissued; they
			// still count as pruned for the preview's "would lose all notes".
			if (user.notes.length === 0) {
				prunedUsers += 1
			}
		}
	}

	return {users: nextUsers, prunedNotes, prunedUsers, totalNotes, totalUsers, sampleRows, matched,}
}
