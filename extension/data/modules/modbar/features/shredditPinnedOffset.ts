/** Lifts Shreddit's shadow-DOM bottom-pinned widgets above the modbar by injecting an offset stylesheet into their shadow roots. */

import {createLifecycle,} from '../../../framework/lifecycle'
import {isOldReddit,} from '../../../util/infra/platform'
import {onSharedMutation, qsa,} from '../../../util/ui/dom'

/**
 * The inner bar inside `post-bottom-bar` is `position: fixed; bottom: 0`, so it anchors to the
 * viewport and the fixed modbar overlaps it. CSS injected into the page light DOM cannot reach it
 * (it lives in Reddit's shadow root), so we adopt this rule into that shadow root instead. The
 * `--toolbox-modbar-height` custom property inherits across the shadow boundary, so the offset is
 * the modbar height while the bar is shown and `0px` (no change) while it is hidden - no JS toggle.
 */
const offsetCss = '.fixed.bottom-0 { bottom: var(--toolbox-modbar-height, 0px); }'

/** Reddit custom-element tag names whose open shadow root holds a bottom-pinned widget to offset. */
const shadowHostTags = ['post-bottom-bar',]

/**
 * Builds a constructable stylesheet carrying {@link offsetCss}, or `null` if the environment refuses
 * to construct one (the per-host fallback appends a `<style>` element instead).
 */
function buildOffsetSheet (): CSSStyleSheet | null {
	try {
		const sheet = new CSSStyleSheet()
		sheet.replaceSync(offsetCss,)
		return sheet
	} catch {
		return null
	}
}

/**
 * Injects the offset into Shreddit's shadow-DOM bottom-pinned widgets so they clear the modbar.
 * No-op on old Reddit (these custom elements only exist on Shreddit). Creates its own lifecycle
 * scope per the module pattern; wire the returned `cleanup` via `lifecycle.mount` in `index.ts`.
 * @returns An object with a `cleanup` function that deregisters the shared-mutation observer.
 */
export function createShredditPinnedOffsetHandlers (): {cleanup: () => Promise<void>} {
	const lifecycle = createLifecycle()
	if (isOldReddit) {
		return {cleanup: lifecycle.cleanup,}
	}

	let sheet = buildOffsetSheet()
	const handled = new WeakSet<Element>()

	const applyOffsetToHost = (host: Element,) => {
		if (handled.has(host,)) { return }
		const root = host.shadowRoot
		if (!root) { return } // shadow not attached yet; a later mutation will retry
		handled.add(host,)

		if (sheet) {
			try {
				root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet,]
				return
			} catch {
				// Firefox refuses a content-script-constructed sheet on a page shadow root (Xray
				// wrapper). Disable the optimization permanently and fall back to a <style> element.
				sheet = null
			}
		}

		const style = document.createElement('style',)
		style.textContent = offsetCss
		root.appendChild(style,)
	}

	const scan = () => {
		for (const tag of shadowHostTags) {
			for (const host of qsa(tag,)) {
				applyOffsetToHost(host,)
			}
		}
	}

	// Handle hosts already present, then catch ones that appear across SPA navigation.
	scan()
	const deregister = onSharedMutation(scan,)
	lifecycle.mount(() => deregister())

	return {cleanup: lifecycle.cleanup,}
}
