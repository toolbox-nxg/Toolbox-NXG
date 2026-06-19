/** Entry point for the Mod View Enhancements module, which adds visual and informational improvements to the moderator's view of submissions and reports across queue, subreddit, and comment pages. */
import './modviewenhancements.css'

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {modViewEnhancements,} from '../../framework/moduleIds'
import {isOldReddit,} from '../../util/infra/platform'
import {isShredditModQueuePage,} from '../../util/reddit/pageContext'
import {onSharedMutation,} from '../../util/ui/dom'
import {createModViewEnhancementsHandlers,} from './dom'
import {settings,} from './settings'
import type {ModViewEnhancementsSettings,} from './settings'

const self: Module<ModViewEnhancementsSettings> = new Module({
	name: 'Mod View Enhancements',
	id: modViewEnhancements,
	enabledByDefault: true,
	settings,
}, init,)

function init (options: ModViewEnhancementsSettings,) {
	if (!isOldReddit && !isShredditModQueuePage) { return }

	const lifecycle = createLifecycle()
	const mve = createModViewEnhancementsHandlers(options,)

	lifecycle.mount(mve.cleanup,)

	if (isOldReddit) {
		lifecycle.on(window, 'TBNewThings', mve.handleNewThings,)
		// Re-highlight self-post bodies that load via AJAX when an expando opens. Only attach the
		// listener when bracket highlighting is actually active for this page (queue or, with the
		// off-queue setting on, subreddit/comment pages) so expanding doesn't highlight when disabled.
		if (mve.shouldHighlightMatches) {
			lifecycle.delegate(document.body, 'click', '.expando-button', mve.handleExpando,)
		}
	} else if (isShredditModQueuePage) {
		mve.initShreddit()
		lifecycle.mount(onSharedMutation((mutations,) => mve.handleShredditMutations(mutations,)),)
	}

	return lifecycle.cleanup
}

export default self
