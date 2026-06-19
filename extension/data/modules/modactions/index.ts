/**
 * Entry point for the Mod Actions module: inline moderator-action buttons on each Shreddit
 * post/comment (Remove as Spam, Lock, Distinguish, Sticky, Mark NSFW, Recent actions). Only runs on
 * the Shreddit UI; the module registry skips it on old Reddit, which keeps its own mod buttons.
 */

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {modActions,} from '../../framework/moduleIds'
import {createModActionsSlot,} from './dom'

export default new Module({
	name: 'Mod Actions',
	id: modActions,
	enabledByDefault: true,
	shreddit: true,
}, () => {
	const lifecycle = createLifecycle()
	lifecycle.mount(createModActionsSlot(),)
	return lifecycle.cleanup
},)
