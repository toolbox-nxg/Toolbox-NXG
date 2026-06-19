/**
 * Renders its children into a freshly-created shadow-DOM host appended to
 * `document.body`, while keeping them part of the surrounding React tree.
 *
 * The modbar lives in the light DOM (mounted via mountReactInLightBody) so its
 * own counter buttons stay reachable by other modules' `delegate(document.body, ...)`
 * handlers. Its drawers, however, hold real page <button>/<a> elements that RES
 * night mode (and subreddit stylesheets, and Reddit's own CSS) restyle through
 * the `.res-nightmode-button` class and friends. Wrapping a drawer in this
 * component moves its DOM into a shadow root - which page-level CSS cannot
 * pierce - without detaching it from the React tree, so props, state, context,
 * and the parent's ErrorBoundary all keep working. React events still bubble
 * through the React tree (not the DOM tree), and the drawers signal other modules
 * via CustomEvents dispatched directly on `document`, both of which cross the
 * shadow boundary unaffected.
 *
 * Dark-mode theming keeps working because the `--toolbox-*` custom properties are
 * set on `body.toolbox-scope` in the light DOM and inherit across the shadow
 * boundary (inheritance pierces shadow roots even though selectors do not) - the
 * same mechanism every other toolbox shadow mount relies on.
 */

import {ReactNode, useEffect, useState,} from 'react'
import {createPortal,} from 'react-dom'

import {applyStylesToShadow,} from '../../util/ui/reactMount'

/** Portals `children` into an isolated shadow-DOM host appended to `document.body`. */
export function ShadowPortal ({children,}: {children: ReactNode},) {
	const [shadowRoot, setShadowRoot,] = useState<ShadowRoot | null>(null,)

	useEffect(() => {
		const host = document.createElement('div',)
		host.classList.add('toolbox-react-shadow-host',)
		const root = host.attachShadow({mode: 'open',},)
		applyStylesToShadow(root,)
		document.body.appendChild(host,)
		setShadowRoot(root,)
		return () => {
			host.remove()
		}
	}, [],)

	// Nothing to portal into until the host exists (after the first commit).
	if (!shadowRoot) { return null }

	// Wrap in `.toolbox-scope` so legacy global CSS selectors prefixed with
	// `.toolbox-scope` (page.css) match inside the shadow root, matching the
	// wrapper that mountReactInBody applies.
	return createPortal(
		<div className="toolbox-scope">{children}</div>,
		shadowRoot,
	)
}
