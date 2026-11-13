/** Domain types and visibility rules for the Native Mod Log module. */

import type {ModNote,} from '../shared/modnotes/schema'

/** Which kinds of native mod log entry the moderator has chosen to see. */
export interface EntryVisibility {
	/** Show Reddit's auto-generated `USER_SUMMARY` notes. */
	showAiSummaries: boolean
	/** Show mod-action entries (anything whose type is not `NOTE`). */
	showModActions: boolean
}

/** Label Reddit gives its AI-generated user summary "notes". */
export const aiSummaryLabel = 'USER_SUMMARY'

/** True when the entry is one of Reddit's AI-generated user summaries. */
export function isAiSummary (note: ModNote,): boolean {
	return note.user_note_data?.label === aiSummaryLabel
}

/**
 * Decides whether a native mod log entry should be shown, given the moderator's
 * visibility settings. Shared by the NN tag and the popup history so both always
 * agree on what counts as hidden.
 */
export function isEntryVisible (note: ModNote, {showAiSummaries, showModActions,}: EntryVisibility,): boolean {
	if (!showAiSummaries && isAiSummary(note,)) { return false }
	if (!showModActions && note.type !== 'NOTE') { return false }
	return true
}

/** Tabs of the native mod log popup, keyed the way the `defaultTabName` selector stores them. */
export type ModLogTabKey = 'all_activity' | 'notes' | 'mod_actions'

/** One tab of the native mod log popup: its key, title, and the API type filter it requests. */
export interface ModLogTab {
	key: ModLogTabKey
	title: string
	/** Note-type filter passed to the API; omitted for the unfiltered "All Activity" view. */
	filter?: string
}

const allTabs: readonly ModLogTab[] = [
	{key: 'all_activity', title: 'All Activity',},
	{key: 'notes', title: 'Notes', filter: 'NOTE',},
	{key: 'mod_actions', title: 'Mod Actions', filter: 'MOD_ACTION',},
]

/**
 * Returns the popup tabs to show. With mod actions hidden, "All Activity" would
 * hold only notes and "Mod Actions" would be empty, so just the Notes tab remains.
 */
export function visibleTabs (showModActions: boolean,): readonly ModLogTab[] {
	return showModActions ? allTabs : allTabs.filter((tab,) => tab.key === 'notes')
}

/** Index of the tab to open first, falling back to the first tab when the preferred one is hidden. */
export function defaultTabIndex (tabs: readonly ModLogTab[], preferred: string,): number {
	const index = tabs.findIndex((tab,) => tab.key === preferred)
	return index === -1 ? 0 : index
}

/**
 * Layout for a popup tab's entry list. Only the Notes tab is configurable: it defaults to cards,
 * and the `notesTabLayout` setting can switch it to the table the other tabs use. Returns
 * undefined to leave the list on its own default.
 */
export function tabLayout (tab: ModLogTab, notesTabLayout: string,): 'table' | undefined {
	return tab.key === 'notes' && notesTabLayout === 'table' ? 'table' : undefined
}

/** Longest ban Reddit allows in days; anything longer has to be a permanent ban. */
export const maxBanDays = 999

/** True for a ban length Reddit accepts: a whole number of days from 1 to 999. */
export function isValidBanDays (days: number,): boolean {
	return Number.isInteger(days,) && days >= 1 && days <= maxBanDays
}

/**
 * Compiles the mod's ban duration pattern (the `banNoteDuration` setting), matched without case.
 * @returns The pattern, `undefined` when none is set, or `'invalid'` when it does not compile,
 * so a typo in the setting never breaks the note composer.
 */
export function compileBanDurationPattern (pattern: unknown,): RegExp | 'invalid' | undefined {
	if (typeof pattern !== 'string' || !pattern.trim()) { return undefined }
	try {
		// `d` records where the days sit in the note, so they can be rewritten there.
		return new RegExp(pattern, 'id',)
	} catch {
		return 'invalid'
	}
}

/** What a note says about the ban length, read with the mod's ban duration pattern. */
export type NoteBanDays =
	| {kind: 'none'}
	| {kind: 'days'; days: number}
	/**
	 * A whole number of days longer than Reddit allows. The note may record it, but the ban
	 * itself can be at most `maxBanDays`, and only once the mod has confirmed that.
	 */
	| {kind: 'overMax'; days: number}
	/** The pattern matched, but not a ban length Reddit accepts; `text` is what it matched. */
	| {kind: 'invalid'; text: string}

/** The part of a note that the pattern reads as the ban length, and where it sits in the note. */
interface DaysText {
	text: string
	start: number
	end: number
}

/**
 * Finds the ban length in a note: the pattern's first capture group, or the whole match when it
 * has no group, without surrounding whitespace.
 * @returns `undefined` when the pattern does not match, or its group took no part in the match.
 */
function findDaysText (note: string, pattern: RegExp,): DaysText | undefined {
	// Positions need the `d` flag; add it here so any pattern can be used.
	const withIndices = pattern.hasIndices ? pattern : new RegExp(pattern.source, `${pattern.flags}d`,)
	const match = withIndices.exec(note,)
	const span = match?.indices?.[match.length > 1 ? 1 : 0]
	if (!span) { return undefined }
	const raw = note.slice(span[0], span[1],)
	const text = raw.trim()
	const start = span[0] + (raw.length - raw.trimStart().length)
	return {text, start, end: start + text.length,}
}

/**
 * Reads a ban length from a note. The pattern's first capture group holds the days (the whole
 * match when it has no group), and it must be plain digits: 1-999 is a ban length, and more
 * than 999 is `overMax` (a note can say it, a ban cannot be that long).
 * @param note The note text.
 * @param pattern A pattern from `compileBanDurationPattern`.
 */
export function banDaysFromNote (note: string, pattern: RegExp,): NoteBanDays {
	const found = findDaysText(note, pattern,)
	if (!found) { return {kind: 'none',} }
	const {text,} = found
	const days = /^\d+$/.test(text,) ? Number(text,) : NaN
	if (isValidBanDays(days,)) { return {kind: 'days', days,} }
	// Safe integers only, so the number shown back to the mod is exactly what the note says.
	if (Number.isSafeInteger(days,) && days > maxBanDays) { return {kind: 'overMax', days,} }
	return {kind: 'invalid', text,}
}

/**
 * Rewrites the ban length in a note, so a length the mod set elsewhere (the days field or a ban
 * macro) and the note never disagree. Only the text the pattern reads as the length changes.
 * @param note The note text.
 * @param pattern A pattern from `compileBanDurationPattern`.
 * @param days The new ban length.
 * @param maxLength Longest note allowed; a rewrite that would not fit is not made.
 * @returns The rewritten note, or `undefined` when the note has no length to rewrite, or the
 * rewrite would not fit or would not read back as `days`.
 */
export function writeBanDaysToNote (
	note: string,
	pattern: RegExp,
	days: number,
	maxLength: number,
): string | undefined {
	const found = findDaysText(note, pattern,)
	if (!found) { return undefined }
	const rewritten = `${note.slice(0, found.start,)}${days}${note.slice(found.end,)}`
	if (rewritten.length > maxLength) { return undefined }
	// A pattern can match differently once the text changes; only keep a rewrite that reads back right.
	const reread = banDaysFromNote(rewritten, pattern,)
	return reread.kind === 'days' && reread.days === days ? rewritten : undefined
}
