/** Handles deep-linking into the settings panel via URL hash parameters (`#tbsettings=...`). */

import {createLifecycle,} from '../../../framework/lifecycle'
import TBModule from '../../../framework/moduleRegistry'

/**
 * Creates a handler for `TBHashParams` that opens the settings dialog on a specific module tab,
 * highlighting one setting, when the URL contains `#?tbsettings=<module>&setting=<id>`.
 * Wire the returned `handleHashParams` via `lifecycle.on(window, 'TBHashParams', ...)` in `index.ts`.
 * @returns The hash-params handler plus a `cleanup` to pass to `lifecycle.mount` in `index.ts`.
 */
export function createSettingsNavigationHandlers () {
	const lifecycle = createLifecycle()
	return {
		cleanup: lifecycle.cleanup,
		handleHashParams (event: Event,) {
			const detail = (event as CustomEvent<{tbsettings?: string; setting?: string} | null>).detail
			const module = detail?.tbsettings
			if (!module) { return }
			const setting = detail?.setting

			// One-shot navigation: open settings after a short delay to allow the hash to be consumed.
			// Routed through lifecycle.timeout so it is cancelled if the module is disabled before it fires.
			lifecycle.timeout(() => {
				void (async () => {
					history.pushState('', document.title, window.location.pathname,)
					await TBModule.showSettings({module, ...(setting && {setting,}),},)
				})()
			}, 500,)
		},
	}
}
