/** DOM integration layer for the Mod Macros module - injects macro selectors into old Reddit and Shreddit reply areas. */

import {createElement,} from 'react'

import {postComment,} from '../../api/resources/comments'
import {flairUser,} from '../../api/resources/flair'
import {getModSubs, isModSub,} from '../../api/resources/modSubs'
import {banUser, muteUser, unbanUser,} from '../../api/resources/relationships'
import {
	approveThing,
	distinguishThing,
	lock,
	removeThing,
	sendOfficialRemovalMessage,
} from '../../api/resources/things'
import {getSiteTable,} from '../../dom/oldReddit/page'
import {getThingFullname, getThings,} from '../../dom/oldReddit/things'
import {findInlineReplyComposerTargets, findTopLevelComposerHosts,} from '../../dom/shreddit/commentThread'
import {provideLocation, renderAtLocation,} from '../../dom/uiLocations'
import {negativeTextFeedback, positiveTextFeedback,} from '../../store/feedback'
import {replaceTokens,} from '../../util/data/string'
import {runInReplay,} from '../../util/infra/captureGuard'
import createLogger from '../../util/infra/logging'
import {RedditPlatform,} from '../../util/infra/platform'
import {pageDetails, postSite, TBPageContext,} from '../../util/reddit/pageContext'
import {getApiThingInfo, getThingInfo,} from '../../util/reddit/thingInfo'
import {html,} from '../../util/ui/dom'
import {requestCounterRefresh,} from '../notifier/store'
import {isTrainingCaptureActive,} from '../shared/proposals/gateway'
import {showMacroEditPopup,} from './components/MacroEditPopup'
import {MacroSelect,} from './components/MacroSelect'
import {MacroConfig, ThingInfo,} from './schema'
import {MacrosSettings,} from './settings'

const log = createLogger('ModMacros',)

/** Event-handler bundle returned by {@link createMacrosHandlers}. */
export interface MacrosHandlers {
	/** Removes all injected macro select elements from the page. */
	cleanup: () => void
	/** Injects a macro button into the top-level reply box on old Reddit post pages. */
	initOldRedditTop: () => Promise<void>
	/**
	 * Injects a macro button into a reply box when a "reply" link is clicked on old Reddit.
	 * @param element The clicked anchor element.
	 */
	handleReplyClick: (element: Element,) => Promise<void>
	/**
	 * Handles Toolbox SPA navigation events, adding or removing macro buttons as appropriate.
	 * @param event The TBNewPage custom event carrying page context.
	 */
	handleNewPage: (event: CustomEvent<TBPageContext>,) => Promise<void>
	/** MutationObserver callback that injects macro buttons into new Shreddit reply forms. */
	handleShredditMutations: MutationCallback
}

/**
 * Opens the macro edit/preview popup for a selected macro and, on submit, posts the
 * reply and performs the macro's configured mod/user actions. Exported for testing
 * the training-mode refusal of mod-action macros. Not part of the module's public API.
 * @param dropdown The macro-select dropdown element the popup anchors to.
 * @param info Resolved info (fullname/subreddit/author/permalink) for the target thing.
 * @param macro The selected macro configuration.
 * @param topLevel Whether the reply is a top-level (post) reply.
 * @param showMacroPreview Whether to show a live markdown preview.
 * @param resetSelect Resets the macro-select control after the popup closes.
 */
