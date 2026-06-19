/** Lifecycle helper for registering and running cleanup functions, with collected
 * event-listener and child-lifecycle teardown. */

type Cleanup = () => void | Promise<void>

/**
 * Throws a collected errors array: rethrows a single error directly, or wraps
 * multiple errors in an `AggregateError` with the given message.
 */
export function throwIfErrors (errors: unknown[], message: string,): void {
	if (errors.length === 1) {
		throw errors[0]
	}
	if (errors.length > 1) {
		throw new AggregateError(errors, message,)
	}
}

export interface Lifecycle {
	/** Register a cleanup function to run when this lifecycle is cleaned up. */
	mount(cleanup: Cleanup,): Cleanup
	/** Add an event listener and register its matching removal. */
	on<K extends keyof WindowEventMap,>(
		target: Window,
		type: K,
		listener: (event: WindowEventMap[K],) => void,
		options?: boolean | AddEventListenerOptions,
	): Cleanup
	on<K extends keyof DocumentEventMap,>(
		target: Document,
		type: K,
		listener: (event: DocumentEventMap[K],) => void,
		options?: boolean | AddEventListenerOptions,
	): Cleanup
	on<K extends keyof HTMLElementEventMap,>(
		target: HTMLElement,
		type: K,
		listener: (event: HTMLElementEventMap[K],) => void,
		options?: boolean | AddEventListenerOptions,
	): Cleanup
	on(
		target: EventTarget,
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	): Cleanup
	/** Attach a delegated event listener and register its matching removal. */
	delegate<E extends Event = Event,>(
		parent: Element | Document,
		type: string,
		selector: string,
		handler: (target: Element, event: E,) => void,
	): Cleanup
	/** Create a MutationObserver, start observing, and register `.disconnect()`. */
	observe(target: Node, callback: MutationCallback, options: MutationObserverInit,): Cleanup
	/** Start an interval and register `clearInterval`. */
	interval(handler: () => void, ms: number,): Cleanup
	/** Start a timeout and register `clearTimeout`. */
	timeout(handler: () => void, ms: number,): Cleanup
	/** Run registered cleanup functions in reverse registration order. */
	cleanup(): Promise<void>
}

/**
 * Owns side effects created during module initialization.
 *
 * Example:
 * ```ts
 * const lifecycle = createLifecycle();
 * lifecycle.on(window, 'resize', onResize);
 * lifecycle.interval(refresh, 60_000);
 * return lifecycle.cleanup;
 * ```
 */
export function createLifecycle (): Lifecycle {
	const cleanups: Cleanup[] = []

	const mount = (cleanup: Cleanup,): Cleanup => {
		cleanups.push(cleanup,)
		return cleanup
	}

	return {
		mount,
		on (
			target: EventTarget,
			type: string,
			listener: EventListenerOrEventListenerObject,
			options?: boolean | AddEventListenerOptions,
		) {
			target.addEventListener(type, listener, options,)
			return mount(() => target.removeEventListener(type, listener, options,))
		},
		delegate<E extends Event = Event,> (
			parent: Element | Document,
			type: string,
			selector: string,
			handler: (target: Element, event: E,) => void,
		) {
			const listener = (event: Event,) => {
				const target = (event.target as Element | null)?.closest(selector,)
				if (target && parent.contains(target,)) {
					handler(target, event as E,)
				}
			}
			parent.addEventListener(type, listener,)
			return mount(() => parent.removeEventListener(type, listener,))
		},
		observe (target: Node, callback: MutationCallback, options: MutationObserverInit,) {
			const observer = new MutationObserver(callback,)
			observer.observe(target, options,)
			return mount(() => observer.disconnect())
		},
		interval (handler: () => void, ms: number,) {
			const id = window.setInterval(handler, ms,)
			return mount(() => window.clearInterval(id,))
		},
		timeout (handler: () => void, ms: number,) {
			const id = window.setTimeout(handler, ms,)
			return mount(() => window.clearTimeout(id,))
		},
		async cleanup () {
			const errors: unknown[] = []
			for (const cleanup of cleanups.splice(0,).reverse()) {
				try {
					await cleanup()
				} catch (error) {
					errors.push(error,)
				}
			}
			throwIfErrors(errors, 'Lifecycle cleanup failed',)
		},
	}
}
