/**
 * Entry point for the Comment Actions module: recreates the everyday Shreddit comment controls
 * (upvote/downvote + score, reply) inside the Toolbox flat-list row and collapses the native
 * `<shreddit-comment-action-row>` by default (a single row per comment -> no scroll jump). An Expand
 * (⋯) toggle reveals the native row inline for the controls we don't recreate (save, award, share,
 * report, insights). Shreddit-only; the native row provides these on old Reddit.
 */

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {commentActions,} from '../../framework/moduleIds'
import {createCommentActionsSlot,} from './dom'

export default new Module({
	name: 'Comment Actions',
	id: commentActions,
	docSlug: 'comment-actions',
	enabledByDefault: true,
	shreddit: true,
}, () => {
	const lifecycle = createLifecycle()
	lifecycle.mount(createCommentActionsSlot(),)
	return lifecycle.cleanup
},)