export async function editMacro (
	dropdown: Element,
	info: ThingInfo,
	macro: MacroConfig,
	topLevel: boolean,
	showMacroPreview: boolean,
	resetSelect: () => void,
) {
	const {
		remove,
		approve,
		spam,
		ban,
		unban,
		mute,
		userflair,
		userflairtext,
		lockthread: lockitem,
		lockreply,
		sticky,
		replyassubreddit,
	} = macro
	// Comments can only be stickied by being distinguished, so
	// always distinguish if sticky is also set. If distinguish is
	// not present, distinguish it to support legacy behavior.
	const distinguish = macro.sticky || macro.distinguish === undefined ? true : macro.distinguish
	const kind = info.kind

	let usertext = dropdown.closest('.usertext-edit',) as HTMLElement | null
	let comment = macro.text
	let actionList = 'The following actions will be performed:<br>- Your reply will be saved'

	if (!usertext) {
		usertext = dropdown.closest('.Comment',) as HTMLElement | null
	}
	if (!usertext) {
		usertext = dropdown.closest('div',) as HTMLElement | null
	}

	if (remove) { actionList += `<br>- This ${kind} will be removed` }
	if (spam) { actionList += `<br>- This ${kind} will be removed and marked as spam` }
	if (approve) { actionList += `<br>- This ${kind} will be approved` }
	if (distinguish) { actionList += '<br>- This reply will be distinguished' }
	if (replyassubreddit) { actionList += '<br>- Reply will be posted as the subreddit ModTeam' }
	if (lockitem) { actionList += `<br>- This ${kind} will be locked` }
	if (lockreply) { actionList += '<br>- This reply will be locked' }
	if (sticky && topLevel) { actionList += '<br>- This reply will be stickied' }
	if (ban) { actionList += '<br>- This user will be banned' }
	if (unban) { actionList += '<br>- This user will be unbanned' }
	if (userflair) { actionList += `<br>- This user will be flaired with [ ${userflairtext} ]` }
	if (mute) { actionList += '<br>- This user will be muted' }

	comment = replaceTokens(info as Record<string, string>, comment,)

	const rect = usertext?.getBoundingClientRect()
	const offsetLeft = (rect?.left ?? 0) + window.scrollX
	const offsetTop = (rect?.top ?? 0) + window.scrollY
	const editMinWidth = usertext?.offsetWidth ?? 0
	const editMinHeight = (usertext?.offsetHeight ?? 0) - 74

	log.debug(macro.title,)

	const onPost = async (editedComment: string,): Promise<boolean> => {
		log.debug('Replying with:',)
		log.debug(`  ${editedComment}`,)

		// Training mode: a sandboxed trainee must not perform real moderation. A macro
		// bundles the trainee's own reply (their own voice - fine) with mod actions
		// against the target item or its author, and a reply AS THE SUBREDDIT speaks
		// officially. The macro path doesn't route through the proposals gateway, so it
		// can't compose a reviewable proposal; refuse those up front for a clear message
		// rather than a partially-applied macro (the per-action capture guard, which can
		// only block, is a backstop - not the place to explain this to the user).
		// Reply-only side effects (distinguish/lock/sticky on the trainee's own reply)
		// stay allowed.
		const performsModAction = !!(remove || spam || approve || lockitem || ban || unban || mute || userflair)
		if ((replyassubreddit || performsModAction) && await isTrainingCaptureActive(info.subreddit,)) {
			negativeTextFeedback(
				replyassubreddit
					? 'Macros that reply as the subreddit aren\'t available in training mode'
					: 'Macros with moderation actions aren\'t available in training mode',
			)
			return false
		}

		try {
			if (replyassubreddit) {
				await sendOfficialRemovalMessage({
					fullname: info.fullname,
					message: editedComment,
					lockComment: !!lockreply,
				},)
				positiveTextFeedback('Reply posted as subreddit',)
			} else {
				const comment = await postComment(info.fullname, editedComment,)
				positiveTextFeedback('Reply posted',)

				if (!topLevel) {
					dropdown.closest('.usertext-buttons',)?.querySelector<HTMLElement>('.cancel',)?.click()
				}

				const commentId = comment.fullname ?? comment.id

				// Locking/distinguishing the trainee's OWN just-posted reply stays allowed in
				// training mode (the reply itself posted for real, and these only style/close
				// that reply). But lock()/distinguishThing() are guarded primitives that would
				// fail closed on the sandboxed subreddit, so run them through the guard's
				// authorized window (the same bypass the gateway uses when replaying an
				// accepted proposal) - otherwise the documented "stays allowed" never lands.
				if (lockreply) {
					runInReplay(() => lock(commentId,)).catch(() => {
						negativeTextFeedback('Failed to lock reply',)
					},)
				}
				if (distinguish) {
					runInReplay(() => distinguishThing(commentId, !!sticky && topLevel,)).catch(() => {
						negativeTextFeedback('Failed to distinguish reply',)
					},)
				}
			}
		} catch {
			negativeTextFeedback('Failed to post reply',)
			return false
		}

		if (remove) {
			removeThing(info.fullname,).catch(() => {
				negativeTextFeedback(`Failed to remove ${kind}`,)
			},)
		}
		if (spam) {
			removeThing(info.fullname, true,).catch(() => {
				negativeTextFeedback(`Failed to remove ${kind} as spam`,)
			},)
		}
		if (approve) {
			approveThing(info.fullname,).catch(() => {
				negativeTextFeedback(`Failed to approve ${kind}`,)
			},)
		}
		if (lockitem) {
			lock(info.fullname,).catch(() => {
				negativeTextFeedback(`Failed to lock ${kind}`,)
			},)
		}

		if (remove || spam || approve) {
			requestCounterRefresh()
		}

		log.debug('Performing user actions',)

		if (ban) {
			banUser({
				user: info.author,
				subreddit: info.subreddit,
				banDuration: 0,
				note: `Banned from: ${info.permalink}`,
				banMessage: `For the following ${kind}: ${info.permalink}`,
				banContext: info.fullname,
			},).catch(() => {
				negativeTextFeedback('Failed to ban user',)
			},)
		}
		if (unban) {
			unbanUser(info.subreddit, info.author,).catch(() => {
				negativeTextFeedback('Failed to unban user',)
			},)
		}
		if (mute) {
			log.debug(`  Muting "${info.author}" from /r/${info.subreddit} @ ${info.permalink}`,)
			muteUser({
				user: info.author,
				subreddit: info.subreddit,
				note: `Muted from: ${info.permalink}`,
			},).catch(() => {
				negativeTextFeedback('Failed to mute user',)
			},)
		}
		if (userflair) {
			flairUser({user: info.author, subreddit: info.subreddit, templateID: userflair,},).catch(() => {
				negativeTextFeedback(`error, failed to flair user (${userflair})`,)
			},)
		}

		return true
	}

	showMacroEditPopup({
		title: macro.title ?? '',
		initialComment: comment,
		actionListHtml: actionList,
		showMacroPreview,
		editMinWidth,
		editMinHeight,
		initialPosition: {top: offsetTop, left: offsetLeft,},
		onPost,
		onClose: resetSelect,
	},)
}

