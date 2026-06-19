/** TypeScript schema definitions for the Mod Macros module. */

/**
 * Normalized metadata about a Reddit post or comment, used as the token-replacement context
 * when rendering macro text before posting.
 */
export interface ThingInfo {
	subreddit: string
	user: string
	author: string
	permalink: string
	url: string
	domain: string
	/** The bare base-36 id (e.g. `abc123`) of the target post or comment; handy for building URLs. */
	id: string
	/** The fullname (e.g. `t1_abc123`) of the target post or comment. */
	fullname: string
	body: string
	raw_body: string
	/** URL-encoded version of the body text. */
	uri_body: string
	approved_by: string
	title: string
	/** URL-encoded version of the title. */
	uri_title: string
	/** The Reddit thing type: `'link'`, `'comment'`, etc. */
	kind: string
	postlink: string
	link: string
	banned_by: string | null
	spam: string | boolean
	ham: string | boolean
	/** URL of the subreddit's rules page. */
	rules: string
	/** URL of the subreddit's sidebar. */
	sidebar: string
	/** URL of the subreddit's wiki index. */
	wiki: string
	/** Username of the acting moderator. */
	mod: string
	[key: string]: unknown
}

/** A single macro entry as stored in the subreddit's toolbox wiki config. */
export interface MacroConfig {
	/**
	 * Stable identifier (schema v2+), assigned by `ensureStableIds` and stripped
	 * from the classic v1 mirror. Optional because runtime data may predate it.
	 */
	id?: string
	/** The macro reply text (supports markdown and token replacement). */
	text: string
	title?: string
	remove?: boolean
	approve?: boolean
	spam?: boolean
	ban?: boolean
	unban?: boolean
	mute?: boolean
	/** Flair template ID to apply to the post/comment author. */
	userflair?: string
	/** Display text for the flair template. */
	userflairtext?: string
	/** Lock the target post or comment thread. */
	lockthread?: boolean
	/** Lock the reply posted by this macro. */
	lockreply?: boolean
	/** Sticky the macro reply (only effective on top-level comments). */
	sticky?: boolean
	archivemodmail?: boolean
	highlightmodmail?: boolean
	/** Distinguish the macro reply as a moderator comment. */
	distinguish?: boolean
	/** Post the reply as the subreddit ModTeam account via official removal message. */
	replyassubreddit?: boolean
	/** Show this macro in post contexts; defaults to `true` when absent. */
	contextpost?: boolean
	/** Show this macro in comment contexts; defaults to `true` when absent. */
	contextcomment?: boolean
	/** Show this macro in modmail contexts; defaults to `true` when absent. */
	contextmodmail?: boolean
}
