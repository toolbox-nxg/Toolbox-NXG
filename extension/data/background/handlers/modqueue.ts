/**
 * Background handler for `toolbox-modqueue` messages. Maintains a per-subreddit
 * cache of modqueue thing names so content scripts can quickly check whether a
 * given item is still in the queue without hammering the API.
 */

import browser from 'webextension-polyfill'

import {getModqueueThingNames,} from '../../api/resources/modqueue'
import createLogger from '../../util/infra/logging'
import {registerMessageHandler,} from '../messageHandling'

const log = createLogger('TBModqueue',)

const modqueueCacheTtlS = 30
const modqueueCacheName = 'toolbox-modqueue-cache'

/** Cached modqueue state for a single subreddit. */
interface QueueCache {
	/** Unix ms timestamp of the last successful refresh. */
	lastRefresh: number
	/** Fullnames of items currently in the queue. */
	things: string[]
	/**
	 * Unix ms timestamp when a refresh was started, or `false` if no refresh
	 * is currently in progress. Used to detect and clear stale locks left by
	 * dead service-worker instances.
	 */
	refreshActive: number | false
}

/**
 * In-memory tracking of in-flight refreshes per subreddit. Concurrent requests
 * in the same service worker instance await the stored promise rather than
 * polling storage. Service-worker-safe: no window/DOM events required.
 */
const pendingRefreshes = new Map<string, Promise<void>>()

function normalizedSubredditKey (subreddit: string,): string {
	return subreddit.toLowerCase()
}

function queueCacheKey (subreddit: string,): string {
	return `${modqueueCacheName}.${normalizedSubredditKey(subreddit,)}`
}

/**
 * Stores the modqueue cache for a subreddit.
 */
async function setQueueCache (subreddit: string, cacheObject: QueueCache,) {
	await browser.storage.local.set({[queueCacheKey(subreddit,)]: cacheObject,},)
}

/**
 * Reads back the stored modqueue cache for a subreddit.
 */
async function getQueueCache (subreddit: string,): Promise<QueueCache | null> {
	const key = queueCacheKey(subreddit,)
	const result = await browser.storage.local.get({[key]: null,},) as Record<string, QueueCache | null>
	return result[key] ?? null
}

/**
 * Reports whether a thing is already present in a subreddit's cached queue.
 */
async function thingFound (thingName: string, subreddit: string,): Promise<boolean> {
	const subredditQueueCache = await getQueueCache(subreddit,)
	if (subredditQueueCache) {
		return subredditQueueCache.things.includes(thingName,)
	}
	return false
}

/** Registers the `toolbox-modqueue` message handler. */
export function registerModqueueHandlers () {
	registerMessageHandler('toolbox-modqueue', async (request,) => {
		const {subreddit, thingName, thingTimestamp,} = request
		const pendingKey = normalizedSubredditKey(subreddit,)
		// Check if we need to fetch data.
		let lastRefresh = 0
		let refreshActive: number | false = false
		let subredditQueueCache = await getQueueCache(subreddit,)
		if (subredditQueueCache) {
			lastRefresh = subredditQueueCache.lastRefresh
			refreshActive = subredditQueueCache.refreshActive

			// If the browser is closed during a refresh the lock can get stuck permanently.
			// Treat any lock older than the TTL as stale and reset it.
			if (refreshActive && Date.now() - refreshActive > 1000 * modqueueCacheTtlS) {
				refreshActive = false
				subredditQueueCache.refreshActive = false
				await setQueueCache(subreddit, subredditQueueCache,)
			}
		}

		// To reduce API calls, don't start a new one if another request in this
		// service worker instance is already refreshing this subreddit's queue.
		// `pendingRefreshes` is checked alongside `refreshActive` so that a stale
		// storage lock left by a dead service worker instance never causes an
		// infinite wait - if the promise isn't in the map, the original fetch is
		// gone and we fall through to start a fresh one.
		const pending = pendingRefreshes.get(pendingKey,)
		if (refreshActive && pending) {
			await pending
			// The thing timestamp is bigger than the last refresh or cache isn't fresh anymore.
		} else if (thingTimestamp * 1000 > lastRefresh || Date.now() - lastRefresh > 1000 * modqueueCacheTtlS) {
			if (subredditQueueCache) {
				subredditQueueCache.refreshActive = Date.now()
			} else {
				subredditQueueCache = {
					refreshActive: Date.now(),
					lastRefresh: 0,
					things: [],
				}
			}
			await setQueueCache(subreddit, subredditQueueCache,)

			let notifyDone = () => {}
			pendingRefreshes.set(
				pendingKey,
				new Promise<void>((resolve,) => {
					notifyDone = resolve
				},),
			)

			try {
				const newCacheObject: QueueCache = {
					lastRefresh: Date.now(),
					things: await getModqueueThingNames(subreddit,),
					refreshActive: false,
				}
				await setQueueCache(subreddit, newCacheObject,)
			} catch (error) {
				// Probably reddit errors, could build in a retry method but that seems overkill for now.
				log.error('getting modqueue error: ', error,)
				// Clear the storage lock so future requests aren't blocked by this failed refresh.
				subredditQueueCache.refreshActive = false
				await setQueueCache(subreddit, subredditQueueCache,)
			} finally {
				pendingRefreshes.delete(pendingKey,)
				notifyDone()
			}
		}

		// The cache is as fresh as it can be. See if it contains the request thing.
		return thingFound(thingName, subreddit,)
	},)
}
