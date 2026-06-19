/**
 * Tiny in-memory pub/sub primitives shared by the various display stores (proposals
 * review-mode arming, proposals-changed notifications, usernote state). They exist so
 * each store stops re-implementing the same listener-set / subscribe / notify
 * boilerplate; the stores keep their own domain state and public API and delegate only
 * the subscription mechanics here.
 */

/** A subscribable event source carrying an argument of type `Arg` (defaults to none). */
export interface Emitter<Arg = void,> {
	/**
	 * Registers a listener.
	 * @param listener Called on every {@link Emitter.emit}.
	 * @returns An unsubscribe function.
	 */
	subscribe(listener: (arg: Arg,) => void,): () => void
	/**
	 * Notifies every current subscriber.
	 * @param arg The value passed to each listener.
	 */
	emit(arg: Arg,): void
}

/**
 * Creates a global event emitter — a single listener set with subscribe/emit. Use for
 * page-wide signals (no per-key scoping). Listeners are snapshotted on dispatch so one
 * that unsubscribes mid-emit can't mutate the set being iterated.
 */
export function createEmitter<Arg = void,> (): Emitter<Arg> {
	const listeners = new Set<(arg: Arg,) => void>()
	return {
		subscribe (listener,) {
			listeners.add(listener,)
			return () => {
				listeners.delete(listener,)
			}
		},
		emit (arg,) {
			for (const listener of [...listeners,]) { listener(arg,) }
		},
	}
}

/** A per-key value store: holds the latest value per key and notifies that key's subscribers. */
export interface KeyedStore<T,> {
	/**
	 * Returns the latest published value for a key, or undefined if none has been published.
	 * @param key The key to read.
	 */
	get(key: string,): T | undefined
	/**
	 * Stores a value for a key and notifies that key's subscribers.
	 * @param key The key to update.
	 * @param value The new value (passed to each listener).
	 */
	publish(key: string, value: T,): void
	/**
	 * Subscribes to value changes for a single key.
	 * @param key The key to watch.
	 * @param listener Called with the new value on every {@link KeyedStore.publish} for that key.
	 * @returns An unsubscribe function.
	 */
	subscribe(key: string, listener: (value: T,) => void,): () => void
}

/**
 * Creates a per-key value store: each key holds its latest value and its own listener
 * set, so a publish to one key only wakes that key's subscribers.
 */
export function createKeyedStore<T,> (): KeyedStore<T> {
	const values = new Map<string, T>()
	const listeners = new Map<string, Set<(value: T,) => void>>()
	return {
		get (key,) {
			return values.get(key,)
		},
		publish (key, value,) {
			values.set(key, value,)
			for (const listener of listeners.get(key,) ?? []) { listener(value,) }
		},
		subscribe (key, listener,) {
			let set = listeners.get(key,)
			if (!set) {
				set = new Set()
				listeners.set(key, set,)
			}
			set.add(listener,)
			return () => listeners.get(key,)?.delete(listener,)
		},
	}
}
