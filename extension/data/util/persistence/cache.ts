/** Client-side cache layer that wraps the background page's TTL-based cache via extension messaging. */

import browser from 'webextension-polyfill'

import type {TbCacheMessage,} from '../../background/messages'
import createLogger from '../infra/logging'

const log = createLogger('util:cache',)

// In-memory layer for the content script. Eliminates redundant IPC for keys
// that are read repeatedly within a page session (e.g. noteCache, moderatedSubs).
// The background is still authoritative for TTL expiry; this layer only
// short-circuits round-trips for recent reads.
const memCache = new Map<string, {value: unknown; expiresAt: number}>()
const memCacheTtl = 60_000 // 1 minute - well within the minimum 15-min TTL

/** Shape of the background page's reply to a cache get/set message. */
interface CacheResponse {
	/** Present (non-undefined) when the stored entry was corrupted and could not be read. */
	errorThrown?: unknown
	/** The cached (get) or stored (set) value echoed back by the background page. */
	value?: unknown
}

/**
 * Wipes every cache key, both in memory and in storage.
 */
export const clearCache = () => {
	memCache.clear()
	return browser.runtime.sendMessage(
		{
			action: 'toolbox-cache',
			method: 'clear',
		} satisfies TbCacheMessage,
	)
}

/**
 * Reads a cached value, returning the default when nothing is stored or the
 * entry has expired.
 * @param moduleID Module that owns the cache key.
 * @param key Name of the cache key.
 * @param defaultVal Value returned when there is no live cached value.
 */
export async function getCache<T = unknown,> (moduleID: string, key: string, defaultVal?: T,): Promise<T> {
	const storageKey = `${moduleID}.${key}`

	const mem = memCache.get(storageKey,)
	if (mem !== undefined && Date.now() < mem.expiresAt) {
		return mem.value as T
	}

	const response = await browser.runtime.sendMessage(
		{
			action: 'toolbox-cache',
			method: 'get',
			storageKey,
			inputValue: defaultVal ?? null,
		} satisfies TbCacheMessage,
	) as CacheResponse
	if (response.errorThrown !== undefined) {
		log.debug(`${storageKey} is corrupted.  Sending default.`,)
		return defaultVal as T
	}

	memCache.set(storageKey, {value: response.value, expiresAt: Date.now() + memCacheTtl,},)
	return response.value as T
}

/**
 * Writes a value into the cache and resolves with the value that was stored.
 * @param moduleID Module that owns the cache key.
 * @param key Name of the cache key.
 * @param inputValue New value to store under the key.
 */
export async function setCache (moduleID: string, key: string, inputValue: unknown,) {
	const storageKey = `${moduleID}.${key}`
	// Update in-memory entry immediately so subsequent getCache calls within
	// this page session don't wait for IPC.
	memCache.set(storageKey, {value: inputValue, expiresAt: Date.now() + memCacheTtl,},)
	const response = await browser.runtime.sendMessage(
		{
			action: 'toolbox-cache',
			method: 'set',
			storageKey,
			inputValue,
		} satisfies TbCacheMessage,
	) as CacheResponse
	return response.value
}
