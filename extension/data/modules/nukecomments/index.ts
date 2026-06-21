/** Registers the Comment Nuke module, which adds a button to bulk-remove or bulk-lock comment chains. */

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {nukeComments,} from '../../framework/moduleIds'
import {createNukeCommentsHandlers,} from './dom'
import {NukeCommentsSettings, settings,} from './settings'
import './nukecomments.css'

export default new Module<NukeCommentsSettings>({
	name: 'Comment Nuke',
	id: nukeComments,
	docSlug: 'nukecomments',
	enabledByDefault: false,
	settings,
}, (s,) => {
	const lifecycle = createLifecycle()
	lifecycle.mount(createNukeCommentsHandlers(s,),)
	return lifecycle.cleanup
},)
