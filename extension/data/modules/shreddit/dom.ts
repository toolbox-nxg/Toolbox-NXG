/**
 * DOM processing and toolbox container injection for the Shreddit (new Reddit) UI.
 *
 * This file IS the platform provider layer for the uiLocations slot system on Shreddit.
 * Each host element creation followed by a `provideLocation()` call here is the intended pattern -
 * these are not missed migrations. Other modules register renderers via `renderAtLocation()` and
 * rely on these providers being present.
 */

import {findCommentMetaTargets, findUsernameTargets,} from '../../dom/shreddit/comments'
import {findCommentSortTargets, findComposerTargets,} from '../../dom/shreddit/commentThread'
import {type CreditBarTarget, findCreditBarTargets, findHighlightCardTargets,} from '../../dom/shreddit/feed'
import {findModNotesTargets,} from '../../dom/shreddit/modNotes'
import {
	findCommentFlatListTargets,
	findPostFlatListTargets,
	flatListThingContainer,
	suppressNativeOverflowModActions,
} from '../../dom/shreddit/things'
import {findProfileCommentTargets,} from '../../dom/shreddit/userpage'
import {provideLocation,} from '../../dom/uiLocations'
import {RedditPlatform,} from '../../util/infra/platform'
import {type ShredditSettings,} from './settings'

/** Handlers returned by {@link createShredditHandlers} for wiring up the Shreddit module lifecycle. */
export interface ShredditHandlers {
	/** Called once when TBListener signals it has finished loading, triggering an initial full-page scan. */
	handleListenerLoaded: () => void
	/** MutationObserver callback that processes newly added DOM nodes. */
	handleMutations: MutationCallback
	/** Processes a single root element, injecting toolbox containers into any recognized Shreddit targets within it. */
	processNode: (node: Element,) => void
}

/**
 * Creates the Shreddit DOM handlers responsible for injecting toolbox author/thing containers.
 * @param options Shreddit handler settings (see {@link ShredditSettings}).
 */
export function createShredditHandlers (
	{feedPageUsernames, pinnedPostUsernames,}: ShredditSettings,
): ShredditHandlers {
	let listenerReady = false

	function processNode (node: Element,) {
		if (!listenerReady) {
			return
		}
		processModNotesTargets(node,)
		processCreditBarTargets(node, feedPageUsernames,)
		processUsernameTargets(node,)
		processHighlightCardTargets(node, pinnedPostUsernames,)
		processProfileCommentTargets(node,)
		processFlatListActionTargets(node,)
		processCommentMetaTargets(node,)
		processCommentThreadControlTargets(node,)
		processComposerControlTargets(node,)
	}

	return {
		handleListenerLoaded: () => {
			listenerReady = true
			processNode(document.body,)
		},
		handleMutations: (mutations,) => {
			if (!listenerReady) {
				return
			}
			for (const mutation of mutations) {
				for (const node of mutation.addedNodes) {
					if (node instanceof Element) {
						processNode(node,)
					}
				}
			}
		},
		processNode,
	}
}

function createToolboxSpan (): HTMLSpanElement {
	const span = document.createElement('span',)
	span.dataset.name = 'toolbox'
	return span
}

// Intentional: event-dispatch infrastructure; placeholder containers for other modules, not toolbox UI.
function createAuthorContainer (): HTMLSpanElement {
	const container = document.createElement('span',)
	container.className = 'toolbox-author-slot'
	container.appendChild(createToolboxSpan(),)
	return container
}

function createThingContainer (): HTMLDivElement {
	const div = document.createElement('div',)
	div.className = 'toolbox-thing-slot'
	div.appendChild(createToolboxSpan(),)
	return div
}

function dispatchAuthorEvent (container: Element, type: string, data: object,) {
	if (container.classList.contains('toolbox-frontend-container',)) {
		return
	}
	container.dispatchEvent(
		new CustomEvent('tbReddit', {
			detail: {type, data,},
		},),
	)
}

