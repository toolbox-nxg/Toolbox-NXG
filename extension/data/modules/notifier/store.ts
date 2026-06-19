/** In-memory pub/sub store for moderation queue and modmail counters, shared across all modbar components. */

/** Current counts for all tracked moderation queues. */
export interface CounterState {
	modqueueCount: number
	/**
	 * Per-subreddit modqueue item counts, keyed by lowercase subreddit name.
	 * Derived by bucketing the aggregate modqueue listing, so counts are capped
	 * at the listing's fetch limit and only cover subreddits in the notifier's
	 * configured multireddit.
	 */
	modqueueBySubreddit: Record<string, number>
	unmoderatedCount: number
	modmailCount: number
	/** Per-category unread modmail counts (e.g. `new`, `inprogress`). */
	modmailCategoryCount: Record<string, number>
}

type CounterListener = (state: CounterState,) => void

let state: CounterState = {
	modqueueCount: 0,
	modqueueBySubreddit: {},
	unmoderatedCount: 0,
	modmailCount: 0,
	modmailCategoryCount: {},
}

const listeners = new Set<CounterListener>()

/** Returns the current counter state snapshot. */
export function getCounterState (): CounterState {
	return state
}

/**
 * Merges `patch` into the current counter state and notifies all subscribers.
 * @param patch Partial counter values to apply.
 */
export function updateCounters (patch: Partial<CounterState>,): void {
	if (!Object.keys(patch,).length) { return }
	state = {...state, ...patch,}
	for (const listener of listeners) {
		listener(state,)
	}
}

/**
 * Subscribes to counter state changes.
 * @returns An unsubscribe function that removes the listener when called.
 */
export function subscribeCounters (listener: CounterListener,): () => void {
	listeners.add(listener,)
	return () => listeners.delete(listener,)
}

/** Asks the notifier to re-fetch queue/modmail counts immediately. */
export function requestCounterRefresh (): void {
	window.dispatchEvent(new CustomEvent('TB_UPDATE_COUNTERS',),)
}
