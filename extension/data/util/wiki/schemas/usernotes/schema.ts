/** Type definitions and constants for the usernotes wiki data format (schema v6). */

/** Current (write) schema version. */
export const notesSchema = 6
/** Minimum schema version this build can read. */
export const notesMinSchema = 6
/** Maximum schema version this build can read. */
export const notesMaxSchema = 6

export interface UserNoteColor {
	key: string
	text: string
	color: string
	/** Color used in dark mode. Falls back to `color` when absent. */
	colorDark?: string
	/** If set, auto-ban is offered when leaving this note type. 0 = permanent, positive integer = days. */
	banDuration?: number
	/** If set, notes of this type older than this many days (0 = immediately) are archived during saves. */
	autoArchiveDays?: number
}

/** Attribution for an archive action: who archived the note and when (epoch seconds). */
export interface NoteAttribution {
	by: string
	at: number
}

/**
 * Sentinel `archived.by` value for notes archived because they were deleted
 * on the legacy 6.x wiki page - a page diff cannot attribute the acting mod.
 * Brackets cannot appear in reddit usernames, so this can't collide.
 * Rendered in the UI as "archived via 6.x delete".
 */
export const LEGACY_DELETION_ARCHIVER = '[6.x]'

/**
 * Sentinel `archived.by` value for notes archived automatically by the
 * per-type auto-archive sweep that runs on save. Brackets cannot appear in
 * reddit usernames, so this can't collide. Rendered in the UI as
 * "auto-archived".
 */
export const AUTO_ARCHIVER = '[auto]'

/**
 * Renders a human-readable actor for an archive/delete attribution, mapping the sentinel
 * archiver values to friendly phrases and otherwise formatting the acting mod's username.
 * @param by The `archived.by` value (a username or one of the archiver sentinels).
 */
export function formatArchiveAttribution (by: string,): string {
	return by === LEGACY_DELETION_ARCHIVER
		? 'via 6.x delete'
		: by === AUTO_ARCHIVER
		? 'automatically'
		: `by /u/${by || 'unknown'}`
}

/** A usernote as displayed/edited in the popup, addressed by its per-user index. */
export interface ExistingNote {
	/** The note's stable per-user `index`. */
	id: number
	/** Note type key, or empty string for no type. */
	type: string
	note: string
	/** Username of the moderator who created the note. */
	mod: string
	/** Creation timestamp in epoch seconds. */
	time: number
	link?: string
	/** Full URL of the removal message (modmail) sent alongside this note, if any. */
	messageLink?: string
	/** Set when the note is archived (hidden but kept). */
	archived?: NoteAttribution
}

/** A single usernote entry as stored in the wiki data. */
export interface UserNoteEntry {
	/**
	 * Stable per-user note index, assigned from the user's `nextIndex` at
	 * creation and never reused. `(username, index)` is the unambiguous note
	 * address for third-party tools. Ephemeral (position-derived) for data
	 * read from legacy v6 pages; durable once stored in the NXG layout.
	 */
	index?: number
	note: string
	type?: string
	/** Username of the moderator who created the note. */
	mod: string
	/** Creation timestamp in epoch seconds. */
	time: number
	link?: string
	/**
	 * Full URL of the removal message (modmail) sent alongside this note, if
	 * any. NXG-only: the legacy v6 page has a single squashed link slot, so
	 * the derived legacy mirror drops this field.
	 */
	messageLink?: string
	/** Set when the note is archived (hidden by default but kept). */
	archived?: NoteAttribution
}

/** Returns `true` when a note is not archived. */
export function isNoteActive (note: UserNoteEntry,): boolean {
	return note.archived === undefined
}

/** The fully inflated usernotes data structure for a subreddit. */
export interface UserNotesData {
	ver: number
	users: Record<string, UsernotesUser>
	/**
	 * Usernote type definitions. The NXG usernotes manifest embeds these,
	 * making the sharded layout self-contained; legacy v6 pages get them
	 * seeded from the subreddit config (`usernoteColors`) or the built-in
	 * defaults on load.
	 */
	types?: UserNoteColor[]
	/** True when the data was found to contain malformed entries that were silently dropped on load. */
	corrupted?: boolean
}

/** All notes for a single Reddit user within a subreddit. */
export interface UsernotesUser {
	name: string
	notes: UserNoteEntry[]
	/**
	 * The next note `index` to assign for this user. Persisted (not derived)
	 * so indexes are never reused, even after notes are deleted or pruned.
	 */
	nextIndex?: number
}

/**
 * How archived notes are treated by an operation that filters or selects notes
 * (the browse filter and the prune executor share this vocabulary):
 * - `'include'`: archived and active notes alike.
 * - `'exclude'`: only active notes; archived ones are skipped/hidden.
 * - `'only'`: only archived notes.
 */
export type ArchivedMode = 'include' | 'exclude' | 'only'

