/** Cached list of subreddits the current user moderates, with deduplication of concurrent fetches. */

import {utils,} from '../../framework/moduleIds'
import {saneSort, sortBy,} from '../../util/data/array'
import createLogger from '../../util/infra/logging'
import {getCache, setCache,} from '../../util/persistence/cache'
import {getModeratedSubreddits, type ModeratedSubredditChild,} from './me'

const log = createLogger('TBModSubs',)

/** Full data record for a subreddit the current user moderates. */
export interface ModSubData {
	subreddit: string
	subscribers: number
	over18: boolean
	created_utc: number
	subreddit_type: string
	submission_type: string
}

/** Returns `true` if the current user moderates the given subreddit. */
export async function isModSub (subreddit: string,) {
	const mySubs = await getModSubs(false,)
	return mySubs.includes(subreddit,)
}

/**
 * Heuristic check used to gate the History Button and Profile Pro modules.
 * @returns `true` if the total subscriber count across all moderated subs (minus one per subreddit) exceeds 10.
 */
export async function modSubCheck () {
	const mySubsData = await getModSubs(true,)
	let subscriberCount = 0
	mySubsData.forEach((subreddit,) => {
		subscriberCount += subreddit.subscribers
	},)
	subscriberCount -= mySubsData.length
	return subscriberCount > 10
}

// In-memory cache so repeated calls (e.g. per scroll-loaded element) skip
// background IPC entirely once the data has been fetched once.
let inMemoryModSubs: string[] | null = null
let inMemoryModSubsData: ModSubData[] | null = null

// Coalesces concurrent callers onto a single in-flight fetch. Typed as
// Promise<void> so that any rejection propagates to all awaiting callers.
let ongoingFetch: Promise<void> | null = null

/** Clears the in-memory mod-subs cache. Call when the background cache is cleared. */
export function clearModSubsCache () {
	inMemoryModSubs = null
	inMemoryModSubsData = null
}

/**
 * Returns the current user's moderated subreddits, using an in-memory cache
 * backed by extension storage.
 */
export async function getModSubs (data: true,): Promise<ModSubData[]>
export async function getModSubs (data?: false,): Promise<string[]>
export async function getModSubs (data: boolean,): Promise<string[] | ModSubData[]>
export async function getModSubs (data?: boolean,): Promise<string[] | ModSubData[]> {
	// For data=true we also require inMemoryModSubsData to be populated; if a
	// prior data fetch failed while names were cached, that variable may still
	// be null and a retry is needed.
	// Non-null assertion on inMemoryModSubsData is safe: the condition above requires
	// inMemoryModSubsData !== null when data=true, so the assertion is never reached
	// with a null value.
	if (inMemoryModSubs !== null && (!data || inMemoryModSubsData !== null)) {
		return data ? inMemoryModSubsData! : inMemoryModSubs
	}

	if (ongoingFetch) {
		try {
			await ongoingFetch
		} catch (error) {
			if (!data && inMemoryModSubs !== null) { return inMemoryModSubs }
			throw error
		}
		// Non-null assertions are safe: ongoingFetch succeeded (no throw above), so the
		// IIFE below has populated both variables. Any fetch failure rethrows above.
		return data ? inMemoryModSubsData! : inMemoryModSubs!
	}

	log.debug('getting mod subs',)

	// Assign the fetch promise directly so that a rejection propagates to all
	// concurrent callers waiting on ongoingFetch, rather than resolving them
	// with a void sentinel while inMemoryModSubs is still null.
	ongoingFetch = (async () => {
		const cachedSubs = await getCache(utils, 'moderatedSubs', [],) as string[]
		const cachedSubsData = await getCache(utils, 'moderatedSubsData', [],) as ModSubData[]

		if (cachedSubs.length) {
			inMemoryModSubs = cachedSubs
			if (cachedSubsData.length) {
				inMemoryModSubsData = cachedSubsData
				return // full cache hit - both names and data available
			}
			// Names cached but data missing (e.g. old install or partial write);
			// keep the cached names and continue to fetch fresh data below.
		}

		const subredditData = await getModeratedSubreddits()

		const fullData: ModSubData[] = subredditData.map(({data,}: ModeratedSubredditChild,) => ({
			subreddit: data.display_name,
			subscribers: data.subscribers,
			over18: data.over18,
			created_utc: data.created_utc,
			subreddit_type: data.subreddit_type,
			submission_type: data.submission_type,
		}))
		inMemoryModSubs = saneSort(fullData.map(({subreddit,},) => subreddit.trim()),)
		inMemoryModSubsData = sortBy(fullData, 'subscribers',)

		await setCache(utils, 'moderatedSubs', inMemoryModSubs,)
		await setCache(utils, 'moderatedSubsData', inMemoryModSubsData,)
	})().finally(() => {
		ongoingFetch = null
	},)

	try {
		await ongoingFetch
	} catch (error) {
		if (!data && inMemoryModSubs !== null) { return inMemoryModSubs }
		throw error
	}
	// Non-null assertions are safe: ongoingFetch (the IIFE directly above) has
	// completed without throwing, so both variables are populated.
	return data ? inMemoryModSubsData! : inMemoryModSubs!
}
