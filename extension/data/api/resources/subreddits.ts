/** API functions for subreddit metadata, rules, mod logs, and relationship listings. */

import {apiOauthGetJSON,} from '../transport/http'
import type {QueryParams,} from '../transport/http'

/**
 * A Reddit listing response. The generic parameter `T` narrows the `children` element type;
 * use `unknown` when callers inspect the children dynamically.
 */
export interface RedditListing<T = unknown,> {
	kind: 'Listing'
	data: {
		children: T[]
		after: string | null
		before: string | null
	}
}

/**
 * Fetches moderation log entries using a pre-constructed subreddit path.
 * The generic parameter `T` narrows the element type of `data.children`.
 * @param subredditPath A path like `/r/sub/` (with trailing slash).
 * @param query Optional query parameters for the request.
 */
// Accepts a pre-built path rather than a subreddit name because the modlog queue
// module constructs its own multi-sub paths (e.g. `/r/sub1+sub2/`).
export const getModLogByPath = <T = unknown,>(subredditPath: string, query?: QueryParams,): Promise<RedditListing<T>> =>
	apiOauthGetJSON<RedditListing<T>>(`${subredditPath}about/log.json`, query,)

/**
 * Fetches moderation log entries for a subreddit.
 * The generic parameter `T` narrows the element type of `data.children`.
 */
export const getModLog = <T = unknown,>(subreddit: string, query?: QueryParams,): Promise<RedditListing<T>> =>
	getModLogByPath<T>(`/r/${subreddit}/`, query,)

/**
 * The fields every Reddit mod-log entry (`/r/{sub}/about/log`) exposes, shared by the per-caller
 * projections passed to {@link getModLogEntries}. Each feature extends this with the additional
 * fields it reads (e.g. `target_fullname`, `target_author`), so the common core is declared once.
 */
export interface RedditModLogEntry {
	/** API action type code (e.g. `removelink`, `banuser`). */
	action: string
	/** Username of the moderator who performed the action. */
	mod: string
	/** Unix timestamp of the action in seconds. */
	created_utc: number
}

/**
 * Fetches a window of a subreddit's mod log and unwraps the {@link RedditListing} to its child
 * entries. Reddit wraps each listing child as `{data: ...}`, so the entries come from `child.data`; the
 * generic `T` is the per-caller projection of those entries. Centralizes the fetch + unwrap so the
 * inline mod-actions store/popup and the modbar's cross-sub "Recent actions" drawer don't each
 * re-derive it (nor cast the listing to `any`).
 * @param subreddit Bare subreddit name (no `r/` prefix), or `'mod'` for all moderated subs.
 * @param limit How many entries to request (Reddit's natural order, most-recent first).
 */
export async function getModLogEntries<T,> (subreddit: string, limit = '100',): Promise<T[]> {
	const {data,} = await getModLog<{data: T}>(subreddit, {limit, raw_json: '1',},)
	return data.children.map((child,) => child.data)
}

/**
 * Fetches a subreddit's about listing (moderators, banned, muted, modqueue, unmoderated, etc.).
 * The generic parameter `T` narrows the element type of `data.children`.
 */
export const getSubredditListing = <T = unknown,>(
	subreddit: string,
	page: string,
	query?: QueryParams,
): Promise<RedditListing<T>> => apiOauthGetJSON<RedditListing<T>>(`/r/${subreddit}/about/${page}.json`, query,)

/**
 * Fetches the modqueue or unmoderated listing for one or more subreddits.
 * The generic parameter `T` narrows the element type of `data.children`.
 * @param options Query options.
 * @param subreddits A `+`-joined list of subreddit names (e.g. `sub1+sub2`).
 * @param page Which queue to fetch.
 * @param limit Maximum number of items to return.
 */
export function getModerationQueueListing<T = unknown,> ({
	subreddits,
	page,
	limit,
}: {
	subreddits: string
	page: 'modqueue' | 'unmoderated'
	limit: number
},): Promise<RedditListing<T>> {
	return apiOauthGetJSON<RedditListing<T>>(`/r/${subreddits}/about/${page}.json`, {limit: String(limit,),},)
}

/** The subset of `/r/<sub>/about.json` this codebase reads. */
export interface SubredditAbout {
	/** The community's display title, which is not the same as its name. */
	title: string
	/** The short public description shown in the sidebar. */
	publicDescription: string
}

/** One entry from a subreddit's public rules list. */
export interface SubredditRule {
	/** The rule's short name, as shown in the report dialog. */
	shortName: string
	/** The rule's longer description; empty when the moderator left it blank. */
	description: string
}

/**
 * Reads a subreddit's display title and public description.
 *
 * Both are public, so this works for any subreddit the moderator can see, and neither
 * changes often - callers that need it per-removal should cache.
 * @param subreddit The bare subreddit name.
 */
export async function getSubredditAbout (subreddit: string,): Promise<SubredditAbout> {
	const response = await apiOauthGetJSON<{data?: {title?: string; public_description?: string}}>(
		`/r/${subreddit}/about.json`,
	)
	return {
		title: response.data?.title ?? '',
		publicDescription: response.data?.public_description ?? '',
	}
}

/**
 * Reads a subreddit's rules, in the order the moderators arranged them.
 *
 * Order is the whole point for callers resolving a positional reference such as Reddit's
 * `{community_rule_1}` macro, so the API's order is preserved rather than sorted.
 * @param subreddit The bare subreddit name.
 */
export async function getSubredditRules (subreddit: string,): Promise<SubredditRule[]> {
	const response = await apiOauthGetJSON<{rules?: {short_name?: string; description?: string}[]}>(
		`/r/${subreddit}/about/rules.json`,
	)
	const rules = Array.isArray(response.rules,) ? response.rules : []
	return rules.map((rule,) => ({
		shortName: rule.short_name ?? '',
		description: rule.description ?? '',
	}))
}
