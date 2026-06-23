/** Tags an injected toolbox marker span so the stylesheets can lay out its author/post/comment UI. */

/**
 * Finds the `[data-name="toolbox"]` marker span inside `container` and tags it with the
 * `toolbox-frontend-container` class and a `data-toolbox-type` attribute, which the toolbox
 * stylesheets key off for per-context layout (e.g. `TBcommentAuthor`, `TBpost`). Idempotent: a
 * marker that is already tagged is left untouched.
 *
 * This replaces the legacy `tbReddit` CustomEvent round-trip - the dispatch sites now tag their
 * own freshly-injected marker synchronously instead of emitting an event for a listener to handle.
 * @param container The element holding the marker span (e.g. a `.toolbox-author-slot`).
 * @param type The toolbox type label written to `data-toolbox-type`.
 */
export function tagToolboxContainer (container: Element, type: string,): void {
	const marker = container.querySelector<HTMLElement>('[data-name="toolbox"]',)
	if (!marker || marker.classList.contains('toolbox-frontend-container',)) { return }
	marker.setAttribute('data-toolbox-type', type,)
	marker.classList.add('toolbox-frontend-container',)
}
