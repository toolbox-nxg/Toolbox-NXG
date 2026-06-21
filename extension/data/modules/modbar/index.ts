/** Entry point for the Modbar module - mounts the persistent bottom toolbar and exports the modbarExists promise. */

import './modbar.css'

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {modbar,} from '../../framework/moduleIds'
import {setSettingAsync,} from '../../util/persistence/settings'
import {createModbarHandlers,} from './dom'
import {createSettingsNavigationHandlers,} from './features/settingsNavigation'
import {ModbarSettings, settings,} from './settings'

let resolveModbarExists: ((value: void | PromiseLike<void>,) => void) | null = null

/** Resolves once the ModBar component has mounted for the first time. */
export const modbarExists = new Promise<void>((resolve,) => {
	resolveModbarExists = resolve
},)

const self = new Module<ModbarSettings>({
	name: 'Modbar',
	id: modbar,
	docSlug: 'modbar',
	alwaysEnabled: true,
	settings,
}, async (s: ModbarSettings,) => {
	const lifecycle = createLifecycle()

	setSettingAsync(modbar, 'consoleShowing', undefined,)

	const handlers = await createModbarHandlers(
		s,
		(key, value,) => self.set(key, value,),
		() => resolveModbarExists!(),
	)

	lifecycle.mount(handlers.dispose,)

	const settingsNav = createSettingsNavigationHandlers()
	lifecycle.mount(settingsNav.cleanup,)
	lifecycle.on(window, 'TBHashParams', settingsNav.handleHashParams,)

	return lifecycle.cleanup
},)

export default self
