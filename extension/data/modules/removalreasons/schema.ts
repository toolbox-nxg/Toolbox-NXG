/** Shared types and constants for the removal reasons module. */

/** Default Modmail subject line when none is configured, supports token substitution. */
export const defaultSubject = 'Your {kind} was removed from /r/{subreddit}'
/** Default log-post title, supports token substitution. */
export const defaultLogTitle = 'Removed: {kind} by /u/{author} to /r/{subreddit}'

/** How the removal reasons overlay is presented to the moderator. */
export type RemovalReasonsDisplayMode = 'Drawer' | 'Popup (legacy)'

/**
 * Returns true when the given display mode string selects the drawer variant.
 * @param displayMode The raw display mode string from settings.
 */
export function isDrawerDisplayMode (displayMode: string | undefined,) {
	return displayMode?.toLowerCase() === 'drawer'
}

/**
 * The removal-reasons configuration block stored in the subreddit's toolbox wiki config.
 * All fields except `reasons` are optional because older configs may omit them.
 */
export interface RemovalReasonsConfig {
	/** The list of configured removal reasons. */
	reasons: RemovalReason[]
	/** Markdown prepended to every removal message. */
	header?: string
	/** Markdown appended to every removal message. */
	footer?: string
	/**
	 * Name of another subreddit whose removal reasons to use instead.
	 * Resolved recursively by `getRemovalReasons`.
	 */
	getfrom?: string
	/** Subject line template for removal PMs, supports token substitution. */
	pmsubject?: string
	/** Subreddit to post the removal log to. */
	logsub?: string
	/** Title template for the removal log post, supports token substitution. */
	logtitle?: string
	/** Default reason text pre-filled in the log post, supports token substitution. */
	logreason?: string
	/** How the removal option is presented: `'suggest'`, `'force'`, or `'leave'`. */
	removalOption?: string
	/** Default reply type: `'reply'`, `'pm'`, `'both'`, etc. */
	typeReply?: string
	/** Whether the reply is stickied by default. */
	typeStickied?: boolean
	/** Whether the reply locks the removed comment by default. */
	typeLockComment?: boolean
	/** Whether the reply is sent as the subreddit by default. */
	typeCommentAsSubreddit?: boolean
	/** Whether the removal message is sent via modmail as the subreddit by default. */
	typeAsSub?: boolean
	/** Whether modmail threads are auto-archived after sending by default. */
	autoArchive?: boolean
	/** Whether the target thread is locked after removal by default. */
	typeLockThread?: boolean
	/** When true, moderators may edit reason text before sending. */
	editableReasonsEnabled?: boolean
	/**
	 * Mappings from a report reason to removal reason(s), so a matching report
	 * pre-selects (and optionally one-click applies) those reasons in the queue.
	 * NXG-only; stripped from the legacy v1 mirror in `encodeClassicConfig`.
	 */
	suggestedReasons?: SuggestedReasonMapping[]
	/**
	 * State for the one-way import of Reddit's native removal reasons into this
	 * config. NXG-only; stripped from the legacy v1 mirror in `encodeClassicConfig`.
	 */
	nativeSync?: NativeReasonSyncState
}

/**
 * Per-subreddit state for syncing Reddit's native removal reasons into the toolbox
 * config. The sync is one-way: Reddit owns each linked reason's title and message,
 * while the toolbox-only extras (flair, usernote defaults, post/comment applicability)
 * stay under moderator control.
 *
 * This lives in the wiki config rather than in per-user settings on purpose: the
 * fingerprint is shared, so the first moderator to notice a change upstream performs
 * the single write and everyone else sees it already applied.
 */
export interface NativeReasonSyncState {
	/**
	 * Whether the sync is enabled for this subreddit. Only ever written as `true` -
	 * turning the sync off removes this whole block rather than writing `false`, and
	 * takes the imported reasons with it, so re-enabling is always a full re-import.
	 */
	enabled?: boolean
	/**
	 * Digest of the native reason set as of the last applied sync, used to skip the
	 * merge entirely when nothing upstream has changed. Deliberately order-independent
	 * (see `nativeReasonsFingerprint`), so it changes only when a merge would do work.
	 */
	fingerprint?: string
	/**
	 * Epoch milliseconds of the last sync that actually changed something; displayed in
	 * the editor. Not a last-checked time: checks that find nothing new return without
	 * writing, so this stands still while the sync is working normally.
	 */
	lastSyncedAt?: number
	/**
	 * Native reason ids a moderator deleted locally. They are never re-imported, so
	 * deleting a synced reason in the toolbox editor sticks instead of reappearing on
	 * the next sync. Cleared along with the rest of this block when the sync is turned
	 * off, which is how a moderator undoes an ignore they did not mean.
	 */
	ignored?: string[]
}

/**
 * Maps a report reason to one or more removal reasons. When a queue item carries a
 * report whose text matches {@link pattern}, the referenced reasons are pre-selected
 * in the removal overlay.
 */
