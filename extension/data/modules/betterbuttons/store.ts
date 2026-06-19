/**
 * Shared pub/sub for the Better Buttons distinguish-toggle feature: tracks each comment's
 * distinguished state so the injected sticky links (React components) can react when the
 * `distinguishClicked` handler reports a change.
 */

/** Callback invoked whenever the distinguished state of a thing changes. */
type DistinguishListener = (isDistinguished: boolean,) => void

/** Per-thing registry of listeners watching distinguished state after the latest action. */
const distinguishListeners = new Map<string, Set<DistinguishListener>>()

/**
 * Notifies all listeners registered for `thingId` of its new distinguished state.
 * @param thingId The fullname of the thing whose state changed.
 * @param isDistinguished Whether the thing is now distinguished.
 */
export function publishDistinguishState (thingId: string, isDistinguished: boolean,): void {
	for (const listener of distinguishListeners.get(thingId,) ?? []) { listener(isDistinguished,) }
}

/**
 * Registers a listener for the distinguished state of a thing.
 * @param thingId The fullname of the thing to watch.
 * @param listener Called whenever the distinguished state changes.
 * @returns A cleanup function that removes the listener.
 */
export function subscribeDistinguishState (thingId: string, listener: DistinguishListener,): () => void {
	if (!distinguishListeners.has(thingId,)) { distinguishListeners.set(thingId, new Set(),) }
	distinguishListeners.get(thingId,)!.add(listener,)
	return () => distinguishListeners.get(thingId,)?.delete(listener,)
}
