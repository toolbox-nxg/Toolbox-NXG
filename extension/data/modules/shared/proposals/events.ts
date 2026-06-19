/**
 * In-document change notifications + a small session cache for proposals data.
 *
 * Display surfaces (inline badges, review list, modbar count) read from the cache
 * and re-render when {@link emitProposalsChanged} fires after a mutation, so they
 * never write the wiki as a side effect of rendering and never poll. This is a
 * plain in-memory emitter (no DOM/`CustomEvent` dependency) so it works the same
 * in tests and in the worker/content contexts.
 *
 * Cross-tab propagation rides the existing `toolbox-global` broadcast: a local
 * mutation calls {@link broadcastProposalsChanged}, the background fans the event
 * out to every other Reddit tab (excluding the sender), and each tab's
 * {@link setupProposalsCrossTab} receiver refreshes its cache from the payload and
 * fires {@link emitProposalsChanged} locally. The send and the local emit are kept
 * separate so the receiver never re-broadcasts (which would echo-loop).
 */

import browser from 'webextension-polyfill'

import type {TbGlobalMessage,} from '../../../background/messages'
import {createEmitter,} from '../../../util/data/pubsub'
import createLogger from '../../../util/infra/logging'
import {events,} from '../../../util/reddit/events'
import type {ProposalsData,} from '../../../util/wiki/schemas/proposals/schema'

declare global {
	interface WindowEventMap {
		TB_PROPOSALS_CHANGED: CustomEvent
	}
}

const log = createLogger('Proposals',)

/** A change listener invoked with the subreddit whose proposals changed. */
type ProposalsListener = (subreddit: string,) => void

const changes = createEmitter<string>()

/**
 * Subscribes to proposals-changed notifications.
 * @param listener Called with the affected subreddit after each mutation.
 * @returns An unsubscribe function.
 */
export function onProposalsChanged (listener: ProposalsListener,): () => void {
	return changes.subscribe(listener,)
}

/**
 * Notifies all subscribers that a subreddit's proposals changed.
 * @param subreddit The subreddit whose proposals changed.
 */
export function emitProposalsChanged (subreddit: string,): void {
	changes.emit(subreddit,)
}

/** A cached entry: the data plus a freshness timestamp. */
interface CacheEntry {
	data: ProposalsData
	/** `Date.now()` when this tab last stored `data` (freshness only). */
	cachedAt: number
}

/** Session cache of the last-known proposals data per subreddit (display reads). */
const cache = new Map<string, CacheEntry>()

/** The page version of a cached/candidate payload; absent (legacy) counts as 0. */
function seqOf (data: ProposalsData,): number {
	return data.seq ?? 0
}

/**
 * Returns the cached proposals data for a subreddit, or undefined if not cached.
 * @param subreddit The subreddit to look up.
 */
export function getCachedProposals (subreddit: string,): ProposalsData | undefined {
	return cache.get(subreddit,)?.data
}

/**
 * Returns whether a subreddit's cache exists and is younger than `maxAgeMs`. Used by
 * the cross-subreddit fan-out to skip re-fetching subs whose data is still fresh
 * while refreshing stale ones, so reopening the drawer doesn't re-scan every wiki.
 * @param subreddit The subreddit to check.
 * @param maxAgeMs Maximum age in milliseconds for the cache to count as fresh.
 * @param now Current epoch milliseconds (injectable for tests; defaults to now).
 */
export function isProposalsCacheFresh (
	subreddit: string,
	maxAgeMs: number,
	now: number = Date.now(),
): boolean {
	const entry = cache.get(subreddit,)
	return entry !== undefined && now - entry.cachedAt <= maxAgeMs
}

/**
 * Stores proposals data in the session cache, **monotonically by page version**: a
 * candidate whose `seq` is strictly lower than what's already cached is ignored, so no
 * source - a lagged read, a local commit, or a cross-tab broadcast - can ever roll the
 * cache (and the UI reading through it) backward. Equal-or-higher `seq` replaces the
 * entry and refreshes its freshness time. The post-write in-memory state is
 * authoritative (we do not re-read immediately, given the ~190 ms read-after-write lag).
 * @param subreddit The subreddit to cache.
 * @param data The proposals data to store (its `seq` orders it against the cache).
 * @returns Whether the cache changed (false when an older candidate was ignored), so
 *   callers can re-render only on a real advance.
 */
