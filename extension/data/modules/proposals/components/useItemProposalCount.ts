/**
 * Shared, per-subreddit computation of the open-proposal count for each item.
 *
 * A listing can hold dozens of {@link ProposalInlineBadge}s for the same subreddit. If each
 * badge subscribed to `onProposalsChanged` and re-filtered every proposal itself, one capture
 * would do O(items × proposals) work and fire O(items) listeners. Instead, all badges for a
 * subreddit share ONE proposals-changed subscription and ONE rescan per change here, which
 * builds an `itemId -> open-count` map they each read from.
 */

import {useCallback, useSyncExternalStore,} from 'react'

import {isModSub,} from '../../../api/resources/modSubs'
import {onProposalsChanged,} from '../../shared/proposals/events'
import {loadProposals,} from '../../shared/proposals/moduleapi'
import {openProposals,} from '../../shared/proposals/selectors'

/** Shared state for one subreddit: the current per-item counts and its badge subscribers. */
interface SubStore {
	/** itemId -> number of open proposals targeting it. */
	counts: Map<string, number>
	/** Badge re-render callbacks (from `useSyncExternalStore`). */
	listeners: Set<() => void>
	/** Disposes the shared `onProposalsChanged` subscription; null until the first subscriber. */
	off: (() => void) | null
}

/** Per-subreddit stores, created lazily on first subscriber and dropped on the last. */
const stores = new Map<string, SubStore>()

/** Returns the store for `subreddit`, creating an empty one if needed. */
function getStore (subreddit: string,): SubStore {
	let store = stores.get(subreddit,)
	if (!store) {
		store = {counts: new Map(), listeners: new Set(), off: null,}
		stores.set(subreddit, store,)
	}
	return store
}

/** Re-reads the subreddit's proposals (cache-coalesced) and rebuilds its per-item counts once. */
async function recompute (subreddit: string,): Promise<void> {
	const store = stores.get(subreddit,)
	if (!store) { return }
	// Proposals live on a mod-only NXG wiki page. On a user page the badges in view belong to
	// arbitrary subreddits the viewer doesn't moderate, so reading the page would just fire a
	// doomed request per sub. A non-mod has no proposals to count anyway - leave counts empty.
	if (!await isModSub(subreddit,)) { return }
	// The store may have been torn down (last badge unmounted) while the mod check was in flight.
	if (stores.get(subreddit,) !== store) { return }
	const data = await loadProposals(subreddit,)
	// The store may have been torn down (last badge unmounted) while the read was in flight.
	if (stores.get(subreddit,) !== store) { return }
	const counts = new Map<string, number>()
	for (const proposal of openProposals(data,)) {
		counts.set(proposal.itemId, (counts.get(proposal.itemId,) ?? 0) + 1,)
	}
	store.counts = counts
	for (const listener of store.listeners) { listener() }
}

/**
 * Subscribes a badge to its subreddit's counts. The first subscriber wires the shared
 * proposals-changed listener and kicks off the initial load; the last to leave tears it down.
 * @param subreddit The subreddit whose counts to track.
 * @param onChange Called when the counts change (a `useSyncExternalStore` re-render trigger).
 */
function subscribe (subreddit: string, onChange: () => void,): () => void {
	const store = getStore(subreddit,)
	store.listeners.add(onChange,)
	if (!store.off) {
		store.off = onProposalsChanged((changedSubreddit,) => {
			if (changedSubreddit === subreddit) { void recompute(subreddit,) }
		},)
		void recompute(subreddit,)
	}
	return () => {
		store.listeners.delete(onChange,)
		if (store.listeners.size === 0) {
			store.off?.()
			stores.delete(subreddit,)
		}
	}
}

/** The current open-proposal count for one item (0 when its store isn't loaded yet). */
function getCount (subreddit: string, itemId: string,): number {
	return stores.get(subreddit,)?.counts.get(itemId,) ?? 0
}

/**
 * Returns the number of open proposals targeting `itemId` in `subreddit`, kept current via a
 * subscription shared with every other badge for the same subreddit.
 * @param subreddit The subreddit the item belongs to.
 * @param itemId The thing's fullname.
 */
export function useItemProposalCount (subreddit: string, itemId: string,): number {
	const subscribeFn = useCallback((onChange: () => void,) => subscribe(subreddit, onChange,), [subreddit,],)
	const getSnapshot = useCallback(() => getCount(subreddit, itemId,), [subreddit, itemId,],)
	return useSyncExternalStore(subscribeFn, getSnapshot,)
}
