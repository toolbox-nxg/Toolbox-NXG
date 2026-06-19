/**
 * Shared teardown guard for the old-Reddit button features that inject UI into things
 * via `forEachChunkedDynamic`. That helper snapshots its input and processes it across
 * animation frames with no cancellation, so a module teardown mid-run could otherwise
 * inject DOM after cleanup. Each such feature stamps a per-element marker class on the
 * things it has processed; this guard owns the matching teardown (flip a disposed flag
 * and strip every marker so a re-init re-processes) and exposes the flag for the
 * processor to bail on.
 */

import type {Lifecycle,} from '../../../framework/lifecycle'

/** A teardown-aware guard for chunked DOM processing. */
export interface DisposalGuard {
	/** Whether the owning lifecycle has torn down; check before each cross-frame DOM write. */
	isDisposed(): boolean
}

/**
 * Registers a teardown on `scope` that marks the guard disposed and removes every
 * `markerClass` from the document, then returns the guard.
 * @param scope The lifecycle whose teardown flips the flag and clears the markers.
 * @param markerClass The CSS class the feature stamps on each processed element.
 */
export function createDisposalGuard (scope: Lifecycle, markerClass: string,): DisposalGuard {
	let disposed = false
	scope.mount(() => {
		disposed = true
		document.querySelectorAll(`.${markerClass}`,)
			.forEach((el,) => el.classList.remove(markerClass,))
	},)
	return {isDisposed: () => disposed,}
}
