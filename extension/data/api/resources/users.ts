/** API functions for fetching Reddit user data, activity history, and last-active timestamps. */

import {apiOauthGetJSON,} from '../transport/http'
import type {QueryParams,} from '../transport/http'
import {fetchAllListingPages,} from '../transport/pagination'

/** Response shape of `/user/{user}/about.json` (Reddit kind `t2`). */
export interface UserAbout {
	kind: 't2'
	data: {
		name: string
		id: string
		created_utc: number
		link_karma: number
		comment_karma: number
		is_suspended?: boolean
		is_employee?: boolean
		has_verified_email?: boolean
		snoovatar_img?: string
		icon_img?: string
		/** The user's profile subreddit (`u/<name>`), present for non-suspended accounts. */
		subreddit?: {
			title?: string
			public_description?: string
			icon_img?: string
		} | null
		[key: string]: unknown
	}
}

/** Minimal Reddit listing wrapper used when paginating user listing pages. */
interface UserListingPage {
	data: {
		children: unknown[]
		after: string | null
	}
}

/**
 * Fetches a user's public account details.
 * @param user Username to look up.
 * @returns Resolves with the account info as JSON, or rejects with error text.
 */
export const aboutUser = (user: string,): Promise<UserAbout> => apiOauthGetJSON<UserAbout>(`/user/${user}/about.json`,)

/** Fetches paginated Reddit listing pages for `user`, stopping early once `maxCount` items are collected. */
async function fetchUserListing (
	user: string,
	listing: 'submitted' | 'comments',
	maxCount?: number,
): Promise<unknown[]> {
	try {
		return await fetchAllListingPages<unknown>(
			(after,) =>
				apiOauthGetJSON<UserListingPage>(`/user/${user}/${listing}.json`, {after, sort: 'new', limit: '100',},),
			{maxCount,},
		)
	} catch (error) {
		throw new Error('unable to load userdata; shadowbanned?', {cause: error,},)
	}
}

/**
 * Fetches all pages of a user's submission history.
 * @returns Raw Reddit listing children across all pages
 */
export const getUserSubmissions = (user: string,): Promise<unknown[]> => fetchUserListing(user, 'submitted',)

/**
 * Fetches a user's comment history up to `maxCount` items.
 * @returns Raw Reddit listing children
 */
export const getUserComments = (user: string, maxCount?: number,): Promise<unknown[]> =>
	fetchUserListing(user, 'comments', maxCount,)

/**
 * Fetches one page of a user listing (submitted, comments, saved, overview,
 * moderated_subreddits, trophies, etc.).
 */
export const getUserListingPage = <T = Record<string, unknown>,>(
	user: string,
	listing: string,
	query?: QueryParams,
): Promise<T> => apiOauthGetJSON<T>(`/user/${user}/${listing}.json`, query,)

/**
 * Fetches a user's recent activity from `/user/{user}.json`.
 * Used to check for account deletion, suspension, or inactivity.
 */
export const getUserActivity = (user: string, query?: QueryParams,): Promise<Record<string, unknown>> =>
	apiOauthGetJSON<Record<string, unknown>>(`/user/${user}.json`, query,)
