/** API functions for the currently authenticated Reddit user (`/api/v1/me`). */

import {utils,} from '../../framework/moduleIds'
import {getCache, setCache,} from '../../util/persistence/cache'
import {apiOauthGetJSON,} from '../transport/http'
import {fetchAllListingPages, is504,} from '../transport/pagination'

/**
 * A promise resolving to the current user's details from `/api/v1/me`, or
 * rejecting when they can't be fetched. May yield a previously cached details
 * object after repeated timeouts.
 *
 * The retry logic here is intentionally separate from `fetchAllListingPages`:
 * this is a one-off non-listing endpoint with its own fallback semantics (the
 * `.catch` below). `getModeratedSubreddits` delegates retry to `fetchAllListingPages`.
 */
const userDetailsPromise = (async function fetchUserDetails (tries = 3,) {
	try {
		const data = await apiOauthGetJSON('/api/v1/me',)
		// Fire-and-forget: cache write is best-effort; callers should not fail
		// because a background write to extension storage didn't complete.
		setCache(utils, 'userDetails', data,)
		return data
	} catch (error) {
		// 504 Gateway Timeout errors can be retried
		if (is504(error,) && tries > 1) {
			return fetchUserDetails(tries - 1,)
		}

		// Throw all other errors without retrying
		throw error
	}
})()
	// If getting details from API fails, fall back to the cached value (if any)
	.catch(() => getCache(utils, 'userDetails',))

/** Gets details about the current user from `/api/v1/me`. */
export const getUserDetails = () => userDetailsPromise

/** Returns the username of the currently authenticated account. */
export const getCurrentUser = async (): Promise<string> => {
	const userDetails = await getUserDetails()
	if (!userDetails?.name) {
		throw new Error('Could not retrieve user details',)
	}
	return userDetails.name
}

/** Shape of a single child from `/subreddits/mine/moderator.json`. */
export interface ModeratedSubredditChild {
	data: {
		display_name: string
		subscribers: number
		over18: boolean
		created_utc: number
		subreddit_type: string
		submission_type: string
	}
}

/** Minimal Reddit listing wrapper used internally when paginating moderated subreddits. */
interface ModSubListingPage {
	data: {
		children: ModeratedSubredditChild[]
		after: string | null
	}
}

/**
 * Fetches all subreddits the current user moderates, with automatic pagination
 * and 504 retry (up to 5 attempts per page).
 */
export async function getModeratedSubreddits (): Promise<ModeratedSubredditChild[]> {
	return fetchAllListingPages<ModeratedSubredditChild>(
		(after,) => apiOauthGetJSON<ModSubListingPage>('/subreddits/mine/moderator.json', {after, limit: '100',},),
		{maxRetries: 5,},
	)
}