function processModNotesTargets (root: Element,) {
	for (
		const {opener, author, subreddit, thingId, postId, conversationId, thingAncestor, isRemoved,}
			of findModNotesTargets(root,)
	) {
		const container = createAuthorContainer()
		opener.after(container,)

		if (window.location.pathname.startsWith('/mail',)) {
			provideLocation('authorActions', container, {
				platform: RedditPlatform.Shreddit,
				kind: 'user',
				author,
				subreddit,
				rawDetail: {conversationId,},
			},)
			dispatchAuthorEvent(container, 'TBmodmailAuthor', {
				author,
				subreddit: {name: subreddit,},
				modmail: {conversationId,},
			},)
		} else {
			const isComment = thingId.startsWith('t1_',)
			provideLocation('authorActions', container, {
				platform: RedditPlatform.Shreddit,
				kind: 'user',
				author,
				subreddit,
				thingId,
				postId,
			},)
			if (isComment) {
				dispatchAuthorEvent(container, 'TBcommentAuthor', {
					author,
					post: {id: postId,},
					comment: {id: thingId,},
					subreddit: {name: subreddit,},
				},)
			} else {
				dispatchAuthorEvent(container, 'TBpostAuthor', {
					author,
					post: {id: thingId,},
					subreddit: {name: subreddit,},
				},)
			}

			if (thingAncestor) {
				const thingContainer = createThingContainer()
				thingAncestor.appendChild(thingContainer,)
				const thingContext = {
					platform: RedditPlatform.Shreddit,
					kind: isComment ? 'comment' as const : 'post' as const,
					author,
					subreddit,
					thingId,
					postId,
					isRemoved,
				}
				provideLocation('thingActions', thingContainer, thingContext,)
				provideLocation('thingDetails', thingContainer, thingContext,)
				thingContainer.dispatchEvent(
					new CustomEvent('tbReddit', {
						detail: isComment
							? {
								type: 'TBcomment',
								data: {author, post: {id: postId,}, id: thingId, subreddit: {name: subreddit,},},
							}
							: {
								type: 'TBpost',
								data: {author, post: {id: thingId,}, id: thingId, subreddit: {name: subreddit,},},
							},
					},),
				)
			}
		}
	}
}

function processCreditBarTargets (root: Element, showFeedAuthor: boolean,) {
	for (const target of findCreditBarTargets(root,)) {
		if (target.kind === 'feed-only' && !showFeedAuthor && !target.hasNativeAuthor) {
			continue
		}
		processSingleCreditBarTarget(target,)
	}
}

