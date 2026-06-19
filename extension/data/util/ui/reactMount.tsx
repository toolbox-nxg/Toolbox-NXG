/** Utilities for mounting React content into shadow DOM and light DOM contexts, with bundled stylesheet injection. */

// Utilities for mounting React content into shadow DOM and vanilla DOM contexts.

import {ReactElement, ReactNode,} from 'react'
import {createRoot,} from 'react-dom/client'
import {onDOMAttach,} from './dom'
import {clampIntoViewport,} from './drawPosition'

import browser from 'webextension-polyfill'
import {type Lifecycle,} from '../../framework/lifecycle'
import {ErrorBoundary,} from '../../shared/app/ErrorBoundary'

const bundledCssUrl = browser.runtime.getURL('data/bundled.css',)

// Eagerly fetch the bundled CSS as a constructable CSSStyleSheet so it can be
// applied synchronously via adoptedStyleSheets. This eliminates the one-frame
// FOUC that occurs when a <link> element is used inside each new shadow root.
let adoptedSheet: CSSStyleSheet | null = null
fetch(bundledCssUrl,)
	.then((r,) => r.text())
	.then((css,) => {
		const sheet = new CSSStyleSheet()
		sheet.replaceSync(css,)
		adoptedSheet = sheet
	},)
	.catch(() => {},) // fall back to <link> on failure

// Attach the bundled stylesheet to a shadow root. Uses adoptedStyleSheets when
// available (synchronous, no FOUC), otherwise falls back to a <link> element.
export function applyStylesToShadow (shadowRoot: ShadowRoot,) {
	if (adoptedSheet) {
		try {
			shadowRoot.adoptedStyleSheets = [adoptedSheet,]
			return
		} catch {
			// On Firefox a content script cannot assign a sandbox-constructed
			// CSSStyleSheet to a page-document shadow root: the assignment goes
			// through an Xray wrapper which refuses with "Accessing from Xray
			// wrapper is not supported." Disable the optimization permanently so
			// every subsequent mount goes straight to the <link> fallback below.
			adoptedSheet = null
		}
	}
	const link = document.createElement('link',)
	link.rel = 'stylesheet'
	link.type = 'text/css'
	link.href = bundledCssUrl
	shadowRoot.appendChild(link,)
}

function ensureBundledStylesheetInDocument () {
	if (!document.head.querySelector(`link[href="${bundledCssUrl}"]`,)) {
		const link = document.createElement('link',)
		link.rel = 'stylesheet'
		link.type = 'text/css'
		link.href = bundledCssUrl
		document.head.appendChild(link,)
	}
}

/**
 * Returns a DOM element which renders the given React/JSX content when
 * added to the page. Defaults to a `div`; pass `tag` to use a different element.
 */
export function reactRenderer (content: ReactNode, tag: keyof HTMLElementTagNameMap = 'div',) {
	const contentShadowHost = document.createElement(tag,)
	contentShadowHost.classList.add('toolbox-react-shadow-host',)
	const shadowRoot = contentShadowHost.attachShadow({mode: 'open',},)
	onDOMAttach(contentShadowHost, () => {
		applyStylesToShadow(shadowRoot,)
		createRoot(shadowRoot,).render(content,)
	},)
	return contentShadowHost
}

/**
 * Imperatively mount React content into a freshly-created shadow host appended
 * to `document.body`. Returns the host element and an `unmount` function that
 * tears down the React root and removes the host. Use this when the popup is
 * triggered by a non-React DOM event (e.g. a `delegate(document.body, 'click', ...)`
 * handler reacting to a click on a button injected into Reddit's DOM).
 */
export function mountReactInBody (content: ReactNode, name?: string,): {host: HTMLElement; unmount: () => void} {
	const host = document.createElement('div',)
	host.classList.add('toolbox-react-shadow-host',)
	const shadowRoot = host.attachShadow({mode: 'open',},)
	document.body.append(host,)
	applyStylesToShadow(shadowRoot,)
	const root = createRoot(shadowRoot,)
	// Wrap content in `.toolbox-scope` so legacy global CSS selectors prefixed
	// with `.toolbox-scope` (page.css) match inside the shadow root.
	root.render(
		<div className="toolbox-scope">
			<ErrorBoundary name={name}>{content}</ErrorBoundary>
		</div>,
	)
	return {
		host,
		unmount: () => {
			root.unmount()
			host.remove()
		},
	}
}

/**
 * Imperatively mount React content into a freshly-created light-DOM `<div>`
 * appended to `document.body`. Unlike {@link mountReactInBody}, this does not
 * use a shadow root - useful when the rendered content needs to be reachable
 * by `delegate(document.body, ...)` handlers in other modules (e.g., the modbar
 * "my subreddits" popup whose rows are clicked by queue_overlay.js handlers).
 */
