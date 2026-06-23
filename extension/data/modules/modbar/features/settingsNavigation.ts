/** Handles deep-linking into the settings panel via URL hash parameters (`#tbsettings=...`). */

import {createLifecycle,} from '../../../framework/lifecycle'
import TBModule from '../../../framework/moduleRegistry'

const softYellow = '#FFFC7F'

/**
 * Creates a handler for `TBHashParams` that opens and highlights a specific settings entry
 * when the URL contains `#tbsettings=<module>&setting=<id>`.
 * Wire the returned `handleHashParams` via `lifecycle.on(window, 'TBHashParams', ...)` in `index.ts`.
 * @returns The hash-params handler plus a `cleanup` to pass to `lifecycle.mount` in `index.ts`.
 */
export function createSettingsNavigationHandlers () {
	const lifecycle = createLifecycle()
	return {
		cleanup: lifecycle.cleanup,
		handleHashParams (event: Event,) {
			const detail = (event as CustomEvent<{tbsettings?: string; setting?: string} | null>).detail
			let module: string | undefined = detail?.tbsettings
			if (!module) { return }
			let setting: string | undefined = detail?.setting
			module = module.toLowerCase()

			if (setting) {
				setting = setting.toLowerCase()
				const id = `#toolbox-${module}-${setting}`
				let highlightedCSS = `${id} p {background-color: ${softYellow}; display: block !important;}`
				highlightedCSS += `${id}{background-color: ${softYellow}; display: block !important;}`
				highlightedCSS += `.toolbox-setting-link-${setting} {display: inline !important;}`
				// No shared style-injection utility exists in this codebase; this is the only
				// one-shot highlight injection so the inline createElement is intentional.
				const highlightEl = document.createElement('style',)
				highlightEl.textContent = highlightedCSS
				document.head.appendChild(highlightEl,)
			}

			// One-shot navigation: open settings after a short delay to allow the hash to be consumed.
			// Routed through lifecycle.timeout so it is cancelled if the module is disabled before it fires.
			lifecycle.timeout(() => {
				void (async () => {
					history.pushState('', document.title, window.location.pathname,)
					await TBModule.showSettings()
				})()
			}, 500,)
		},
	}
}
