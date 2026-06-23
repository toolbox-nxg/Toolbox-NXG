/**
 * Background message handlers for the Toolbox per-user cache stored in `browser.storage.local`.
 * The cache is keyed by a user ID derived from the `reddit_session` cookie so each account
 * has an isolated namespace, and stale entries for inactive accounts are purged after 24 hours.
 */

import browser from 'webextension-polyfill'

import createLogger from '../../util/infra/logging'
import {registerMessageHandler,} from '../messageHandling'
import {getSettings,} from './settings'
import {getRedditSessionUserID,} from './tabUtils'

const log = createLogger('TBCache',)

/** Shape of a stored cache entry. */
interface CacheEntry {
	value: unknown
	timeStamp: number
}

/** Narrows an unknown stored value to a well-formed cache entry (older versions or external code may write malformed ones). */
function isCacheEntry (value: unknown,): value is CacheEntry {
	return typeof value === 'object' && value !== null && typeof (value as {timeStamp?: unknown}).timeStamp === 'number'
}

/** Prefix for all cache keys written to `browser.storage.local`. */
const tbCachePrefix = 'TBCache'
/** How long (ms) an inactive user's cache namespace is kept before being purged. */
const userCacheExpireTime = 1000 * 60 * 60 * 24

/** `tbsettings` key for the short-cache TTL (minutes). */
const storageShortLengthKey = 'Toolbox.Utils.shortLength'
/** `tbsettings` key for the long-cache TTL (minutes). */
const storageLongLengthKey = 'Toolbox.Utils.longLength'

/** Cache keys that use the long TTL. */
const longCacheList = [
	'Utils.configCache',
	'Utils.configRev',
	'Utils.rulesCache',
	'Utils.noRules',
	'Utils.moderatedSubs',
	'Utils.moderatedSubsData',
]

/** Cache keys that use the short TTL. */
const shortCacheList = [
	'Utils.noteCache',
	'Utils.noConfig',
	'Utils.noNotes',
]

/** Returns the storage-key prefix for all cache entries belonging to `userId`. */
function cacheKeyPrefix (userId: string,): string {
	return `${tbCachePrefix}.${userId}.`
}

/** Returns the full storage key for a specific cache entry. */
function buildCacheKey (userId: string, storageKey: string,): string {
	return `${cacheKeyPrefix(userId,)}${storageKey}`
}

/**
 * Returns the TTL in ms for `storageKey`, or `null` if the key never expires.
 * Reads the current module-level `shortCacheTTL` / `longCacheTTL` values.
 */
function getTTLMs (storageKey: string,): number | null {
	if (longCacheList.includes(storageKey,)) { return longCacheTTL * 60 * 1000 }
	if (shortCacheList.includes(storageKey,)) { return shortCacheTTL * 60 * 1000 }
	return null
}

/** Removes all `TBCache` entries belonging to the given user ID from local storage. */
async function clearCache (redditSessionUserId: string,) {
	const storage = await browser.storage.local.get()
	const cacheKeys = Object.keys(storage,).filter((storageKey,) =>
		storageKey.startsWith(cacheKeyPrefix(redditSessionUserId,),)
	)
	await browser.storage.local.remove(cacheKeys,)
}

let staleCacheCleaningInProgress = false
/**
 * Updates the interaction timestamp for `redditUserIdBase36` and removes the cache
 * namespace of any user who hasn't been seen within `userCacheExpireTime`.
 */
async function staleUserCacheCleanup (redditUserIdBase36: string,) {
	// Only one cleanup runs at a time. If a concurrent call arrives while cleanup
	// is in progress, that user's interaction time may not be updated - acceptable
	// given the 24-hour expiry window.
	if (staleCacheCleaningInProgress) {
		return
	}
	staleCacheCleaningInProgress = true

	try {
		const result = await browser.storage.local.get({userCacheInteractionTimes: {},},)
		const userCacheInteractionTimes = result.userCacheInteractionTimes as Record<string, number>

		// Set interaction time for current user.
		userCacheInteractionTimes[redditUserIdBase36] = Date.now()

		// Evict any user whose last interaction exceeds the expiry window.
		for (const [key, value,] of Object.entries(userCacheInteractionTimes,)) {
			if (Date.now() - value > userCacheExpireTime) {
				await clearCache(key,)
				delete userCacheInteractionTimes[key]
			}
		}

		await browser.storage.local.set({
			userCacheInteractionTimes,
		},)
	} finally {
		staleCacheCleaningInProgress = false
	}
}

