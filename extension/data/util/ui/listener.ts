/** The `TBNewThings` window-event signal: tells old-Reddit modules to re-scan after new things are injected. */

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
