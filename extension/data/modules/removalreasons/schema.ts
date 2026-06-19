/** Shared types and constants for the removal reasons module. */

import type {SelectDefinition,} from '../../util/wiki/schemas/shared/tokens'

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
	 * `{textarea: ...}`, and `{select:name}` references into {@link selects}).
	 */
	text: string
	title: string
	/**
	 * Named select definitions referenced from {@link text} as `{select:name}`.
	 * Edited in the reason editor's select builder; expanded to legacy
	 * `<select>` HTML on the classic v1 mirror. Omitted when the reason has
	 * none.
	 */
	selects?: SelectDefinition[]
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
