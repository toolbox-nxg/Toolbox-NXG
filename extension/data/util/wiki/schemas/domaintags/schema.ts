/** Schema version constants, types, and defaults for the standalone domain tags wiki page. */

/** The current domain tags schema version written to new wiki pages. */
export const domainTagsSchema = 1
/** The minimum domain tags schema version this build can read. */
export const domainTagsMinSchema = 1
/** The maximum domain tags schema version this build can read. */
export const domainTagsMaxSchema = 1

/**
 * A color tag configuration entry for a single domain or glob pattern,
 * stored on the subreddit's dedicated `toolbox-nxg/domain-tags` wiki page.
 */
export interface DomainTag {
	/** The domain name or glob pattern to match (e.g. `i.imgur.com`, `*.blogspot.com`). */
	name: string
	/** The color to apply, as a CSS hex string or `'none'` to indicate removal. */
	color: string
	/** Optional free-text note shown in the tag popup and as a tooltip on the indicator. */
	note?: string
	/** Cumulative count of posts from this domain approved in this subreddit. */
	approvalCount: number
	/** Cumulative count of posts from this domain removed in this subreddit. */
	removalCount: number
	/**
	 * Optional removal-rate alert threshold (0-100, percent).
	 * When `removalCount / (approvalCount + removalCount) >= removalThreshold / 100`
	 * the tag indicator switches to a warning color regardless of the tag color.
	 */
	removalThreshold?: number
}

/** The full shape of the domain tags data stored on the subreddit's wiki page. */
export interface DomainTagsData {
	/** Schema version; reserved for future migrations. */
	ver: number
	/**
	 * When `true`, approval and removal counts are displayed inline in the tag
	 * indicator on posts. Toggled per-subreddit in the Domain Tags settings tab.
	 */
	showCounts: boolean
	/** The list of configured domain tags for this subreddit. */
	tags: DomainTag[]
}

/** Default empty domain tags data used when a subreddit has no existing wiki page. */
export const defaultDomainTagsData: DomainTagsData = {
	ver: domainTagsSchema,
	showCounts: false,
	tags: [],
}
