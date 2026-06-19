/**
 * Per-subreddit index of recent mod-log activity, used to decide whether the inline "Recent actions"
 * button is worth showing on a given post/comment - and to feed the popup it opens.
 *
 * Reddit's `about/log` does not reliably filter by a single fullname, so - like the
 * {@link ItemHistoryPopup} the button opens - we fetch a recent window of the subreddit mod log
 * once (via the shared `getModLogEntries`) and remember it. The button only renders for items the window
 * touched, so it never opens a popup that would just read "No recent mod actions"; and the popup
 * reads back the same cached window instead of issuing a second identical request.
 *
 * The fetch is cached per subreddit (one request covers every item in that sub's feed) and the
 * store exposes a `useSyncExternalStore`-friendly subscribe/snapshot pair so the button appears as
 * soon as the log resolves. On a fetch error the window is left absent (button hidden, fail-closed)
 * and retried after a short cooldown, so a transient failure doesn't hide the button for the whole
 * session; the popup itself still surfaces a "mod log unavailable" message if opened by other means.
 */

import {getModLogEntries,} from '../../api/resources/subreddits'
import type {ModLogEntry,} from './modLog'

/** Cached mod-log window per subreddit (absent until fetched). */
const entriesBySub = new Map<string, ModLogEntry[]>()
/** Subreddits whose mod-log fetch is in flight, so we never request the same one twice. */
const inFlight = new Set<string>()
/** Wall-clock time (ms) of the last failed fetch per subreddit, used to back off then retry failures. */
const failedAt = new Map<string, number>()
/** Subscribers notified whenever a subreddit's window changes (for `useSyncExternalStore`). */
const listeners = new Set<() => void>()

/** How long to wait after a failed mod-log fetch before a later call retries that subreddit. */
const retryCooldownMs = 60 * 1000

/** Notifies all subscribers that the index changed. */
function emit (): void {
	for (const listener of listeners) { listener() }
}

/**
 * Fetches the subreddit mod log once and caches it. Safe to call repeatedly (and on every render):
 * a successful result is cached, concurrent calls are de-duplicated, and a failed fetch is retried
 * only after a cooldown - so a transient error neither hammers a failing endpoint nor hides the
 * "Recent actions" button for the rest of the session.
 * @param subreddit Bare subreddit name (no `r/` prefix).
 */
export function ensureRecentActionsLoaded (subreddit: string,): void {
	if (entriesBySub.has(subreddit,) || inFlight.has(subreddit,)) { return }
	// Back off after a failure so a persistently-failing sub isn't re-fetched on every row mount, but
	// still retry once the cooldown elapses (a transient error must not hide the button forever).
	const lastFailure = failedAt.get(subreddit,)
	if (lastFailure !== undefined && Date.now() - lastFailure < retryCooldownMs) { return }
	inFlight.add(subreddit,)
	getModLogEntries<ModLogEntry>(subreddit,).then((entries,) => {
		failedAt.delete(subreddit,)
		entriesBySub.set(subreddit, entries,)
	},).catch(() => {
		// Fail closed (the button stays hidden) but DON'T cache an empty window - that would hide the
		// button forever. Record the failure time so the next call retries once the cooldown elapses.
		failedAt.set(subreddit, Date.now(),)
	},).finally(() => {
		inFlight.delete(subreddit,)
		emit()
	},)
}

/**
 * Whether the given item has a recent mod-log action (and thus something for the "Recent actions"
 * popup to show). Returns `false` until the subreddit's log has been fetched via
 * {@link ensureRecentActionsLoaded}.
 * @param subreddit Bare subreddit name (no `r/` prefix).
 * @param itemId Thing fullname (`t3_...`/`t1_...`).
 */
export function itemHasRecentActions (subreddit: string, itemId: string,): boolean {
	return entriesBySub.get(subreddit,)?.some((entry,) => entry.target_fullname === itemId) ?? false
}

/**
 * The cached mod-log entries that target `itemId`, or `undefined` when the subreddit's window has
 * not been fetched yet. Lets the popup render from the already-fetched window instead of re-fetching.
 * @param subreddit Bare subreddit name (no `r/` prefix).
 * @param itemId Thing fullname (`t3_...`/`t1_...`).
 */
export function getRecentActions (subreddit: string, itemId: string,): ModLogEntry[] | undefined {
	return entriesBySub.get(subreddit,)?.filter((entry,) => entry.target_fullname === itemId)
}

/**
 * Subscribes to index changes.
 * @param listener Called on every change.
 * @returns An unsubscribe function.
 */
export function subscribeRecentActions (listener: () => void,): () => void {
	listeners.add(listener,)
	return () => {
		listeners.delete(listener,)
	}
}