export interface SuggestedReasonMapping {
	/** Stable identifier (assigned by `ensureStableIds`); optional because hand-edited configs may omit it. */
	id?: string
	/** The report-reason text to look for, matched as a case-insensitive substring. */
	pattern: string
	/** When true, user reports are also matched; otherwise only mod/bot reports are considered. */
	includeUserReports?: boolean
	/** Stable ids of the removal reasons to suggest. */
	reasonIds: string[]
}

/** A single configured removal reason. */
export interface RemovalReason {
	/**
	 * Stable identifier (schema v2+), assigned by `ensureStableIds` and stripped
	 * from the classic v1 mirror. Optional because runtime data may predate it.
	 */
	id?: string
	/**
	 * Markdown body of the removal message. May contain substitution tokens
	 * (`{subreddit}`, ...) and interactive fill-in tokens (`{input: ...}`,
	 * `{textarea: ...}`, and a `{choice}` block whose options are the markdown
	 * list below the marker).
	 */
	text: string
	title: string
	/** When false, this reason is hidden for posts. */
	removePosts?: boolean
	/**
	 * Tri-state comment applicability: `true` always shows the reason for
	 * comments, absent defers to the mod's "enable removal reasons for
	 * comments" setting, and explicit `false` (written by 6.x saves, never by
	 * the NXG editor) always hides it.
	 */
	removeComments?: boolean
	flairText: string
	flairCSS: string
	flairTemplateID: string
	/** When true, the moderator may edit this reason's text before sending. */
	editable?: boolean
	/** Default note text to pre-fill when this reason is selected. */
	default_note?: string
	/** Key of the usernote type (UserNoteColor.key) to pre-select. */
	default_note_type?: string
	/**
	 * Reddit's reason id, set when this reason comes from Reddit's own removal reasons
	 * rather than being written in toolbox. It is registered against the removed item
	 * via the modactions API on submit, so the removal also lands in Reddit's mod log.
	 *
	 * Set on two kinds of reason: the ephemeral ones synthesized when a subreddit has no
	 * toolbox reasons at all (see the `nativeReasonsFallback` setting), and the persisted
	 * ones imported by the opt-in sync (see {@link NativeReasonSyncState}). On a persisted
	 * reason it is the sync link, so it must survive edits and the legacy mirror
	 * round-trip - dropping it orphans the reason and the next sync re-imports a duplicate.
	 */
	nativeReasonId?: string
}

/** Runtime context data for a thing being removed, passed to the overlay. */
export interface RemovalReasonsData {
	subreddit: string
	/** Reddit fullname (e.g. `t3_abc123`). */
	fullname: string
	/** Bare base-36 id (e.g. `abc123`); handy for building URLs. */
	id: string
	author: string
	/** Post or comment title (empty string for comments). */
	title: string
	/** `'submission'` or `'comment'`. */
	kind: string
	/** Username of the acting moderator. */
	mod: string
	/** Permalink of the thing. */
	url: string
	/** Submission link (same as url for posts; parent post link for comments). */
	link: string
	domain: string
	/** Rendered plain-text body. */
	body: string
	/** Raw markdown body. */
	raw_body: string
	/** URL-encoded body. */
	uri_body: string
	/** URL-encoded title. */
	uri_title: string
	/** Subject line for Modmail delivery, may contain tokens. */
	subject: string
	/** Pre-filled log reason text. */
	logReason: string
	/** Header markdown prepended to the message. */
	header: string
	/** Footer markdown appended to the message. */
	footer: string
	/** Log subreddit name, if removal logging is configured. */
	logSub: string
	/** Title template for the log post. */
	logTitle: string
	/**
	 * The subreddit's display title, for Reddit's `{community_name}` macro. Fetched only when
	 * a reason actually uses one of the community macros, so it is absent on most removals -
	 * and an absent value leaves the macro as literal text rather than blanking it.
	 */
	communityTitle?: string
	/** The subreddit's public description, for Reddit's `{community_description}` macro. */
	communityDescription?: string
	/**
	 * The subreddit's rules in moderator-configured order, for Reddit's positional
	 * `{community_rule_1}` macros. Each entry is already rendered as the macro presents it.
	 */
	communityRules?: string[]
	/** How delivery settings apply to other mods: `'suggest'`, `'force'`, or `'leave'`. */
	removalOption?: string
	typeReply?: string
	typeStickied?: boolean
	typeCommentAsSubreddit?: boolean
	typeLockComment?: boolean
	/** Whether to send via modmail as the subreddit. */
	typeAsSub?: boolean
	autoArchive?: boolean
	typeLockThread?: boolean
	reasons: RemovalReason[]
	editableReasonsEnabled?: boolean
}

/** Personal default delivery settings applied when the subreddit leaves options up to each moderator. */
export interface RemovalReasonsOverlaySettings {
	/** Default delivery method from the module settings selector. */
	reasonTypeSetting: string
	reasonAsSubSetting: boolean
	reasonAutoArchiveSetting: boolean
	reasonStickySetting: boolean
	reasonCommentAsSubredditSetting: boolean
	actionLockSetting: boolean
	actionLockCommentSetting: boolean
}
