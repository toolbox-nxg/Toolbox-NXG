/** DOM utility functions: query helpers, element creation, event delegation, and shared mutation observer. */

/** Shorthand for `element.querySelector`. */
export function qs<T extends Element = Element,> (selector: string, parent: Element | Document = document,): T | null {
	return parent.querySelector<T>(selector,)
}

/** Shorthand for `element.querySelectorAll`, returning a plain array. */
export function qsa<T extends Element = Element,> (selector: string, parent: Element | Document = document,): T[] {
	return Array.from(parent.querySelectorAll<T>(selector,),)
}

/**
 * Creates an `HTMLElement` from an HTML string. The string must have a single
 * root element. Returns that root element.
 */
export function html<T extends HTMLElement = HTMLElement,> (str: string,): T {
	const template = document.createElement('template',)
	template.innerHTML = str.trim()
	return template.content.firstElementChild as T
}

/**
 * Attaches a delegated event listener to `parent` that fires `handler` when
 * an event of `type` bubbles up from a descendant matching `selector`.
 * The handler receives the original event and the matching descendant element.
 */
export function delegate<E extends Event = Event,> (
	parent: Element | Document,
	type: string,
	selector: string,
	handler: (target: Element, event: E,) => void,
): void {
	parent.addEventListener(type, (event,) => {
		const path = event.composedPath()
		const target = path
			.filter((node,): node is Element => node instanceof Element)
			.map((node,) => node.matches(selector,) ? node : node.closest(selector,))
			.find((node,): node is Element => !!node)
		const inParent = parent instanceof Document
			? path.includes(parent,) || path.includes(parent.body,)
			: path.includes(parent,)

		if (target && inParent) {
			handler(target, event as E,)
		}
	},)
}

/**
 * Resolves once the document reaches at least `interactive` readiness - the DOM
 * is parsed, though sub-resources may still be loading.
 */
export const documentInteractive = new Promise<void>((resolve,) => {
	if (document.readyState === 'interactive' || document.readyState === 'complete') {
		resolve()
	} else {
		const listener = () => {
			if (document.readyState === 'interactive' || document.readyState === 'complete') {
				document.removeEventListener('readystatechange', listener,)
				resolve()
			}
		}
		document.addEventListener('readystatechange', listener,)
	}
},)

// Handlers still waiting for their element to attach
let pendingElementHandlers: [element: HTMLElement, handler: () => void,][] = []

/** Runs a callback once the given element is attached to the DOM. */
export function onDOMAttach (element: HTMLElement, handler: () => void,) {
	pendingElementHandlers.push([element, handler,],)
}

// Module-level callbacks that want to share the global document observer
// instead of creating their own. Returns a deregistration function.
const sharedMutationCallbacks = new Set<MutationCallback>()

/**
 * Registers a MutationCallback to run on the shared document observer
 * ({childList, subtree}). Returns a cleanup function that deregisters it.
 * Use this instead of `lifecycle.observe(document.body, ...)` to avoid
 * creating redundant observers.
 */
export function onSharedMutation (callback: MutationCallback,): () => void {
	sharedMutationCallbacks.add(callback,)
	return () => sharedMutationCallbacks.delete(callback,)
}

// Single shared observer for both onDOMAttach and onSharedMutation subscribers.
new MutationObserver((mutations, observer,) => {
	// Dispatch to registered module-level callbacks first.
	for (const cb of sharedMutationCallbacks) {
		cb(mutations, observer,)
	}

	// go through the array and see if each element is present yet
	if (pendingElementHandlers.length > 0) {
		pendingElementHandlers = pendingElementHandlers.filter(([element, handler,],) => {
			if (document.contains(element,)) {
				// element is on the page, call its handler and remove from array
				handler()
				return false
			}

			// element is not on page yet, keep it in the array
			return true
		},)
	}
},).observe(document, {
	childList: true,
	subtree: true,
},)
