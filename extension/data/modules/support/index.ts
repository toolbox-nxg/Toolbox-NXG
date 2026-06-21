/** Entry point for the Support module; adds debug-info helpers to the toolbox_nxg subreddit submission flow. */

import './support.css'

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {debugInformation,} from '../../util/infra/debug'
import {buildSubmissionAddition, createSupportHandlers,} from './dom'
import {settings, type SupportSettings,} from './settings'

export default new Module<SupportSettings>({
	name: 'Support Module',
	id: 'Support',
	docSlug: 'support',
	alwaysEnabled: true,
	settings,
}, async () => {
	const lifecycle = createLifecycle()

	const debugInfo = await debugInformation()
	const submissionAddition = buildSubmissionAddition(debugInfo,)
	const handlers = createSupportHandlers(submissionAddition,)

	if (location.pathname.match(/\/r\/toolbox_nxg\/submit\/?/,)) {
		lifecycle.mount(handlers.insertSubmitDebugButton(),)
		lifecycle.delegate(document.body, 'click', 'div.toolbox-insert-debug', handlers.handleSubmitInsert,)
	}

	if (location.pathname.match(/\/r\/toolbox_nxg\/comments\/?/,)) {
		lifecycle.mount(handlers.insertDebugButton(),)
		lifecycle.delegate(document.body, 'click', 'div.toolbox-insert-debug', handlers.handleInsertDebug,)
	}

	return lifecycle.cleanup
},)
