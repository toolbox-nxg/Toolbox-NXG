/** Entry point for the Shreddit module; activates only on the new Reddit UI and wires up DOM mutation handling. */

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {onSharedMutation,} from '../../util/ui/dom'
import {createShredditHandlers,} from './dom'
import {settings, type ShredditSettings,} from './settings'

const self = new Module<ShredditSettings>({
	name: 'Shreddit',
	id: 'Shreddit',
	docSlug: 'shreddit',
	enabledByDefault: true,
	shreddit: true,
	settings,
}, (s,) => {
	const lifecycle = createLifecycle()
	const handlers = createShredditHandlers(s,)

	lifecycle.on(document, 'TBListenerLoaded', handlers.handleListenerLoaded, {once: true,},)
	lifecycle.mount(onSharedMutation(handlers.handleMutations,),)

	return lifecycle.cleanup
},)
export default self