function cleanupStaleUserCacheSafely (redditUserIdBase36: string,) {
	staleUserCacheCleanup(redditUserIdBase36,).catch((error,) => {
		log.error('staleUserCacheCleanup:', error,)
	},)
}

// TTL values in minutes, kept in memory and refreshed when settings change.
let shortCacheTTL = 15
let longCacheTTL = 45

/** Reads short and long cache TTL values from `tbsettings` and updates the module-level variables. */
async function loadCacheTTLs () {
	const s = await getSettings()
	const short = s[storageShortLengthKey]
	const long = s[storageLongLengthKey]
	shortCacheTTL = (typeof short === 'number' ? short : 0) || 15
	longCacheTTL = (typeof long === 'number' ? long : 0) || 45
}

function loadCacheTTLsSafely () {
	loadCacheTTLs().catch((error,) => {
		log.error('Failed to load cache TTL settings:', error,)
	},)
}

/** Registers the `toolbox-cache` and `toolbox-cache-force-timeout` message handlers. */
export function registerCacheHandlers () {
	// Load TTLs once at startup and keep them current.
	loadCacheTTLsSafely()
	browser.storage.onChanged.addListener((changes, area,) => {
		if (area === 'local' && 'tbsettings' in changes) {
			loadCacheTTLsSafely()
		}
	},)

	// Handles get/set/clear operations against the per-user cache namespace.
	registerMessageHandler('toolbox-cache', async (request, sender,) => {
		const {method,} = request
		const redditSessionUserId = await getRedditSessionUserID(sender,)
		cleanupStaleUserCacheSafely(redditSessionUserId,)

		if (method === 'get') {
			const {storageKey, inputValue,} = request
			const cacheKey = buildCacheKey(redditSessionUserId, storageKey,)
			const storedValue = await browser.storage.local.get(cacheKey,)

			// Cache value was stored before
			if (Object.prototype.hasOwnProperty.call(storedValue, cacheKey,)) {
				const entry = storedValue[cacheKey]
				// Guard against malformed entries written by older versions or external code.
				if (!isCacheEntry(entry,)) {
					await browser.storage.local.remove(cacheKey,)
					return {value: inputValue,}
				}
				// Handle cache that can expire
				const ttl = getTTLMs(storageKey,)
				if (ttl !== null) {
					// If cache has expired delete the entry and return inputValue.
					if (Date.now() - entry.timeStamp >= ttl) {
						await browser.storage.local.remove(cacheKey,)
						return {value: inputValue,}
					}
				}
				return {value: entry.value,}
			}
			return {value: inputValue,}
		}

		if (method === 'set') {
			const {storageKey, inputValue,} = request
			const cacheKey = buildCacheKey(redditSessionUserId, storageKey,)
			await browser.storage.local.set({
				[cacheKey]: {
					value: inputValue,
					timeStamp: Date.now(),
				},
			},)
			return {value: inputValue,}
		}

		if (method === 'clear') {
			await clearCache(redditSessionUserId,)
			return
		}

		log.warn('toolbox-cache: unknown method', method,)
		return
	},)

	// Immediately removes all TTL-governed entries for the current user, forcing a fresh fetch on next access.
	registerMessageHandler('toolbox-cache-force-timeout', async (_request, sender,) => {
		const redditSessionUserId = await getRedditSessionUserID(sender,)
		cleanupStaleUserCacheSafely(redditSessionUserId,)
		const storage = await browser.storage.local.get()
		const prefix = cacheKeyPrefix(redditSessionUserId,)
		const cacheKeys = Object.keys(storage,).filter((storageKey,) => {
			if (storageKey.startsWith(prefix,)) {
				const shortKey = storageKey.slice(prefix.length,)
				return getTTLMs(shortKey,) !== null
			}
			return false
		},)
		await browser.storage.local.remove(cacheKeys,)
	},)
}
