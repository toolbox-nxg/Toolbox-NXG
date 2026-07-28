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

/** Cache key holding the most recent failed sync per subreddit. */
const failureCacheKey = 'nativeSyncFailure'

/**
 * How long to wait before attempting a subreddit again. Matches the native reason
 * cache TTL: attempting more often than the data can change is pure waste. Persisted
 * rather than in-memory so a page reload does not reset it.
 */
const cooldownMs = 15 * 60 * 1000

/**
 * How long to wait after a failed *write* before trying again. A sync that cannot write -
 * most often an account without the `wiki` mod permission - fails the same way every time,
 * so retrying it on the ordinary cooldown burns a fetch and a write every 15 minutes for
 * as long as the moderator keeps working. Read failures are left on the ordinary cooldown
 * instead: those are usually a transient network problem, and backing off half a day would
 * strand a subreddit whose sync is fine.
 */
const saveFailureBackoffMs = 12 * 60 * 60 * 1000

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

/** Reads the per-subreddit map of last-check times. */
async function readCooldowns (): Promise<Record<string, number>> {
	return await getCache(utils, cooldownCacheKey, {},) as Record<string, number>
}

/**
 * Epoch milliseconds of the last time this browser successfully read Reddit's removal
 * reasons for a subreddit, or undefined if it never has.
 *
 * Local to this user rather than shared through the config, and the only evidence the
 * editor can show that the sync is alive: `lastSyncedAt` moves only when a sync changes
 * something, so it stands still for a subreddit whose reasons have settled.
 * @param subreddit The subreddit to look up.
 */
export async function getLastNativeSyncCheck (subreddit: string,): Promise<number | undefined> {
	return (await readCooldowns())[subreddit]
}

/** A background sync run that did not complete, kept so the editor can report it. */
export interface NativeSyncFailure {
	/** Epoch milliseconds the failure happened. */
	at: number
	/** Whether the fetch or the config write was what failed. */
	stage: 'fetch' | 'save'
	/** The underlying error's message, for the editor to show verbatim. */
	message: string
}

/** Reads the per-subreddit map of recorded failures. */
async function readFailures (): Promise<Record<string, NativeSyncFailure>> {
	return await getCache(utils, failureCacheKey, {},) as Record<string, NativeSyncFailure>
}

/**
 * Records that a run failed, so the config editor can say so. Background runs are
 * otherwise silent by design, which leaves a subreddit whose sync never works looking
 * exactly like one that simply has nothing to import.
 * @param subreddit The subreddit whose run failed.
 * @param stage Which half of the run failed.
 * @param error The thrown value.
 */
async function recordFailure (subreddit: string, stage: 'fetch' | 'save', error: unknown,): Promise<void> {
	const message = error instanceof Error ? error.message : String(error,)
	const failures = await readFailures()
	await setCache(utils, failureCacheKey, {...failures, [subreddit]: {at: Date.now(), stage, message,},},)
}

/**
 * Forgets any recorded failure for a subreddit, called once a run gets through. Skips
 * the write when there is nothing to clear, which is the overwhelmingly common case.
 * @param subreddit The subreddit that just succeeded.
 */
async function clearFailure (subreddit: string,): Promise<void> {
	const failures = await readFailures()
	if (!(subreddit in failures)) { return }
	const {[subreddit]: _cleared, ...rest} = failures
	await setCache(utils, failureCacheKey, rest,)
}

/**
 * The last recorded failure for a subreddit, or undefined if its most recent run got
 * through. Local to this user, like {@link getLastNativeSyncCheck}.
 * @param subreddit The subreddit to look up.
 */
export async function getLastNativeSyncFailure (subreddit: string,): Promise<NativeSyncFailure | undefined> {
	return (await readFailures())[subreddit]
}

/**
 * Imports a subreddit's native removal reasons into its toolbox config, one way.
 *
 * Cheap gates run first so the common case (not opted in) costs nothing, and the
 * stored fingerprint short-circuits before any merge when nothing upstream changed.
 * Never rejects: this runs in the background off a drawer open, so a failure is logged
 * and recorded for the config editor to report rather than thrown at the moderator
 * mid-removal.
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
		const failure = (await readFailures())[subreddit]
		if (failure?.stage === 'save' && Date.now() - failure.at < saveFailureBackoffMs) {
			attempted.add(subreddit,)
			return {status: 'throttled',}
		}
		const last = (await readCooldowns())[subreddit]
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
		await recordFailure(subreddit, 'fetch', error,)
		return {status: 'failed',}
	}
	// The read got through, so any earlier failure is stale news.
	await clearFailure(subreddit,)

	// Recorded for forced runs too. It doubles as the "last checked" time the editor shows,
	// and a manual sync that left it looking stale would defeat the point of showing it.
	// Letting a manual sync start the next background cooldown is right regardless: the
	// data was just read, so re-reading it minutes later is the waste the throttle exists
	// to prevent.
	const cooldowns = await readCooldowns()
	await setCache(utils, cooldownCacheKey, {...cooldowns, [subreddit]: Date.now(),},)

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

	// saveToolboxConfig never rejects - it reports through toasts, which a silent background
	// write suppresses - so its returned result is the only way to tell a write that landed
	// from one that did not. Getting this wrong would be invisible in exactly the case that
	// matters: a moderator without wiki permission, whose sync can never succeed.
	let saveResult
	try {
		saveResult = await saveToolboxConfig(subreddit, next, 'sync removal reasons from Reddit', {silent,},)
	} catch (error: unknown) {
		// Documented not to reject, but a background caller must not be the one to find out.
		log.warn(`Could not save synced removal reasons for /r/${subreddit}:`, error,)
		await recordFailure(subreddit, 'save', error,)
		return {status: 'failed',}
	}
	if (!saveResult.ok) {
		log.warn(`Could not save synced removal reasons for /r/${subreddit}: ${saveResult.reason}`,)
		await recordFailure(
			subreddit,
			'save',
			saveResult.message
				?? (saveResult.reason === 'conflict'
					? 'another moderator changed the config first'
					: 'the config could not be written'),
		)
		return {status: 'failed',}
	}
	log.debug(
		`Synced native reasons for /r/${subreddit}: `
			+ `${result.added} added, ${result.updated} updated, ${result.removed} removed`,
	)
	return {status: 'synced', added: result.added, updated: result.updated, removed: result.removed,}
}