function processSingleCreditBarTarget (target: CreditBarTarget,) {
	if (target.kind === 'mod-notes') {
		const {creditBar, separator, author, subreddit, thingId, postId, postEl, isCompact, needsThingContainer,} =
			target

		const container = createAuthorContainer()
		separator.before(container,)

		const isComment = thingId.startsWith('t1_',)
		provideLocation('authorActions', container, {
			platform: RedditPlatform.Shreddit,
			kind: 'user',
			author,
			subreddit,
			thingId,
			postId,
		},)
		if (isComment) {
			dispatchAuthorEvent(container, 'TBcommentAuthor', {
				author,
				post: {id: postId,},
				comment: {id: thingId,},
				subreddit: {name: subreddit,},
			},)
		} else {
			dispatchAuthorEvent(container, 'TBpostAuthor', {
				author,
				post: {id: thingId,},
				subreddit: {name: subreddit,},
			},)
		}

		if (needsThingContainer) {
			const thingContainer = createThingContainer()
			;(isCompact ? creditBar : postEl).appendChild(thingContainer,)
			const thingContext = {
				platform: RedditPlatform.Shreddit,
				kind: isComment ? 'comment' as const : 'post' as const,
				author,
				subreddit,
				thingId,
				postId,
				isRemoved: postEl.hasAttribute('removed',),
			}
			provideLocation('thingActions', thingContainer, thingContext,)
			provideLocation('thingDetails', thingContainer, thingContext,)
			thingContainer.dispatchEvent(
				new CustomEvent('tbReddit', {
					detail: isComment
						? {
							type: 'TBcomment',
							data: {author, post: {id: postId,}, id: thingId, subreddit: {name: subreddit,},},
						}
						: {
							type: 'TBpost',
							data: {author, post: {id: thingId,}, id: thingId, subreddit: {name: subreddit,},},
						},
				},),
			)
		}
	} else {
		const {creditBar, separator, postEl, author, subreddit, postId, needsThingContainer, hasNativeAuthor,} = target

		if (!hasNativeAuthor) {
			const bullet = document.createElement('span',)
			bullet.className = 'inline-block my-0 text-neutral-content-weak'
			bullet.setAttribute('aria-hidden', 'true',)
			bullet.textContent = '•'

			const link = document.createElement('a',)
			link.className = 'toolbox-shreddit-feed-author whitespace-nowrap text-neutral-content-weak'
			link.href = `/user/${encodeURIComponent(author,)}`
			link.textContent = `u/${author}`

			const container = createAuthorContainer()
			separator.before(bullet, link, container,)

			provideLocation('authorActions', container, {
				platform: RedditPlatform.Shreddit,
				kind: 'user',
				author,
				subreddit,
				postId,
			},)
			dispatchAuthorEvent(container, 'TBpostAuthor', {
				author,
				post: {id: postId,},
				subreddit: {name: subreddit,},
			},)
		}

		if (needsThingContainer) {
			const thingContainer = createThingContainer()
			thingContainer.addEventListener('click', (e,) => e.stopPropagation(),)
			creditBar.appendChild(thingContainer,)
			const isRemoved = postEl.hasAttribute('removed',)
				|| postEl.getAttribute('moderation-verdict',) === 'MOD_REMOVED'
			const thingContext = {
				platform: RedditPlatform.Shreddit,
				kind: 'post' as const,
				author,
				subreddit,
				thingId: postId,
				postId,
				isRemoved,
			}
			provideLocation('thingActions', thingContainer, thingContext,)
			provideLocation('thingDetails', thingContainer, thingContext,)
			thingContainer.dispatchEvent(
				new CustomEvent('tbReddit', {
					detail: {
						type: 'TBpost',
						data: {author, post: {id: postId,}, id: postId, subreddit: {name: subreddit,}, isRemoved,},
					},
				},),
			)
		}
	}
}

function processUsernameTargets (root: Element,) {
	for (const {span, author, subreddit, postId, commentId,} of findUsernameTargets(root,)) {
		const container = createAuthorContainer()
		span.after(container,)

		provideLocation('authorActions', container, {
			platform: RedditPlatform.Shreddit,
			kind: 'user',
			author,
			subreddit,
			thingId: commentId ?? postId,
			postId,
			...(commentId && {commentId,}),
		},)
		if (commentId) {
			dispatchAuthorEvent(container, 'TBcommentAuthor', {
				author,
				post: {id: postId,},
				comment: {id: commentId,},
				subreddit: {name: subreddit,},
			},)
		} else {
			dispatchAuthorEvent(container, 'TBpostAuthor', {
				author,
				post: {id: postId,},
				subreddit: {name: subreddit,},
			},)
		}
	}
}

function processProfileCommentTargets (root: Element,) {
	for (const {element, author, subreddit, thingId, postId,} of findProfileCommentTargets(root,)) {
		const thingContainer = createThingContainer()
		thingContainer.addEventListener('click', (e,) => e.stopPropagation(),)
		element.appendChild(thingContainer,)
		const thingContext = {
			platform: RedditPlatform.Shreddit,
			kind: 'comment' as const,
			author,
			subreddit,
			thingId,
			postId,
		}
		provideLocation('thingActions', thingContainer, thingContext,)
		provideLocation('thingDetails', thingContainer, thingContext,)
		thingContainer.dispatchEvent(
			new CustomEvent('tbReddit', {
				detail: {
					type: 'TBcomment',
					data: {author, post: {id: postId,}, id: thingId, subreddit: {name: subreddit,},},
				},
			},),
		)
	}
}

