/** Schema constants and types for Reddit mod notes, including display names and label colors. */

/** Maps API note type strings to human-readable display names. */
export const typeNames: Record<string, string> = {
	NOTE: 'Note',
	APPROVAL: 'Approve',
	REMOVAL: 'Remove',
	BAN: 'Ban',
	MUTE: 'Mail Mute',
	INVITE: 'Invite',
	SPAM: 'Spam',
	CONTENT_CHANGE: 'Update Post',
	MOD_ACTION: 'Mod Action',
}

/** Maps label type strings to CSS color values for display. */
export const labelColors: Record<string, string> = {
	BOT_BAN: 'black',
	PERMA_BAN: 'darkred',
	BAN: 'red',
	ABUSE_WARNING: 'orange',
	SPAM_WARNING: 'purple',
	SPAM_WATCH: 'fuchsia',
	SOLID_CONTRIBUTOR: 'green',
	HELPFUL_USER: 'lightseagreen',
	USER_SUMMARY: 'darkgray',
}

/** Maps label type strings to human-readable display names. */
export const labelNames: Record<string, string> = {
	BOT_BAN: 'Bot Ban',
	PERMA_BAN: 'Permaban',
	BAN: 'Ban',
	ABUSE_WARNING: 'Abuse Warning',
	SPAM_WARNING: 'Spam Warning',
	SPAM_WATCH: 'Spam Watch',
	SOLID_CONTRIBUTOR: 'Solid Contributor',
	HELPFUL_USER: 'Helpful User',
	USER_SUMMARY: 'AI-generated user summary',
}

/** Like `labelNames` but with the auto-generated `USER_SUMMARY` label excluded (not user-selectable). */
export const selectableLabelNames: Record<string, string> = Object.fromEntries(
	Object.entries(labelNames,).filter(([value,],) => value !== 'USER_SUMMARY'),
)

/** Maps `defaultNoteLabel` setting values to API label type strings. */
export const defaultNoteLabelValueToLabelType: Record<string, string | undefined> = {
	none: undefined,
	bot_ban: 'BOT_BAN',
	permaban: 'PERMA_BAN',
	ban: 'BAN',
	abuse_warning: 'ABUSE_WARNING',
	spam_warning: 'SPAM_WARNING',
	spam_watch: 'SPAM_WATCH',
	solid_contributor: 'SOLID_CONTRIBUTOR',
	helpful_user: 'HELPFUL_USER',
}

/**
 * Maps Toolbox usernote type keys to API label type strings, for seeding a native
 * note's label from a removal reason's `default_note_type`. Covers the built-in
 * types only (`defaultUsernoteTypes`); a subreddit's custom key has no Reddit
 * counterpart and resolves to `undefined`, which leaves the note unlabelled.
 */
export const usernoteTypeToLabelType: Record<string, string | undefined> = {
	gooduser: 'SOLID_CONTRIBUTOR',
	spamwatch: 'SPAM_WATCH',
	spamwarn: 'SPAM_WARNING',
	abusewarn: 'ABUSE_WARNING',
	ban: 'BAN',
	permban: 'PERMA_BAN',
	botban: 'BOT_BAN',
}

/**
 * Reverse of {@link usernoteTypeToLabelType}, for carrying a chosen label back to a
 * Toolbox note type when a note's destination is switched to the wiki. Reddit's
 * `USER_SUMMARY` label is auto-generated and has no Toolbox counterpart, so it is
 * absent and resolves to `undefined` (the note keeps no type).
 */
export const labelTypeToUsernoteType: Record<string, string | undefined> = Object.fromEntries(
	Object.entries(usernoteTypeToLabelType,)
		.filter((entry,): entry is [string, string,] => entry[1] !== undefined)
		.map(([type, label,],) => [label, type,]),
)

/**
 * Character limit Reddit enforces on a mod note's body. A longer note is rejected
 * outright, so writers truncate to this rather than let the call fail.
 */
export const maxNativeNoteLength = 250

/** User-note-specific fields on a mod note. */
export interface ModNoteUserNoteData {
	/** Free-text note body. */
	note: string
	/** Label type string (e.g. `'BAN'`), or null. */
	label: string | null
	/** Fullname of the Reddit item this note is attached to, or null. */
	reddit_id: string | null
}

/** Mod-action-specific fields on a mod note. */
export interface ModNoteModActionData {
	/** The mod action taken (e.g. `'removelink'`). */
	action: string
	details: string | null
	description: string | null
	/** Fullname of the Reddit item the action was taken on, or null. */
	reddit_id: string | null
}

/** A single mod note as returned by the Reddit API. */
export interface ModNote {
	id: string
	created_at: number
	type: string
	operator: string
	subreddit: string
	user: string
	label: string | null
	description: string | null
	details: string | null
	user_note_data: ModNoteUserNoteData | null
	mod_action_data: ModNoteModActionData | null
}

/** An in-flight batch request for a user's latest mod note, held in the deferred queue. */
export interface PendingNoteRequest {
	subreddit: string
	user: string
	/** Resolves the promise with the fetched note or null when none exists. */
	resolve: (value: ModNote | null,) => void
	reject: (reason?: unknown,) => void
}