/** Configuration for a usernote prune operation. */
export interface PruneOptions {
	pruneByNoteAge: boolean
	/** Maximum note age threshold in milliseconds. */
	pruneByNoteAgeLimit: number
	/** Age limit expressed in days, used for display. */
	pruneByNoteAgeDays?: number
	/** How the `pruneNoteTypes` list is applied: include only those kinds, exclude them, or prune all kinds. */
	pruneNoteTypeMode?: 'all' | 'include' | 'exclude'
	/** Type keys to include or exclude, depending on `pruneNoteTypeMode`. */
	pruneNoteTypes?: string[]
	/**
	 * How archived notes are treated during pruning:
	 * - `'include'` (default): archived and non-archived notes are both eligible for pruning.
	 * - `'exclude'`: archived notes are skipped and kept regardless of other criteria.
	 * - `'only'`: only archived notes are eligible for pruning.
	 */
	pruneArchived?: ArchivedMode
	/**
	 * What happens to notes that match the prune criteria:
	 * - `'delete'` (default): matching notes are permanently removed. On NXG storage, empty user
	 *   records are retained so their `nextIndex` is preserved; on legacy v6 storage they are removed.
	 * - `'purge'`: like delete, but empty user records are also removed on NXG storage.
	 * - `'archive'`: matching notes are marked as archived instead of deleted.
	 */
	pruneAction?: 'delete' | 'purge' | 'archive'
	pruneByUserDeleted: boolean
	pruneByUserSuspended: boolean
	pruneByUserInactivity: boolean
	/** Inactivity threshold in milliseconds; users with no posts/comments newer than this are pruned. */
	pruneByUserInactivityLimit: number
}

/** Progress update emitted during a prune operation for display in the UI. */
export interface PruneProgress {
	stage: 'preparing' | 'checkingUsers' | 'rateLimited' | 'confirming' | 'saving' | 'complete'
	checkedUsers?: number
	totalUsers?: number
	/** Username currently being checked, for display during account-status checks. */
	currentUser?: string
	message: string
}

/** Compact on-disk representation of a single usernote (deflated form). */
export interface DeflatedNote {
	n: string
	t: number
	m: number
	l: string
	w: number
}

/** Compact on-disk representation of a user's notes. */
export interface DeflatedUser {
	ns: DeflatedNote[]
}

/** Constant pools used to compress repeated strings in the deflated format. */
export interface ConstantPools {
	users: string[]
	warnings: string[]
}

/** Usernotes data after blob decompression but before inflation. */
export interface DecompressedBlob {
	ver: 6
	constants: ConstantPools
	users: Record<string, DeflatedUser>
}

/** Usernotes data as stored on-disk in schema v6 (users blob-compressed, constants plain). */
export interface RawUsernotesBlob {
	ver: 6
	blob: string
	constants: ConstantPools
}

/** Format marker for NXG usernotes shard pages. */
export const NXG_USERNOTES_FORMAT = 'nxg-usernotes'

/** Current NXG usernotes shard schema version. */
export const NXG_USERNOTES_VER = 1

/** An NXG usernotes shard page: a small envelope around the compressed payload. */
export interface NxgUsernotesShardPage {
	format: typeof NXG_USERNOTES_FORMAT
	ver: typeof NXG_USERNOTES_VER
	/** base64(zlib(payload JSON)) - see {@link NxgShardPayload}. */
	blob: string
}

/**
 * A note inside the NXG shard payload. Human-readable on purpose: named keys,
 * the mod inline (zlib makes string pooling pointless), epoch-second times, and
 * full subreddit-relative permalinks. `type`/`link`/`archived` are omitted
 * when empty.
 */
export interface NxgShardNote {
	index: number
	note: string
	/** Creation timestamp in epoch seconds. */
	time: number
	/** Username of the moderator who created the note. */
	mod: string
	type?: string
	/** Subreddit-relative permalink, e.g. `/r/sub/comments/abc/-/def/`. */
	link?: string
	/** Full URL of the removal message (modmail) sent alongside this note. */
	messageLink?: string
	archived?: NoteAttribution
}

/** One user's record inside the NXG shard payload. */
export interface NxgShardUserRecord {
	/** The next note index to assign; persisted so indexes are never reused. */
	nextIndex: number
	notes: NxgShardNote[]
}

/** The decompressed NXG shard payload: username -> user record, names sorted. */
export type NxgShardPayload = Record<string, NxgShardUserRecord>

/**
 * Built-in usernote type definitions used when a subreddit has no custom
 * configuration. The dark colors match what classic toolbox's dark-mode
 * CSS filter (`invert(90%) hue-rotate(180deg)`) produces for the light
 * colors, except `abusewarn`, which is hand-tuned for readability (the
 * filter output `#9e5600` is too dim on dark backgrounds).
 */
export const defaultUsernoteTypes: UserNoteColor[] = [
	{key: 'gooduser', color: 'green', colorDark: '#53b953', text: 'Good Contributor',},
	{key: 'spamwatch', color: 'fuchsia', colorDark: '#ff71ff', text: 'Spam Watch',},
	{key: 'spamwarn', color: 'purple', colorDark: '#ffabff', text: 'Spam Warning',},
	{key: 'abusewarn', color: 'orange', colorDark: '#ffb347', text: 'Abuse Warning',},
	{key: 'ban', color: 'red', colorDark: '#ff8f8f', text: 'Ban', banDuration: 7,},
	{key: 'permban', color: 'darkred', colorDark: '#ffb6b6', text: 'Permanent Ban', banDuration: 0,},
	{key: 'botban', color: 'black', colorDark: '#e6e6e6', text: 'Bot Ban',},
]
