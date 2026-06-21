/** Registers the Modmail module, which enhances the Shreddit modmail UI with toolbox features. */

import './modmail.css'
import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {modmail,} from '../../framework/moduleIds'
import {createModmailHandlers,} from './dom'
import {ModmailSettings, settings,} from './settings'

const self = new Module<ModmailSettings>({
	name: 'Modmail',
	id: modmail,
	docSlug: 'modmail',
	enabledByDefault: true,
	shreddit: true,
	settings,
}, (s: ModmailSettings,) => {
	if (!document.location.pathname.startsWith('/mail',)) {
		return undefined
	}

	const lifecycle = createLifecycle()

	const handlers = createModmailHandlers(s,)
	lifecycle.mount(handlers.cleanup,)

	handlers.scan(document.body,)
	lifecycle.observe(document.body, handlers.handleMutations, {childList: true, subtree: true,},)

	return lifecycle.cleanup
},)

export default self