export function setCachedProposals (subreddit: string, data: ProposalsData,): boolean {
	const existing = cache.get(subreddit,)
	if (existing !== undefined && seqOf(data,) < seqOf(existing.data,)) {
		return false
	}
	cache.set(subreddit, {data, cachedAt: Date.now(),},)
	return true
}

/**
 * Drops a subreddit's cached proposals (or all of them when no subreddit is
 * given), forcing the next display read to fetch fresh.
 * @param subreddit The subreddit to invalidate, or omit to clear everything.
 */
export function invalidateProposalsCache (subreddit?: string,): void {
	if (subreddit === undefined) {
		cache.clear()
	} else {
		cache.delete(subreddit,)
	}
}

/** The shape carried in a {@link TB_PROPOSALS_CHANGED} cross-tab message payload. */
interface ProposalsChangedPayload {
	/** The subreddit whose proposals changed. */
	subreddit: string
	/**
	 * The authoritative post-mutation data, so receivers skip a lagged re-read. It
	 * carries its own `seq` page version, which the receiver uses to order it against
	 * whatever it already holds (so a delayed older broadcast can't roll the cache back).
	 */
	data?: ProposalsData
}

/**
 * Broadcasts a local proposals mutation to every other open Reddit tab via the
 * `toolbox-global` bridge. The background re-dispatches it as a `TB_PROPOSALS_CHANGED`
 * window event in each tab (excluding this one), where {@link setupProposalsCrossTab}
 * picks it up. Fire-and-forget: a failed send must never reject the mutation that
 * triggered it, so transport errors are swallowed (logged only).
 *
 * The post-write `data` is shipped in the payload so receivers update their cache
 * directly rather than re-reading the wiki - the same "trust the in-memory post-write
 * state" stance the writer takes (~190 ms read-after-write lag). The data's own `seq`
 * page version is what lets receivers order concurrent/delayed broadcasts.
 * @param subreddit The subreddit whose proposals changed.
 * @param data The authoritative proposals data after the mutation.
 */
export function broadcastProposalsChanged (subreddit: string, data: ProposalsData,): void {
	const message: TbGlobalMessage = {
		action: 'toolbox-global',
		globalEvent: events.TB_PROPOSALS_CHANGED,
		// Tabs only: the background has no proposals cache or display surfaces.
		excludeBackground: true,
		payload: {subreddit, data,} satisfies ProposalsChangedPayload,
	}
	browser.runtime.sendMessage(message,).catch((error: unknown,) => {
		log.debug('failed to broadcast proposals change', error,)
	},)
}

/** Set once {@link setupProposalsCrossTab} has installed its window listener. */
let crossTabInstalled = false

/**
 * Installs the receiver for cross-tab proposals changes. Called once at startup
 * (after the message bridge is up). On a `TB_PROPOSALS_CHANGED` event from another
 * tab it refreshes this tab's cache from the payload (or invalidates it when the
 * payload is unusable) and fires {@link emitProposalsChanged} so display surfaces
 * re-render. It deliberately does NOT re-broadcast, so a received change can't echo
 * back out and loop between tabs. Idempotent.
 */
export function setupProposalsCrossTab (): void {
	if (crossTabInstalled) {
		return
	}
	crossTabInstalled = true
	window.addEventListener('TB_PROPOSALS_CHANGED', (event,) => {
		const detail = event.detail as Partial<ProposalsChangedPayload> | undefined
		const subreddit = detail?.subreddit
		if (typeof subreddit !== 'string' || !subreddit) {
			return
		}
		const hasData = detail?.data != null && typeof detail.data === 'object' && 'proposals' in detail.data
		if (hasData) {
			// The monotonic cache orders the payload by its `seq` page version and ignores
			// it if older than what we already hold - so an out-of-order or delayed
			// broadcast (or one arriving after this tab made its own newer commit) can't
			// roll the cache backward. Re-render only when it actually advanced.
			if (setCachedProposals(subreddit, detail.data as ProposalsData,)) {
				emitProposalsChanged(subreddit,)
			}
		} else {
			// No usable data (e.g. a future/foreign sender): we can't merge or order it, so
			// drop the entry and let the next read fetch the canonical page.
			invalidateProposalsCache(subreddit,)
			emitProposalsChanged(subreddit,)
		}
	},)
}