export function mountReactInLightBody (content: ReactNode, name?: string,): {host: HTMLElement; unmount: () => void} {
	ensureBundledStylesheetInDocument()
	const host = document.createElement('div',)
	host.classList.add('toolbox-react-light-host', 'toolbox-scope',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	root.render(<ErrorBoundary name={name}>{content}</ErrorBoundary>,)
	return {
		host,
		unmount: () => {
			root.unmount()
			host.remove()
		},
	}
}

/** A live, de-duplicated popup tracked by {@link mountPopup}'s registry. */
interface PopupRegistryEntry {
	host: HTMLElement
	cleanup: () => void
	reveal: () => void
}

// Registry of currently-open keyed popups, so a second open of the same identity
// reveals the existing popup instead of mounting a duplicate (which would lose any
// text already typed into it). Mirrors the dedup-by-identity Map pattern used by
// showConfigOverlay (config/components/ConfigOverlay.tsx).
const popupRegistry = new Map<string, PopupRegistryEntry>()

// Monotonically increasing z-index handed out on each reveal so the most recently
// revealed popup sits above all the others. Starts below makeDraggable's drag value
// (2147483647) and the in-drag layer, leaving headroom beneath the max int.
let topPopupZIndex = 2147483000

/**
 * Brings an already-open popup back to the user: raises it above other popups,
 * snaps it back on-screen if it was dragged out of view, and moves focus into it.
 *
 * Operates generically over the popup's shadow host - every draggable popup renders
 * exactly one `[role="dialog"]` (the Window component), so a single query locates it
 * regardless of the component nesting. The dialog is queried lazily each call so a
 * React re-render that replaced the node does not leave us with a stale reference.
 */
function revealPopupHost (host: HTMLElement,): void {
	const dialog = host.shadowRoot?.querySelector<HTMLElement>('[role="dialog"]',)
	if (!dialog) { return }

	// Raise above every other popup.
	topPopupZIndex += 1
	dialog.style.zIndex = String(topPopupZIndex,)

	// Recover into the viewport, but only if it has been dragged (partly) off-screen
	// - a popup the user can already see should stay exactly where they left it.
	const rect = dialog.getBoundingClientRect()
	const width = rect.width || 700
	const height = rect.height || 500
	const curLeft = rect.left + window.scrollX
	const curTop = rect.top + window.scrollY
	const clamped = clampIntoViewport(curLeft, curTop, width, height,)
	if (clamped.left !== curLeft || clamped.top !== curTop) {
		dialog.style.left = `${clamped.left}px`
		dialog.style.top = `${clamped.top}px`
		dialog.style.right = 'auto'
		dialog.style.bottom = 'auto'
	}

	// Move focus into the popup. preventScroll matches Window's own focus behaviour
	// and avoids yanking the page when the popup is near a viewport edge.
	const focusable = dialog.querySelector<HTMLElement>(
		'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
	)
	;(focusable ?? dialog).focus({preventScroll: true,},)
}

/**
 * Mounts a popup component into `document.body` and wires up cleanup. The
 * `factory` receives the cleanup function as its `onClose` so the component
 * can close itself. The returned function tears down the popup and optionally
 * calls an external `onClose` callback.
 *
 * Eliminates the repeated let-mounted / cleanup boilerplate in every showXxx()
 * function across the codebase.
 *
 * Pass `key` to deduplicate by identity: if a popup with the same key is already
 * open, no duplicate is mounted - the existing one is revealed (raised, recovered
 * on-screen, focused) and its cleanup is returned. Use a per-target key (e.g.
 * `usernote:${subreddit}:${user}`) so distinct targets each get their own popup
 * while re-opening the same target reveals the live instance.
 */
export function mountPopup (
	factory: (onClose: () => void,) => ReactElement,
	onClose?: () => void,
	key?: string,
): () => void {
	if (key != null) {
		const existing = popupRegistry.get(key,)
		if (existing) {
			existing.reveal()
			return existing.cleanup
		}
	}
	let mounted: {host: HTMLElement; unmount: () => void} | null = null
	const cleanup = () => {
		mounted?.unmount()
		mounted = null
		// Delete before onClose so the registry entry is gone even if onClose throws.
		if (key != null) { popupRegistry.delete(key,) }
		onClose?.()
	}
	mounted = mountReactInBody(factory(cleanup,),)
	if (key != null) {
		const {host,} = mounted
		popupRegistry.set(key, {host, cleanup, reveal: () => revealPopupHost(host,),},)
	}
	return cleanup
}

/**
 * Joins a mix of strings and falsy values into one space-separated `className`,
 * discarding anything falsy.
 */
export function classes (...stuff: (string | false | null | undefined)[]) {
	return stuff.flat().filter((thing,) => !!thing).join(' ',)
}

/**
 * Mounts React content into a new shadow DOM host appended to `target`.
 *
 * Options:
 * - `key` - stable string used as `data-toolbox-mount` on the host. If a host with
 *   the same key already exists inside `target`, the old one is removed first
 *   (idempotent re-mount). Omit when the caller guarantees at-most-once.
 * - `shadow` - `true` (default) for shadow DOM, `false` for light DOM.
 * - `lifecycle` - if provided, the unmount cleanup is registered with it.
 *
 * Returns a `cleanup` function that unmounts the React root and removes the host.
 */
export function mountToTarget (
	content: ReactNode,
	target: Element,
	options: {key?: string; name?: string; shadow?: boolean; lifecycle?: Lifecycle; hostTag?: string} = {},
): () => void {
	const {key, name, shadow = true, lifecycle, hostTag = 'div',} = options
	const wrapped = <ErrorBoundary name={name ?? key}>{content}</ErrorBoundary>

	if (key) {
		target.querySelectorAll(`[data-toolbox-mount="${CSS.escape(key,)}"]`,).forEach((element,) => element.remove())
	}

	const host = document.createElement(hostTag,)
	host.classList.add('toolbox-react-shadow-host',)
	if (key) { host.dataset.toolboxMount = key }

	let cleanup: () => void
	if (shadow) {
		const shadowRoot = host.attachShadow({mode: 'open',},)
		applyStylesToShadow(shadowRoot,)
		target.appendChild(host,)
		const root = createRoot(shadowRoot,)
		root.render(wrapped,)
		cleanup = () => {
			root.unmount()
			host.remove()
		}
	} else {
		host.classList.remove('toolbox-react-shadow-host',)
		host.classList.add('toolbox-react-light-host',)
		target.appendChild(host,)
		const root = createRoot(host,)
		root.render(wrapped,)
		cleanup = () => {
			root.unmount()
			host.remove()
		}
	}

	if (lifecycle) {
		lifecycle.mount(cleanup,)
	}

	return cleanup
}