/**
 * Creates the DOM handlers for the Mod Macros module.
 * @param showMacroPreview Whether to show a live markdown preview in the edit popup.
 * @returns A bundle of event handlers that wire macro selectors into reply areas.
 */
export function createMacrosHandlers ({showMacroPreview,}: MacrosSettings,): MacrosHandlers {
	function createSelectCallback (thingFullname: string, subreddit: string, topLevel: boolean,) {
		return async (macro: MacroConfig, dropdown: Element, reset: () => void,) => {
			const thingInfo = await getApiThingInfo(subreddit, thingFullname, false,) as ThingInfo
			await editMacro(dropdown, thingInfo, macro, topLevel, showMacroPreview, reset,)
		}
	}

	// Counter for unique renderAtLocation IDs (one per injected MacroSelect).
	let macroSelectIdCounter = 0
	// Tracks cleanup (unrender + unprovide + DOM removal) per injected host element.
	const injectCleanups = new Map<Element, () => void>()
	// Set when the factory's cleanup runs. Async isModSub() checks in
	// handleShredditMutations consult this so a check that resolves after
	// teardown doesn't inject a host nobody will ever clean up.
	let disposed = false

	/**
	 * Provides the commentComposerControls slot on `host` and registers a MacroSelect renderer.
	 * `host` must already be inserted into the DOM by the caller.
	 */
	function injectMacroSelect (
		host: Element,
		platform: RedditPlatform,
		subreddit: string,
		thingFullname: string,
		type: 'post' | 'comment',
		topLevel: boolean,
	) {
		const id = `macros.select.${++macroSelectIdCounter}`

		const unprovide = provideLocation('commentComposerControls', host, {
			platform,
			kind: 'commentComposer',
			subreddit,
			thingId: thingFullname,
			rawDetail: {type, topLevel,},
		}, {shadow: false, hostTag: 'span',},)

		const unrender = renderAtLocation('commentComposerControls', {id,}, ({context,},) => {
			const detail = context.rawDetail as {type: 'post' | 'comment'; topLevel: boolean} | undefined
			// rawDetail is absent in slots not created by this module (e.g. modSave's
			// commentComposerControls slot), so bail out instead of throwing.
			if (!detail?.type) { return null }
			return createElement(MacroSelect, {
				subreddit: context.subreddit ?? '',
				type: detail.type,
				presentation: 'button',
				onSelectMacro: createSelectCallback(context.thingId ?? '', context.subreddit ?? '', detail.topLevel,),
			},)
		},)

		const cleanup = () => {
			unrender()
			unprovide()
			host.remove()
			injectCleanups.delete(host,)
		}
		injectCleanups.set(host, cleanup,)
	}

	/** Calls cleanup for all injected macro-select hosts matching `selector` within `scope`. */
	function removeExistingMacros (scope: Element | Document, selector: string,) {
		for (const el of scope.querySelectorAll(selector,)) {
			injectCleanups.get(el,)?.()
		}
	}

	return {
		cleanup () {
			disposed = true
			for (const cleanup of injectCleanups.values()) {
				cleanup()
			}
			injectCleanups.clear()
		},

		async initOldRedditTop () {
			const mySubs = await getModSubs(false,)
			if (!postSite || !mySubs.includes(postSite,)) { return }

			log.debug('getting config',)
			const siteTable = getSiteTable()
			const firstThing = siteTable ? getThings(siteTable,)[0] : null
			const thingFullname = firstThing ? getThingFullname(firstThing,) : null
			if (!thingFullname) { return }

			const host = document.createElement('span',)
			host.classList.add('toolbox-top-macro-select',)

			const usertextButtons = document.querySelector('.commentarea > .usertext .usertext-buttons',)
			const tbUsertextButtons = usertextButtons?.querySelector('.toolbox-usertext-buttons',)
			if (tbUsertextButtons) {
				tbUsertextButtons.appendChild(host,)
			} else {
				const btnContainer = html('<div class="toolbox-usertext-buttons"></div>',)
				btnContainer.appendChild(host,)
				usertextButtons?.querySelector('.status',)?.before(btnContainer,)
			}

			injectMacroSelect(host, RedditPlatform.Old, postSite, thingFullname, 'post', true,)
		},

		async handleReplyClick (element: Element,) {
			if (element.textContent !== 'reply') { return }

			const thing = element.closest('.thing',) as HTMLElement | null
			const info = await getThingInfo(thing, true,)

			// Reddit clones the top-level reply box for all reply boxes;
			// clean up existing macro selectors before adding the new one.
			if (thing) {
				removeExistingMacros(thing, '.toolbox-top-macro-select, .toolbox-macro-select',)
			}

			if (!info || !info.subreddit) { return }
			log.debug(info.subreddit,)

			const thingFullname = thing ? getThingFullname(thing,) : null
			if (!thingFullname) { return }

			const host = document.createElement('span',)
			host.classList.add('toolbox-macro-select',)

			const tbUsertextButtons = thing?.querySelector(
				':scope > .child > .usertext .usertext-buttons .toolbox-usertext-buttons',
			)
			if (tbUsertextButtons) {
				tbUsertextButtons.appendChild(host,)
			} else {
				const btnContainer = html('<div class="toolbox-usertext-buttons"></div>',)
				btnContainer.appendChild(host,)
				thing?.querySelector(':scope > .child > .usertext .usertext-buttons .status',)?.before(btnContainer,)
			}

			injectMacroSelect(host, RedditPlatform.Old, info.subreddit, thingFullname, 'comment', false,)
		},

		async handleNewPage (event: CustomEvent<TBPageContext>,) {
			if (event.detail.pageType !== 'subredditCommentsPage') {
				removeExistingMacros(document, '.toolbox-macro-select',)
				return
			}

			const subreddit = event.detail.pageDetails.subreddit
			const submissionID = event.detail.pageDetails.submissionID
			if (!subreddit || !submissionID) {
				removeExistingMacros(document, '.toolbox-macro-select',)
				return
			}

			const isMod = await isModSub(subreddit,)
			if (!isMod) {
				removeExistingMacros(document, '.toolbox-macro-select',)
				return
			}

			const host = document.createElement('span',)
			host.classList.add('toolbox-top-macro-select',)

			// Old Reddit: find "Comment as" span label
			const commentAsLabel = Array.from(document.querySelectorAll('span',),)
				.find((span,) => span.textContent === 'Comment as')
			if (commentAsLabel) {
				commentAsLabel.closest('div',)?.after(host,)
				injectMacroSelect(host, RedditPlatform.Old, subreddit, `t3_${submissionID}`, 'post', true,)
				return
			}

			// Shreddit: anchor on comment-composer-host, insert after the wrapper div
			const composerHost = document.querySelector('comment-composer-host[post-id]',)
			if (composerHost) {
				const wrapper = document.querySelector('#sticky-comment-composer-wrapper',)
				;(wrapper ?? composerHost).after(host,)
				injectMacroSelect(host, RedditPlatform.Shreddit, subreddit, `t3_${submissionID}`, 'post', true,)
			}
		},

		handleShredditMutations (mutations: MutationRecord[],) {
			const subreddit = pageDetails.pageDetails.subreddit
			if (!subreddit) { return }

			for (const mutation of mutations) {
				for (const node of mutation.addedNodes) {
					if (!(node instanceof Element)) { continue }

					// Inline comment reply forms: "Comment as" span inside shreddit-comment
					for (const {container, thingId,} of findInlineReplyComposerTargets(node,)) {
						if (container.querySelector('.toolbox-macro-select',)) { continue }
						isModSub(subreddit,).then((isMod,) => {
							if (disposed || !isMod) { return }
							if (container.querySelector('.toolbox-macro-select',)) { return }
							const host = document.createElement('span',)
							host.classList.add('toolbox-macro-select',)
							container.after(host,)
							injectMacroSelect(host, RedditPlatform.Shreddit, subreddit, thingId, 'comment', false,)
						},).catch((error: unknown,) => log.error(error,))
					}

					// Top-level post reply form: comment-composer-host added via SPA navigation
					for (const {composerEl, postId,} of findTopLevelComposerHosts(node,)) {
						if (document.querySelector('.toolbox-top-macro-select',)) { continue }
						isModSub(subreddit,).then((isMod,) => {
							if (disposed || !isMod) { return }
							if (document.querySelector('.toolbox-top-macro-select',)) { return }
							const host = document.createElement('span',)
							host.classList.add('toolbox-top-macro-select',)
							const wrapper = document.querySelector('#sticky-comment-composer-wrapper',)
							;(wrapper ?? composerEl).after(host,)
							injectMacroSelect(host, RedditPlatform.Shreddit, subreddit, postId, 'post', true,)
						},).catch((error: unknown,) => log.error(error,))
					}
				}
			}
		},
	}
}
