/** Module entry point for the Comments module, which adds comment management tools to both Reddit platforms. */
import './oldReddit/toggle-removed.css'

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {isOldReddit,} from '../../util/infra/platform'
import {isMod, isUserPage,} from '../../util/reddit/pageContext'
import {
	createContextPopupHandlers,
	createFlatViewHandlers,
	createHighlightHandlers,
	createUserPageCommentControls,
} from './dom'
import {createHideModCommentsHandlers,} from './oldReddit/hideModComments'
import {createHideOldCommentsHandlers, createHideOldCommentsSetup,} from './oldReddit/hideOldComments'
import {createSpamToggleHandlers,} from './oldReddit/spamToggle'
import {createOldRedditCommentAdapter,} from './platformInterface'
import {CommentsSettings, settings,} from './settings'

export default new Module<CommentsSettings>({
	name: 'Comments',
	id: 'Comments',
	docSlug: 'comments',
	enabledByDefault: true,
	settings,
}, ({
	openContextInPopup,
	hideRemoved,
	approveComments,
	spamRemoved,
	hamSpammed,
	showHideOld,
	highlighted,
},) => {
	const lifecycle = createLifecycle()

	if (isOldReddit) {
		const adapter = createOldRedditCommentAdapter()
		const spamToggle = createSpamToggleHandlers(
			{hideRemoved, approveComments, spamRemoved, hamSpammed,},
			adapter,
		)
		if (isMod) {
			lifecycle.delegate(document.body, 'click', '#toolbox-toggle-removed', spamToggle.handleToggleRemoved,)
			lifecycle.delegate(document.body, 'click', '.expando-button.selftext', spamToggle.handleExpandoClick,)
			lifecycle.on(window, 'TBNewThings', () => void spamToggle.run(),)
			lifecycle.mount(spamToggle.cleanup,)
			void spamToggle.run()
		}

		if (isUserPage) {
			const cleanup = createUserPageCommentControls()
			if (cleanup) { lifecycle.mount(cleanup,) }
		}
		lifecycle.mount(createHideModCommentsHandlers(adapter,).cleanup,)

		if (showHideOld) {
			const locationCleanup = createHideOldCommentsSetup()
			if (locationCleanup) { lifecycle.mount(locationCleanup,) }

			const hideOldComments = createHideOldCommentsHandlers(adapter,)
			lifecycle.mount(hideOldComments.cleanup,)
			lifecycle.delegate(document.body, 'click', '.toolbox-hide-old', hideOldComments.handleHideOldClick,)
			lifecycle.delegate(document.body, 'click', adapter.oldExpandSelector, hideOldComments.handleOldExpandClick,)
		}
	}

	if (highlighted.length) {
		const highlightHandlers = createHighlightHandlers(highlighted,)
		lifecycle.mount(highlightHandlers.cleanup,)
		lifecycle.delegate(
			document.body,
			'click',
			'.expando-button',
			(target,) => void highlightHandlers.handleExpando(target,),
		)
		lifecycle.on(window, 'TBNewPage', (event,) => void highlightHandlers.handleNewPage(event,),)
	}

	const flatView = createFlatViewHandlers(openContextInPopup,)
	lifecycle.on(window, 'TBNewPage', flatView.handleNewPage,)
	lifecycle.delegate(document.body, 'click', '#toolbox-flatview-link', flatView.handleFlatViewClick,)

	if (openContextInPopup) {
		const contextPopup = createContextPopupHandlers()
		lifecycle.mount(contextPopup.cleanup,)
	}

	return lifecycle.cleanup
},)
