/**
 * Per-thing "review mode" - a moderator can arm an item so that their next moderation
 * action on it is captured as a second-opinion proposal instead of being performed live.
 *
 * This is a tiny in-memory registry keyed by item fullname, shared between the inline
 * toggle (which flips it) and the gateway's {@link maybePropose} (which consults it at the
 * single capture chokepoint, so *any* gateway-routed action - approve, remove, lock, a
 * removal-reason send, ... - on that item is captured while the flag is set). The flag is
 * cleared once an action is captured, so it behaves as a one-shot arm rather than a sticky
 * mode that could silently capture later, unrelated actions.
 */

import {createEmitter,} from '../../../util/data/pubsub'

/** Fullnames currently armed for second-opinion capture. */
const marked = new Set<string>()
/** Subscribers notified whenever the armed set changes (for `useSyncExternalStore`). */
const changes = createEmitter()

/**
 * Whether the given item is armed for second-opinion capture.
 * @param itemId The thing fullname.
 */
export function isMarkedForReview (itemId: string,): boolean {
	return marked.has(itemId,)
}

/**
 * Arms or disarms an item for second-opinion capture.
 * @param itemId The thing fullname.
 * @param on `true` to arm, `false` to disarm.
 */
export function setReviewMode (itemId: string, on: boolean,): void {
	const changed = on ? !marked.has(itemId,) : marked.has(itemId,)
	if (!changed) { return }
	if (on) { marked.add(itemId,) }
	else { marked.delete(itemId,) }
	changes.emit()
}

/**
 * Toggles an item's armed state.
 * @param itemId The thing fullname.
 */
export function toggleReviewMode (itemId: string,): void {
	setReviewMode(itemId, !marked.has(itemId,),)
}

/**
 * Subscribes to armed-set changes.
 * @param listener Called on every change.
 * @returns An unsubscribe function.
 */
export function subscribeReviewMode (listener: () => void,): () => void {
	return changes.subscribe(listener,)
}