/** Creates a fresh `toolbox-flat-list-slot` host span for the Toolbox mod-action row. */
function createFlatListSlot (): HTMLSpanElement {
	const slot = document.createElement('span',)
	slot.className = 'toolbox-flat-list-slot'
	return slot
}

/**
 * Marker class set on a `shreddit-post`/`shreddit-comment` once its Toolbox flat-list row is injected.
 * The native-control-hiding CSS targets this class directly (`.toolbox-has-flat-list-row`) instead of
 * a `:has(.toolbox-flat-list-slot)` selector, which the engine would otherwise re-evaluate against
 * every thing on every style recalc - costly at feed scale. Set here so the hide tracks slot injection.
 */
const flatListHostClass = 'toolbox-has-flat-list-row'

/**
 * Provides the `thingFlatListActions` location for shreddit posts and comments.
 *
 * The Toolbox mod-action row (Second opinion, Remove, Approve, Spam, Lock, ...) is appended to the
 * thing's bottom container ({@link flatListThingContainer}) so it renders on its own full-width line
 * below the post/comment - Reddit's native mod-action bar is too narrow (especially in card view) to
 * hold the full set without clipping. The native inline approve/remove/spam/lock controls are hidden
 * by CSS (Toolbox renders its own), so nothing is left behind in the action bar.
 */
function processFlatListActionTargets (root: Element,) {
	for (const {post, thingId, subreddit, isRemoved,} of findPostFlatListTargets(root,)) {
		const slot = createFlatListSlot()
		flatListThingContainer(post,).appendChild(slot,)
		// Mark the thing so the native-control-hiding CSS can target `.toolbox-has-flat-list-row`.
		post.classList.add(flatListHostClass,)
		// Drop the native mod actions from the post's ⋯ menu - Toolbox renders them inline in this
		// slot, so the native copies would only duplicate them. Fire-and-forget like provideLocation
		// below: the post element is discarded by Reddit on navigation, taking the attribute with it.
		suppressNativeOverflowModActions(post,)
		provideLocation('thingFlatListActions', slot, {
			platform: RedditPlatform.Shreddit,
			kind: 'post',
			thingId,
			postId: thingId,
			subreddit,
			isRemoved,
		},)
	}

	for (const {actionRow, comment, thingId, postId, subreddit, isRemoved,} of findCommentFlatListTargets(root,)) {
		const slot = createFlatListSlot()
		// Insert right before this comment's action row so the Toolbox row sits above the native
		// action bar - matching posts, where the slot lands in the post's default slot above the
		// `rpl-action-bar`. (Not at the end of the nesting `shreddit-comment`, which would put it
		// below the whole reply tree.)
		actionRow.before(slot,)
		// Mark the thing so the native-control-hiding CSS can target `.toolbox-has-flat-list-row`.
		comment.classList.add(flatListHostClass,)
		// Strip the native mod actions from this comment's ⋯ menu. Scope to the action row, not the
		// whole comment: the menu lives in the action row, and scanning the comment would re-walk every
		// nested reply's subtree on each pass (quadratic on deep threads). No-op when there's no menu.
		suppressNativeOverflowModActions(actionRow,)
		provideLocation('thingFlatListActions', slot, {
			platform: RedditPlatform.Shreddit,
			kind: 'comment',
			thingId,
			postId,
			subreddit,
			isRemoved,
		},)
	}
}

/**
 * Provides the `thingTaglineStatus` location for shreddit comments.
 * Appends a slot span after `<shreddit-comment-badges>` inside `div[slot="commentMeta"]`
 * so status indicators (e.g. lock badge) appear in the comment tagline.
 */
