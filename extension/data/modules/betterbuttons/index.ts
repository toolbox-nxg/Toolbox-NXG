/** Module entry point for Better Buttons, which enhances old-Reddit moderation button behavior. */
import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {betterButtons,} from '../../framework/moduleIds'
import {isMod,} from '../../util/reddit/pageContext'
import {createAutoApproveHandlers,} from './features/autoApprove'
import {createAutoIgnoreReportsHandlers,} from './features/autoIgnoreReports'
import {createCommentLockHandlers,} from './features/commentLock'
import {createDistinguishToggleHandlers,} from './features/distinguishToggle'
import {createModSaveHandlers,} from './features/modSave'
import {createRemoveButtonsHandlers,} from './features/removeButtons'
import {createRemoveConfirmationHandlers,} from './features/removeConfirmation'
import {createStickyButtonHandlers,} from './features/stickyButtons'
import {BetterButtonsSettings, settings,} from './settings'

export default new Module<BetterButtonsSettings>({
	name: 'Better Buttons',
	id: betterButtons,
	docSlug: 'betterbuttons',
	enabledByDefault: true,
	oldReddit: true,
	settings,
}, ({
	enableModSave,
	enableDistinguishToggle,
	removeRemoveConfirmation,
	approveOnIgnore,
	ignoreOnApprove,
	spamRemoved,
	hamSpammed,
	addStickyButton,
	addCommentLockbutton,
},) => {
	const lifecycle = createLifecycle()

	if (enableModSave) {
		const {handleModSaveClick, handleStickySaveClick, cleanup,} = createModSaveHandlers()
		lifecycle.delegate(document.body, 'click', 'button.save-mod', handleModSaveClick,)
		lifecycle.delegate(document.body, 'click', 'button.save-sticky', handleStickySaveClick,)
		lifecycle.mount(cleanup,)
	}
	if (enableDistinguishToggle) {
		const {addSticky, distinguishClicked, cleanup,} = createDistinguishToggleHandlers()
		lifecycle.mount(cleanup,)
		lifecycle.on(window, 'TBNewThings', addSticky,)
		lifecycle.delegate(document.body, 'click', 'form[action="/post/distinguish"]', distinguishClicked,)
		addSticky()
	}
	if (removeRemoveConfirmation) {
		const {handleApproveClick, handleRemoveClick,} = createRemoveConfirmationHandlers()
		lifecycle.delegate(document.body, 'click', '.flat-list .approve-button .togglebutton', handleApproveClick,)
		lifecycle.delegate(document.body, 'click', '.flat-list .remove-button .togglebutton', handleRemoveClick,)
	}
	if (approveOnIgnore) {
		const {handleIgnoreClick,} = createAutoApproveHandlers()
		lifecycle.delegate(document.body, 'click', '.big-mod-buttons > .pretty-button.neutral', handleIgnoreClick,)
	}
	if (ignoreOnApprove) {
		const {handleApproveClick,} = createAutoIgnoreReportsHandlers()
		lifecycle.delegate(
			document.body,
			'click',
			'.big-mod-buttons > span > .pretty-button.positive',
			handleApproveClick,
		)
	}
	if (spamRemoved || hamSpammed) {
		const {run, cleanup,} = createRemoveButtonsHandlers({spamRemoved, hamSpammed,},)
		lifecycle.mount(cleanup,)
		run()
	}
	// isMod is checked here rather than as a top-level module guard because only these two
	// features require mod status; the rest run for all users on old-Reddit.
	if (addStickyButton && isMod) {
		const {register,} = createStickyButtonHandlers()
		lifecycle.mount(register(),)
	}
	if (addCommentLockbutton && isMod) {
		const {commentLockRun, cleanup,} = createCommentLockHandlers()
		lifecycle.mount(cleanup,)
		lifecycle.on(window, 'TBNewThings', commentLockRun,)
		commentLockRun()
	}

	return lifecycle.cleanup
},)
