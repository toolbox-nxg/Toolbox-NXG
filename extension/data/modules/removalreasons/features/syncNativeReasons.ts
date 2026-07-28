/** Gated runner for the opt-in one-way sync of Reddit's native removal reasons into the toolbox config. */

import {utils,} from '../../../framework/moduleIds'
import createLogger from '../../../util/infra/logging'
import {getCache, setCache,} from '../../../util/persistence/cache'
import type {ToolboxConfig,} from '../../../util/wiki/schemas/config/schema'
import {getConfig, saveToolboxConfig,} from '../../config/moduleapi'
import {getNativeReasons,} from '../moduleapi'
import {mergeNativeReasons, nativeReasonsFingerprint,} from '../nativeSync'

const log = createLogger('TBNativeReasonSync',)

/** Cache key holding the epoch ms of the last sync attempt per subreddit. */
const cooldownCacheKey = 'nativeSyncCooldown'

/**
 * How long to wait before attempting a subreddit again. Matches the native reason
 * cache TTL: attempting more often than the data can change is pure waste. Persisted
 * rather than in-memory so a page reload does not reset it.
 */
const cooldownMs = 15 * 60 * 1000

/**
 * Subreddits already attempted in this page session. Cheaper than the persisted
 * cooldown and covers repeated drawer opens on one page.
 */
const attempted = new Set<string>()

/** Why a sync run ended, for callers that surface the result. */
export interface NativeSyncOutcome {
	/**
	 * `disabled` - not opted in (or no config); `redirected` - the subreddit takes its
	 * reasons from elsewhere; `throttled` - attempted too recently; `unchanged` - nothing
	 * upstream moved; `synced` - the config was rewritten; `failed` - the fetch failed.
	 */
	status: 'disabled' | 'redirected' | 'throttled' | 'unchanged' | 'synced' | 'failed'
	added?: number
	updated?: number
	removed?: number
}

/** Clears the in-session throttle. Exposed for tests. */
export function resetNativeSyncThrottle (): void {
	attempted.clear()
}

/**
 * Imports a subreddit's native removal reasons into its toolbox config, one way.
 *
 * Cheap gates run first so the common case (not opted in) costs nothing, and the
 * stored fingerprint short-circuits before any merge when nothing upstream changed.
 * Never rejects: this runs in the background off a drawer open, so every failure is
 * logged rather than surfaced.
 * @param subreddit The subreddit to sync.
 * @param options Run options. `force` bypasses the throttle and the native reason
 * cache (for the manual button); `silent` suppresses the save's feedback toasts and
 * defaults to true unless forced.
 */
export async function syncNativeReasons (
	subreddit: string,
	options?: {force?: boolean; silent?: boolean},
): Promise<NativeSyncOutcome> {
	const force = options?.force === true
	// A background run must stay quiet; a moderator pressing "sync now" wants the toasts.
	const silent = options?.silent ?? !force

	const config = await getConfig(subreddit,)
	const nativeSync = config?.removalReasons?.nativeSync
	if (!config || nativeSync?.enabled !== true) { return {status: 'disabled',} }

	// A subreddit that redirects to another subreddit's reasons has an unused `reasons`
	// list of its own; syncing into it would build a list nobody reads. The source
	// subreddit syncs itself if its own config opts in.
	const {getfrom,} = config.removalReasons
	if (getfrom && getfrom !== subreddit) { return {status: 'redirected',} }

	if (!force) {
		if (attempted.has(subreddit,)) { return {status: 'throttled',} }
		const cooldowns = await getCache(utils, cooldownCacheKey, {},) as Record<string, number>
		const last = cooldowns[subreddit]
		if (typeof last === 'number' && Date.now() - last < cooldownMs) {
			attempted.add(subreddit,)
			return {status: 'throttled',}
		}
	}
	attempted.add(subreddit,)

	let native
	try {
		native = await getNativeReasons(subreddit, force ? {fresh: true,} : undefined,)
	} catch (error: unknown) {
		log.warn(`Could not read native removal reasons for /r/${subreddit}:`, error,)
		return {status: 'failed',}
	}

	if (!force) {
		const cooldowns = await getCache(utils, cooldownCacheKey, {},) as Record<string, number>
		await setCache(utils, cooldownCacheKey, {...cooldowns, [subreddit]: Date.now(),},)
	}

	// An empty native list is a legitimate result - every native reason was deleted - and
	// the merge below is what removes the toolbox copies.
	const fingerprint = nativeReasonsFingerprint(native,)
	if (fingerprint === nativeSync.fingerprint) { return {status: 'unchanged',} }

	const result = mergeNativeReasons(config.removalReasons.reasons, native, nativeSync.ignored,)
	if (!result.changed) {
		// The fingerprint is order-independent, so this is near-unreachable. Recomputing an
		// O(n) merge on the next open is cheaper than burning a wiki revision to store it.
		return {status: 'unchanged',}
	}

	// Build a fresh object rather than mutating the cached config in place.
	const next: ToolboxConfig = {
		...config,
		removalReasons: {
			...config.removalReasons,
			reasons: result.reasons,
			nativeSync: {...nativeSync, fingerprint, lastSyncedAt: Date.now(),},
		},
	}

	try {
		await saveToolboxConfig(subreddit, next, 'sync removal reasons from Reddit', {silent,},)
	} catch (error: unknown) {
		// saveToolboxConfig reports its own failures and is documented not to reject, but a
		// background caller must not be the one to discover otherwise.
		log.warn(`Could not save synced removal reasons for /r/${subreddit}:`, error,)
		return {status: 'failed',}
	}
	log.debug(
		`Synced native reasons for /r/${subreddit}: `
			+ `${result.added} added, ${result.updated} updated, ${result.removed} removed`,
	)
	return {status: 'synced', added: result.added, updated: result.updated, removed: result.removed,}
}
