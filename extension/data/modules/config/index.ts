/** Module entry point for the Config module, which provides the per-subreddit Toolbox configuration overlay. */
import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {usernotes,} from '../../framework/moduleIds'
import {getSettingAsync,} from '../../util/persistence/settings'
import {createConfigOpenHandlers,} from './dom'
import {type ConfigSettings, settings,} from './settings'

export default new Module<ConfigSettings>({
	name: 'Toolbox-NXG Config',
	id: 'Config',
	enabledByDefault: true,
	settings,
}, async () => {
	const lifecycle = createLifecycle()
	const unManager = await getSettingAsync(usernotes, 'unManagerLink', true,)

	const openHandlers = createConfigOpenHandlers(unManager,)
	lifecycle.on(window, 'TBNewPage', openHandlers.handleNewPage,)
	lifecycle.delegate(document.body, 'click', '#toolbox-config-link', openHandlers.handleConfigLinkClick,)
	lifecycle.on(document, 'tb:mysubs-open-config', openHandlers.handleOpenConfigEvent,)
	lifecycle.delegate(document.body, 'click', '#toolbox-config-help', openHandlers.handleConfigHelpClick,)

	return lifecycle.cleanup
},)
