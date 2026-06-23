/** Entry point for the Mod Macros module - registers lifecycle hooks that inject macro selectors into reply areas. */

import './macros.css'

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {macros,} from '../../framework/moduleIds'
import {isOldReddit,} from '../../util/infra/platform'
import {onSharedMutation,} from '../../util/ui/dom'
import {createMacrosHandlers,} from './dom'
import {MacrosSettings, settings,} from './settings'

export default new Module<MacrosSettings>({
	name: 'Mod Macros',
	id: macros,
	docSlug: 'macros',
	enabledByDefault: true,
	settings,
}, async (s,) => {
	const lifecycle = createLifecycle()
	const handlers = createMacrosHandlers(s,)

	if (isOldReddit) {
		await handlers.initOldRedditTop()
		lifecycle.delegate(
			document.body,
			'click',
			'ul.buttons a',
			(target,) => void handlers.handleReplyClick(target,),
		)
	} else {
		lifecycle.mount(onSharedMutation(handlers.handleShredditMutations,),)
	}

	lifecycle.on(window, 'TBNewPage', (event,) => void handlers.handleNewPage(event,),)
	lifecycle.mount(handlers.cleanup,)

	return lifecycle.cleanup
},)
