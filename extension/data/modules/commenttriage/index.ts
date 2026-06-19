/** Module entry point for Comment Triage, which helps moderators prioritize problem comments. */
import './commenttriage.css'

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {commentTriage,} from '../../framework/moduleIds'
import {isCommentsPage, isMod,} from '../../util/reddit/pageContext'
import {createCommentTriageHandlers,} from './dom'
import {createOldRedditAdapter,} from './platformInterface'
import {CommentTriageSettings, settings,} from './settings'

export default new Module<CommentTriageSettings>({
	name: 'Comment Triage',
	id: commentTriage,
	oldReddit: true,
	settings,
}, (s,) => {
	if (!isMod || !isCommentsPage) {
		return
	}

	const lifecycle = createLifecycle()
	const adapter = createOldRedditAdapter()
	const handlers = createCommentTriageHandlers(s, adapter,)

	lifecycle.mount(handlers.inject(),)
	lifecycle.on(window, 'TBNewThings', handlers.handleNewThings,)

	if (s.sortOnMoreChildren) {
		const commentarea = document.querySelector('.commentarea',)
		if (commentarea) {
			lifecycle.delegate(commentarea, 'click', '.morecomments', handlers.handleMoreChildrenClick,)
		}
	}

	return lifecycle.cleanup
},)