function processCommentMetaTargets (root: Element,) {
	for (const {badges, thingId, postId, subreddit,} of findCommentMetaTargets(root,)) {
		const slot = document.createElement('span',)
		slot.className = 'toolbox-tagline-status-slot'
		badges.after(slot,)
		provideLocation('thingTaglineStatus', slot, {
			platform: RedditPlatform.Shreddit,
			kind: 'comment',
			thingId,
			postId,
			subreddit,
		},)
	}
}

/**
 * Provides the `commentThreadControls` location for shreddit comment threads.
 * Appends a slot span inside `div[slot="comment-sort"]` (the sort toolbar row) so controls
 * such as hide-mod-comments buttons appear alongside the sort dropdown.
 */
function processCommentThreadControlTargets (root: Element,) {
	for (const {sortDiv, postId, subreddit,} of findCommentSortTargets(root,)) {
		const slot = document.createElement('span',)
		slot.className = 'toolbox-thread-controls-slot'
		sortDiv.appendChild(slot,)
		provideLocation('commentThreadControls', slot, {
			platform: RedditPlatform.Shreddit,
			kind: 'commentThread',
			postId,
			subreddit,
		},)
	}
}

/**
 * Provides the `commentComposerControls` location for shreddit reply forms.
 * Inserts a `slot="cancel-button"` sibling before the cancel button inside `shreddit-composer`
 * so toolbox controls (e.g. mod save, macro selector) appear in the composer footer button row.
 */
function processComposerControlTargets (root: Element,) {
	for (const {composer, postId, subreddit,} of findComposerTargets(root,)) {
		const slot = document.createElement('span',)
		slot.className = 'toolbox-composer-controls-slot'
		slot.setAttribute('slot', 'cancel-button',)
		composer.querySelector('#comment-composer-cancel-button',)!.before(slot,)
		provideLocation('commentComposerControls', slot, {
			platform: RedditPlatform.Shreddit,
			kind: 'commentComposer',
			postId,
			subreddit,
		}, {shadow: false, hostTag: 'span',},)
	}
}

function processHighlightCardTargets (root: Element, showPinnedAuthor: boolean,) {
	if (!showPinnedAuthor) {
		return
	}
	for (const {card, titleEl, labelSlot, author, subreddit, postId, avatarSrc,} of findHighlightCardTargets(root,)) {
		const avatarWrapper = document.createElement('span',)
		avatarWrapper.className =
			'inline-flex items-center justify-center w-[1.5rem] h-[1.5rem] rounded-full overflow-hidden shrink-0'
		const avatarImg = document.createElement('img',)
		avatarImg.className = 'mb-0 w-full h-full rounded-full'
		avatarImg.src = avatarSrc
		avatarImg.alt = ''
		avatarImg.width = 24
		avatarImg.style.width = '24px'
		avatarImg.loading = 'lazy'
		avatarWrapper.appendChild(avatarImg,)

		const link = document.createElement('a',)
		link.className = 'toolbox-shreddit-highlight-author font-bold whitespace-nowrap text-neutral-content'
		link.href = `/user/${encodeURIComponent(author,)}`
		link.textContent = `u/${author}`

		const container = createAuthorContainer()

		const creditBar = document.createElement('div',)
		creditBar.setAttribute('slot', 'title',)
		creditBar.className = 'toolbox-shreddit-highlight-credit-bar flex items-center gap-2xs text-12 pb-2xs'
		creditBar.append(avatarWrapper, link, container,)

		if (titleEl) {
			titleEl.before(creditBar,)
		} else {
			card.prepend(creditBar,)
		}
		labelSlot.style.display = 'none'

		provideLocation('authorActions', container, {
			platform: RedditPlatform.Shreddit,
			kind: 'user',
			author,
			subreddit,
			postId,
		},)
		dispatchAuthorEvent(container, 'TBpostAuthor', {
			author,
			post: {id: postId,},
			subreddit: {name: subreddit,},
		},)
	}
}
