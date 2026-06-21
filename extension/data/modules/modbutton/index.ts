/** Entry point for the Mod Button module - registers mod action buttons next to usernames across the Reddit UI. */

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {modButton,} from '../../framework/moduleIds'
import {createModButtonHandlers,} from './dom'
import {ModButtonSettings, settings,} from './settings'

const self = new Module<ModButtonSettings>({
	name: 'Mod Button',
	id: modButton,
	docSlug: 'modbutton',
	enabledByDefault: true,
	settings,
}, function init (s: ModButtonSettings,) {
	const lifecycle = createLifecycle()
	lifecycle.mount(createModButtonHandlers(
		s,
		(action,) => self.set('lastAction', action,),
		(subs,) => self.set('savedSubs', subs,),
	),)
	return lifecycle.cleanup
},)

export default self
