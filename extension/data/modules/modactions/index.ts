/**
 * Entry point for the Mod Actions module: inline moderator-action buttons on each Shreddit
 * post/comment (Remove as Spam, Lock, Distinguish, Sticky, Mark NSFW). Only runs on the Shreddit UI;
 * the module registry skips it on old Reddit, which keeps its own mod buttons. The per-item
 * recent-actions history is provided separately by the Queue Tools module on both platforms.
 */

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {modActions,} from '../../framework/moduleIds'
import {createModActionsSlot,} from './dom'

export default new Module({
	name: 'Mod Actions',
	id: modActions,
	docSlug: 'mod-actions',
	enabledByDefault: true,
	shreddit: true,
}, () => {
	const lifecycle = createLifecycle()
	lifecycle.mount(createModActionsSlot(),)
	return lifecycle.cleanup
},)
