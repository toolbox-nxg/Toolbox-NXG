/**
 * Background handler for usernotes blob decompression. Runs in the service
 * worker so large pages don't block the content script's main thread; results
 * are cached per cache key (the subreddit for the legacy page, a per-shard
 * key for sharded NXG pages) so repeated calls with the same blob are free.
 */

import {zlibInflate,} from '../../util/data/encoding'
import {registerMessageHandler,} from '../messageHandling'
import type {TbUsernoteDecompressResponse,} from '../messages'

const decompressCache = new Map<string, {blob: string; users: Record<string, unknown>}>()
const inFlight = new Map<string, Promise<Record<string, unknown>>>()

/** Registers the `toolbox-usernote-decompress` message handler. */
export function registerUsernoteHandlers () {
	registerMessageHandler('toolbox-usernote-decompress', async (request,): Promise<TbUsernoteDecompressResponse> => {
		const {cacheKey, blob,} = request

		const cached = decompressCache.get(cacheKey,)
		if (cached && cached.blob === blob) {
			return {users: cached.users,}
		}

		const flightKey = `${cacheKey}:${blob}`
		let flight = inFlight.get(flightKey,)
		if (!flight) {
			flight = (async () => {
				const users = JSON.parse(zlibInflate(blob,),) as Record<string, unknown>
				decompressCache.set(cacheKey, {blob, users,},)
				return users
			})()
			inFlight.set(flightKey, flight,)
		}

		try {
			const users = await flight
			return {users,}
		} catch (err) {
			return {error: String(err,),}
		} finally {
			if (inFlight.get(flightKey,) === flight) {
				inFlight.delete(flightKey,)
			}
		}
	},)
}
