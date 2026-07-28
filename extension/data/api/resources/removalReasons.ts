/** API functions for reading Reddit's native subreddit removal reasons and registering them on removed items. */

import {utils,} from '../../framework/moduleIds'
import {assertActionAllowed,} from '../../util/infra/captureGuard'
import {getCache, setCache,} from '../../util/persistence/cache'
import {postRedditApiVoid,} from '../parsers/redditMutation'
import {apiOauthGetJSON,} from '../transport/http'

/** A single native Reddit removal reason as configured in the subreddit's mod tools. */
export interface NativeRemovalReason {
	/** Reddit's opaque id for the reason, registered on removed items via the modactions API. */
	id: string
	title: string
	message: string
}

/**
 * Response shape of `GET /api/v1/{subreddit}/removal_reasons`: reasons keyed by id
 * plus an `order` array giving the moderator-configured display order.
 */
interface NativeRemovalReasonsResponse {
	data: Record<string, NativeRemovalReason>
	order: string[]
}

/** Cache key holding every subreddit's last-fetched native reasons, keyed by subreddit. */
const nativeReasonsCacheKey = 'nativeRemovalReasons'

/**
 * How long an in-memory entry stays fresh. The persisted layer has its own TTL from
 * the background cache handler; this shorter one keeps a single page session from
 * pinning a stale list indefinitely, which is what the equivalent module-level cache
 * in `modSubs.ts` does (it never expires and its clear function is never called).
 */
const inMemoryTtlMs = 60_000

/** Per-subreddit in-memory cache, so repeated drawer opens skip background IPC. */
const inMemoryNativeReasons = new Map<string, {reasons: NativeRemovalReason[]; expiresAt: number}>()

/**
 * Coalesces concurrent callers onto one in-flight fetch, keyed by subreddit so two
 * drawers opening on different subreddits don't share a result.
 */
const ongoingFetches = new Map<string, Promise<NativeRemovalReason[]>>()

/**
 * Clears cached native removal reasons.
 * @param subreddit The subreddit to forget; omit to clear every subreddit.
 */
export function clearNativeReasonsCache (subreddit?: string,): void {
	if (subreddit === undefined) {
		inMemoryNativeReasons.clear()
		return
	}
	inMemoryNativeReasons.delete(subreddit,)
}

/** Reads and orders a subreddit's native removal reasons straight from the API. */
async function fetchNativeRemovalReasons (subreddit: string,): Promise<NativeRemovalReason[]> {
	const response = await apiOauthGetJSON<NativeRemovalReasonsResponse>(
		`/api/v1/${subreddit}/removal_reasons`,
	)
	const byId = response.data ?? {}
	// `order` is the source of truth for display order; fall back to insertion order if it is
	// absent or stale. `noUncheckedIndexedAccess` widens the lookup to `| undefined`, so drop
	// any id in `order` that no longer has a matching entry.
	const ids = response.order?.length ? response.order : Object.keys(byId,)
	return ids.map((id,) => byId[id]).filter((reason,): reason is NativeRemovalReason => Boolean(reason,))
}

/**
 * Gets a subreddit's native (Reddit-configured) removal reasons, in the
 * moderator-configured display order. Returns an empty array when the subreddit
 * has none configured.
 *
 * Cached in memory and in extension storage, because the removal drawer consults
 * this on every open once a subreddit opts into syncing native reasons. A failed
 * fetch is never cached, so the next call retries.
 * @param subreddit The subreddit whose native reasons to read.
 * @param options Fetch options. `fresh` bypasses both cache layers and refreshes them.
 */
export const getNativeRemovalReasons = async (
	subreddit: string,
	options?: {fresh?: boolean},
): Promise<NativeRemovalReason[]> => {
	if (!options?.fresh) {
		const memory = inMemoryNativeReasons.get(subreddit,)
		if (memory && memory.expiresAt > Date.now()) { return memory.reasons }

		const ongoing = ongoingFetches.get(subreddit,)
		if (ongoing) { return ongoing }
	}

	const fetching = (async () => {
		if (!options?.fresh) {
			const cached = await getCache(utils, nativeReasonsCacheKey, {},) as Record<
				string,
				NativeRemovalReason[]
			>
			const stored = cached[subreddit]
			if (stored) {
				inMemoryNativeReasons.set(subreddit, {reasons: stored, expiresAt: Date.now() + inMemoryTtlMs,},)
				return stored
			}
		}

		const reasons = await fetchNativeRemovalReasons(subreddit,)
		inMemoryNativeReasons.set(subreddit, {reasons, expiresAt: Date.now() + inMemoryTtlMs,},)
		const cached = await getCache(utils, nativeReasonsCacheKey, {},) as Record<
			string,
			NativeRemovalReason[]
		>
		await setCache(utils, nativeReasonsCacheKey, {...cached, [subreddit]: reasons,},)
		return reasons
	})().finally(() => {
		ongoingFetches.delete(subreddit,)
	},)

	ongoingFetches.set(subreddit, fetching,)
	return fetching
}

/**
 * Registers a native removal reason against an already-removed item, recording it in
 * the subreddit's mod log. This only records the reason; it sends no message to the
 * user (message delivery is a separate endpoint).
 * @param options Registration options.
 * @param itemId Fullname of the already-removed item (e.g. `t3_abc123`).
 * @param reasonId Reddit reason id from {@link getNativeRemovalReasons}.
 * @param modNote Optional private mod note to attach to the removal.
 */
export const applyNativeRemovalReason = ({
	itemId,
	reasonId,
	modNote,
}: {
	itemId: string
	reasonId: string
	modNote?: string
},): Promise<void> => {
	// Registering a removal reason is a real moderation action; gate it by the training-mode
	// capture guard so a sandboxed trainee is blocked (the proposals gateway captures it properly).
	assertActionAllowed('applyNativeRemovalReason', {fullname: itemId,},)
	return postRedditApiVoid('/api/v1/modactions/removal_reasons', {
		type: 'json',
		data: {item_ids: [itemId,], reason_id: reasonId, ...(modNote ? {mod_note: modNote,} : {}),},
	},)
}
