/** TBListener: an event bus that bridges Reddit's `tbReddit` DOM custom events to Toolbox module callbacks. */

import createLogger from '../infra/logging'

const log = createLogger('TBListener',)

/** Stores the event detail for each toolbox frontend container element. */
export const elementDetails = new WeakMap<HTMLElement, any>()

export interface TBListenerEvent {
	detail: any
	target: HTMLElement
}

type ListenerCallback = (this: HTMLElement, event: TBListenerEvent,) => void

/** Maps specific event types to their aliases (e.g. `TBpostAuthor` -> `author`). */
const listenerAliases: Record<string, string[]> = {
	TBcommentAuthor: ['author',],
	TBpostAuthor: ['author',],
	TBcomment: ['comment',],
	TBcommentOldReddit: ['comment',],
	TBmodmailAuthor: ['author',],
	TBpost: ['post',],
}

/**
 * Drains the task queue, invoking each queued callback in turn until none are
 * left so the batch is always fully flushed.
 *
 * @private
 */
function runTasks (tasks: Array<() => void>,) {
	log.debug('run tasks',)
	let task: (() => void) | undefined
	while ((task = tasks.shift())) {
		task()
	}
}

/**
 * Removes the first occurrence of an item from an array.
 */
function remove<T,> (array: T[], item: T,): boolean {
	const index = array.indexOf(item,)
	if (index === -1) { return false }
	array.splice(index, 1,)
	return true
}

class TBListener {
	private queue: Array<() => void>
	private boundFunc: (event: CustomEvent,) => void
	private listeners: Record<string, ListenerCallback[]>
	private started: boolean
	debugFunc: ((this: HTMLElement, event: TBListenerEvent,) => void) | null
	catch?: (error: Error,) => void
	private scheduled: boolean

	/**
	 * Create a new instance of TBListener. Nothing happens yet until TBListener.start() has been called
	 */
	constructor () {
		// Simple array holding callbacks waiting to be handled.
		// If you want to put something in here directly, make sure to call scheduleFlush()
		this.queue = []

		// Holding a reference to the bound function so `removeEventListener` can be called later
		this.boundFunc = this.listener.bind(this,)

		// Object holding all registered listeners.
		// Keys are listener names, with arrays of callbacks as their values
		this.listeners = {}

		// Used by stop() and start()
		this.started = false

		this.debugFunc = null

		this.scheduled = false
	}

	/**
	 * Starts the TBListener instance by registering an event listener for `tbReddit` events.
	 *
	 * A `TBListenerLoaded` event is fired when everything is ready.
	 */
	start () {
		if (!this.started) {
			const loadedEvent = new CustomEvent('TBListenerLoaded',)
			document.addEventListener('tbReddit', this.boundFunc as EventListener, true,)
			document.dispatchEvent(loadedEvent,)
			this.started = true
		}
	}

	/**
	 * Unregisters this instance's event listener
	 */
	stop () {
		if (this.started) {
			document.removeEventListener('tbReddit', this.boundFunc as EventListener,)
			this.started = false
		}
	}

	/**
	 * Register an event listener for a given event name for a callback.
	 * Returns an unsubscribe function that removes this specific callback.
	 */
	on (event: string, callback: ListenerCallback,): () => void {
		if (!this.listeners[event]) {
			this.listeners[event] = []
		}

		this.listeners[event]!.push(callback,)
		return () => remove(this.listeners[event]!, callback,)
	}

	/** @private */
	listener (event: CustomEvent,) {
		const eventType = event.detail.type
		// composedPath()[0] gives the actual dispatching element even when the event
		// crosses a shadow DOM boundary (where event.target is retargeted to the host).
		const path = event.composedPath()
		const eventTarget = (path.length > 0 ? path[0] : event.target) as HTMLElement
		const target = eventTarget.querySelector<HTMLElement>('[data-name="toolbox"]',)

		// If there is no target this is not for us.
		if (!target) {
			return
		}

		// We already have seen this attribute and do not need duplicates.
		if (target.classList.contains('toolbox-frontend-container',)) {
			return
		}

		elementDetails.set(target, event.detail,)
		target.setAttribute('data-toolbox-type', event.detail.type,)
		target.classList.add('toolbox-frontend-container',)

		const internalEvent: TBListenerEvent = {
			detail: event.detail,
			target,
		}

		// See if there's any registered listeners listening for eventType
		if (Array.isArray(this.listeners[eventType],)) {
			for (const listener of this.listeners[eventType]) {
				this.queue.push(listener.bind(target, internalEvent,),)
			}
		}

		// Check and see if there are any aliases for `eventType` and run those on the queue
		if (Array.isArray(listenerAliases[eventType],)) {
			for (const alias of listenerAliases[eventType]) {
				if (Array.isArray(this.listeners[alias],)) {
					for (const listener of this.listeners[alias]) {
						this.queue.push(listener.bind(target, internalEvent,),)
					}
				}
			}
		}

		// Run the debug function on the queue, if there's any
		if (this.debugFunc) {
			this.queue.push(this.debugFunc.bind(target, internalEvent,),)
		}

		// Flush the queue
		this.scheduleFlush()
	}

	/**
	 * Clears a scheduled task.
	 */
	clear (task: () => void,): boolean {
		return remove(this.queue, task,)
	}

	/**
	 * Schedules a new read/write batch if one isn't pending.
	 * @private
	 */
	private scheduleFlush () {
		if (!this.scheduled) {
			this.scheduled = true
			requestAnimationFrame(this.flush.bind(this,),)
		}
	}

	/**
	 * Runs queued tasks.
	 * @private
	 */
	private flush () {
		const queue = this.queue
		let error: Error | undefined

		try {
			runTasks(queue,)
		} catch (e) {
			error = e as Error
		}

		this.scheduled = false

		// If the batch errored we may still have tasks queued
		if (queue.length) {
			this.scheduleFlush()
		}

		if (error) {
			log.error('task errored', error.message,)
			if (this.catch) {
				this.catch(error,)
			} else {
				throw error
			}
		}
	}
}

const tbListener = new TBListener()
export default tbListener

/**
 * Dispatches a `TBNewThings` event on `window`, signalling that new Reddit
 * things have been injected into the DOM and modules should re-scan.
 * Used on old Reddit only - new Reddit uses the shared MutationObserver instead.
 */
export function notifyNewThings (): void {
	window.dispatchEvent(new CustomEvent('TBNewThings',),)
}

declare global {
	interface WindowEventMap {
		TBNewThings: CustomEvent
	}
}
