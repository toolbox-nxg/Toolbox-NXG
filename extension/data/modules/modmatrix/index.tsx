/** Registers the Mod Log Matrix module and injects the matrix button into the mod-log page for both old Reddit and Shreddit. */

import {renderAtLocation,} from '../../dom/uiLocations'
import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {modMatrix,} from '../../framework/moduleIds'
import createLogger from '../../util/infra/logging'
import {isOldReddit,} from '../../util/infra/platform'
import {isModLogPage, isShredditModLogPage,} from '../../util/reddit/pageContext'
import {createMatrixButtonRender, createModMatrixHandlers, createModMatrixSetup,} from './dom'
import {type ModMatrixSettings, settings,} from './settings'

const log = createLogger(modMatrix,)

export default new Module<ModMatrixSettings>({
	name: 'Mod Log Matrix',
	id: modMatrix,
	docSlug: 'modmatrix',
	enabledByDefault: true,
	settings,
}, function init () {
	if (isOldReddit && isModLogPage) {
		log.debug('Running Mod Matrix Module (old Reddit)',)
	} else if (!isOldReddit && isShredditModLogPage) {
		log.debug('Running Mod Matrix Module (shreddit)',)
	} else {
		return
	}

	const lifecycle = createLifecycle()

	const setup = createModMatrixSetup()
	lifecycle.mount(setup.cleanup,)

	const handlers = createModMatrixHandlers(setup.subredditUrl, setup.subredditName,)

	renderAtLocation(
		'modLogControls',
		{id: 'modmatrix.toggle', lifecycle,},
		createMatrixButtonRender(handlers.handleButtonClick,),
	)

	return lifecycle.cleanup
},)
