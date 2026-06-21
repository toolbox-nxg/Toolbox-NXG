/** Entry point for the History Button module, which adds per-user submission and comment history popups. */
import {modSubCheck,} from '../../api/resources/modSubs'
import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import createLogger from '../../util/infra/logging'
import {createHistoryButtonHandlers,} from './dom'
import {type HistoryButtonSettings, settings,} from './settings'

const log = createLogger('HistoryButton',)

export default new Module<HistoryButtonSettings>({
	name: 'History Button',
	id: 'HistoryButton',
	docSlug: 'historybutton',
	enabledByDefault: true,
	settings,
}, async () => {
	log.debug('init',)
	if (!await modSubCheck()) {
		log.debug('mscheck failed',)
		return
	}

	log.debug('mscheck passed',)

	const lifecycle = createLifecycle()
	lifecycle.mount(createHistoryButtonHandlers(),)

	return lifecycle.cleanup
},)
