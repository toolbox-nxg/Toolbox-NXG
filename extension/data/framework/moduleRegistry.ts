/** Global module registry that registers, initializes, and cleans up all Toolbox feature modules. */

import {createElement,} from 'react'
import {Provider,} from 'react-redux'

import {SettingsDialog,} from '../modules/shared/settings/SettingsDialog'
import store from '../store/index'
import createLogger from '../util/infra/logging'
import {isOldReddit, isShreddit,} from '../util/infra/platform'
import {getSettingFrom, getSettings,} from '../util/persistence/settings'
import {exportSettings, importSettings,} from '../util/persistence/settingsPortability'
import {reactRenderer,} from '../util/ui/reactMount'
import {throwIfErrors,} from './lifecycle'
import {Module,} from './module'
import {utils,} from './moduleIds'

const log = createLogger('TBModule',)

export {exportSettings, importSettings,}

const TBModule = {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry holds modules of every settings shape; Module<any> is the correct erasure here
	modules: [] as Module<any>[],

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts a module of any settings shape for registration
	registerModule (mod: Module<any>,) {
		TBModule.modules.push(mod,)
	},

	init: async function tbInit () {
		log.debug('loading modules',)
		// Read the whole settings blob once for the entire init pass and thread it
		// through every enabled-check and module initializer, so startup does a
		// single storage round-trip instead of one per module per setting.
		const settings = await getSettings()
		const debugMode = !!getSettingFrom(settings, utils, 'debugMode', false,)
		// Check if each module should be enabled, then call its initializer
		await Promise.all(TBModule.modules.map(async (module,) => {
			// Don't do anything with modules the user has disabled
			if (!await module.getEnabled(settings,)) {
				return
			}

			// Don't do anything with dev modules unless debug mode is enabled
			if (!debugMode && module.debugMode) {
				// skip this module entirely
				log.debug(`Debug mode not enabled. Skipping ${module.name} module`,)
				return
			}

			// Skip old-reddit-only modules when running on shreddit
			if (!isOldReddit && module.oldReddit) {
				log.debug(`Module not suitable for shreddit. Skipping ${module.name} module`,)
				return
			}

			// Skip shreddit-only modules when running on old Reddit
			if (!isShreddit && module.shreddit) {
				log.debug(`Module only suitable for shreddit. Skipping ${module.name} module`,)
				return
			}

			// lock 'n load
			log.debug(`Loading ${module.id} module`,)
			await module.init(settings,)
		},),)
	},

	showSettings () {
		if (document.querySelector('.toolbox-settings-dialog-host',)) { return }
		const host = reactRenderer(
			// eslint-disable-next-line react/no-children-prop -- manual createElement call; children-in-props is the idiomatic non-JSX form
			createElement(Provider, {
				store,
				children: createElement(SettingsDialog, {
					modules: TBModule.modules,
					onClose: () => {
						host.remove()
						if (!document.body.querySelectorAll('.toolbox-page-overlay',).length) {
							document.body.style.overflow = 'auto'
						}
					},
					onExport: exportSettings,
					onImport: importSettings,
				},),
			},),
		)
		host.classList.add('toolbox-settings-dialog-host',)
		document.body.appendChild(host,)
		document.body.style.overflow = 'hidden'
	},

	async cleanup () {
		const errors: unknown[] = []
		for (const module of [...TBModule.modules,].reverse()) {
			if (!module.cleanup) {
				continue
			}
			try {
				await module.cleanup()
				delete module.cleanup
			} catch (error) {
				errors.push(error,)
				log.error(`Failed to clean up ${module.id} module`, error,)
			}
		}
		throwIfErrors(errors, 'Module cleanup failed',)
	},
}
export default TBModule
