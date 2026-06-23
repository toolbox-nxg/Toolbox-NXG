/** Entry point for the Usernotes module; wires up note tag rendering, the manager overlay, and related modbox links. */

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {createNotesDisplay, createNotesManager,} from './dom'
import {settings, UserNotesSettings,} from './settings'

const self = new Module<UserNotesSettings>({
	name: 'Usernotes',
	id: 'UserNotes',
	docSlug: 'usernotes',
	enabledByDefault: true,
	settings,
}, async function init (initialSettings: UserNotesSettings,) {
	const lifecycle = createLifecycle()
	const display = createNotesDisplay(initialSettings,)
	const manager = createNotesManager(initialSettings,)

	lifecycle.mount(display.cleanup,)
	lifecycle.on(window, 'TBNewThings', display.handleNewThings,)
	lifecycle.on(window, 'TBNewPage', (event,) => void manager.handleNewPage(event,),)
	lifecycle.delegate(
		document.body,
		'click',
		'#toolbox-un-config-link',
		(element,) => void manager.handleManagerClick(element,),
	)
	lifecycle.delegate(document.body, 'click', '#toolbox-manage-bans-link', manager.handleBansLinkClick,)
	lifecycle.delegate(document.body, 'click', '#toolbox-manage-mutes-link', manager.handleMutesLinkClick,)
	lifecycle.delegate(document.body, 'click', '#toolbox-manage-flair-link', manager.handleFlairLinkClick,)
	lifecycle.on(document, 'tb:mysubs-open-usernotes', manager.handleOpenManagerEvent,)

	return lifecycle.cleanup
},)

export default self
