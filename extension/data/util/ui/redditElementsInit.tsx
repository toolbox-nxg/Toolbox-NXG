/**
 * Initializes Toolbox's React-rendered Reddit elements (TBComment, TBSubmission) and wires up
 * action button delegation, "load more comments" handling, and toolbox container tagging.
 */

import {ReactNode,} from 'react'
import {flushSync,} from 'react-dom'
import {createRoot, Root,} from 'react-dom/client'

import {getMoreComments,} from '../../api/resources/comments'
import type {CommentData, RedditMoreChildren, RedditThing, SubmissionData,} from '../../api/resources/things'
import {provideLocation,} from '../../dom/uiLocations'
import {comments, queueTools,} from '../../framework/moduleIds'
import {
	type ProposalContext,
	proposeOrApprove,
	proposeOrLock,
	proposeOrMarkNsfw,
	type ProposeOrPerformResult,
	proposeOrRemove,
	proposeOrUnlock,
} from '../../modules/shared/proposals/gateway'
import store from '../../store'
import {startSpinner, stopSpinner,} from '../../store/spinnerSlice'
import {purifyObject,} from '../data/purify'
import {registerItemSubreddit,} from '../infra/captureGuard'
import createLogger from '../infra/logging'
import {currentPlatform, RedditPlatform,} from '../infra/platform'
import {getSettingAsync,} from '../persistence/settings'
import {delegate,} from './dom'
import {tagToolboxContainer,} from './toolboxContainer'

import {TBComment, TBCommentChildren,} from '../../modules/shared/redditElements/TBComment'
import {TBSubmission,} from '../../modules/shared/redditElements/TBSubmission'
import type {CommentOptions, SubmissionOptions,} from '../../modules/shared/redditElements/types'

const log = createLogger(comments,)

// We don't want inline Toolbox buttons to propagate to parent elements as that often triggers the reddit lightbox
delegate(document.body, 'click', '.toolbox-general-button', (_target, event,) => {
	event.stopPropagation()
},)

let subredditColorSalt = 'PJSalt'
/** Resolves once the subreddit color salt has been loaded from extension storage. Await before any make* call where correctness is required. */
export const colorSaltReady: Promise<void> = getSettingAsync(queueTools, 'subredditColorSalt', 'PJSalt',).then(
	// `getSettingAsync` reads from the heterogeneous (`any`-valued) settings store; this
	// setting is always a string, so narrow the resolved value here.
	(salt: string,) => {
		subredditColorSalt = salt
	},
)

/** Returns the current subreddit color salt used when computing per-subreddit border colors. */
export function getSubredditColorSalt () {
	return subredditColorSalt
}

// jsAPI bridge: inject toolbox slots and tag toolbox containers for a single toolbox-thing element.
// Idempotent: a data attribute prevents double-processing if called more than once.
function processTBThing (element: Element,) {
	if ((element as HTMLElement).dataset.tbThingInit) { return }
	;(element as HTMLElement).dataset.tbThingInit = '1'

	// Feed the capture-guard backstop: record this thing's subreddit keyed by its
	// fullname so a moderation primitive that only receives a fullname (e.g. a macro
	// or legacy button path that never routed through the proposals gateway) can
	// still resolve the subreddit and fail-closed for a sandboxed trainee.
	const thingFullname = element.getAttribute('data-fullname',)
	const thingSubreddit = element.getAttribute('data-subreddit',)
	if (thingFullname && thingSubreddit) {
		registerItemSubreddit(thingSubreddit, thingFullname,)
	}

	if (element.classList.contains('toolbox-comment',)) {
		const commentSlot = element.querySelector(
			':scope > .toolbox-comment-entry > .toolbox-comment-slot',
		)
		const authorSlot = element.querySelector(
			':scope > .toolbox-comment-entry > .toolbox-tagline .toolbox-author-slot',
		)
		const commentAuthor = element.getAttribute('data-comment-author',)
		const postID = element.getAttribute('data-comment-post-id',)
		const commentID = element.getAttribute('data-comment-id',)
		const subredditName = element.getAttribute('data-subreddit',)

		if (commentSlot && !commentSlot.classList.contains('toolbox-frontend-container',)) {
			commentSlot.insertAdjacentHTML('beforeend', '<span data-name="toolbox">',)
			tagToolboxContainer(commentSlot, 'TBcomment',)
		}
		if (authorSlot) {
			provideLocation('authorActions', authorSlot, {
				platform: currentPlatform ?? RedditPlatform.Shreddit,
				kind: 'user',
				author: commentAuthor ?? '[deleted]',
				subreddit: subredditName ?? '',
				thingId: commentID ?? '',
				postId: postID ?? '',
			},)
		}
	}

	if (element.classList.contains('toolbox-submission',)) {
		const submissionSlot = element.querySelector('.toolbox-submission-slot',)
		if (!submissionSlot) { return }
		submissionSlot.insertAdjacentHTML('beforeend', '<span data-name="toolbox">',)
		const authorSlot = element.querySelector('.toolbox-author-slot',)

		const submissionAuthor = element.getAttribute('data-submission-author',)
		const postID = element.getAttribute('data-post-id',)
		const subredditName = element.getAttribute('data-subreddit',)

		if (!submissionSlot.classList.contains('toolbox-frontend-container',)) {
			tagToolboxContainer(submissionSlot, 'TBpost',)
		}
		if (authorSlot) {
			provideLocation('authorActions', authorSlot, {
				platform: currentPlatform ?? RedditPlatform.Shreddit,
				kind: 'user',
				author: submissionAuthor ?? '[deleted]',
				subreddit: subredditName ?? '',
				thingId: postID ?? '',
				postId: postID ?? '',
			},)
		}
	}
}

/**
 * Processes all `.toolbox-thing` elements inside `elements`, injecting toolbox slots and
 * tagging toolbox containers so modules can attach their UI.
 * @param elements A single element or array-like collection to scan.
 */
export function tbRedditEvent (elements: Element | ArrayLike<Element>,) {
	const container = (elements instanceof Element) ? elements : elements[0]
	if (!container || typeof container.querySelectorAll !== 'function') { return }
	container.querySelectorAll('.toolbox-thing',).forEach((element: Element,) => {
		processTBThing(element,)
	},)
}

// React mount helpers - return DOM elements compatible with existing consumers.
function mountReactToHost (host: HTMLElement, content: ReactNode,): Root {
	const root = createRoot(host,)
	flushSync(() => {
		root.render(content,)
	},)
	return root
}

/** Creates a display:contents host, mounts `content` into it synchronously, and returns the host. */
function makeTBElement (content: ReactNode,): HTMLElement {
	const host = makeReactHost()
	mountReactToHost(host, content,)
	return host
}

// React 18 attaches synthetic-event listeners to the root container passed to
// `createRoot`. If we returned the rendered tree's root element (e.g.
// firstElementChild) and a consumer reparented it elsewhere, the React root
// container would be orphaned and click handlers would silently stop firing.
// We instead return the host container itself (with `display: contents` so it's
// visually transparent), keeping React's tree inside the container it owns.

function makeReactHost () {
	const host = document.createElement('div',)
	host.classList.add('toolbox-react-host',)
	host.style.display = 'contents'
	return host
}

/**
 * Renders a TBSubmission React component into a detached host element and returns it.
 * The host element uses `display: contents` so it is visually transparent.
 */
export function makeSubmissionEntry (
	submission: RedditThing<SubmissionData>,
	submissionOptions?: SubmissionOptions,
): HTMLElement {
	purifyObject(submission,)
	return makeTBElement(
		<TBSubmission submission={submission} options={submissionOptions} subredditColorSalt={subredditColorSalt} />,
	)
}

/**
 * Renders a single TBComment React component into a detached host element and returns it.
 */
export function makeSingleComment (
	comment: RedditThing<CommentData>,
	commentOptions: CommentOptions = {},
): HTMLElement {
	purifyObject(comment,)
	return makeTBElement(
		<TBComment comment={comment} options={commentOptions} subredditColorSalt={subredditColorSalt} />,
	)
}

/**
 * Renders a TBCommentChildren React component for a list of comment API objects and returns the host element.
 * @param jsonInput Array of Reddit API comment/more child objects.
 * @param commentOptions Optional rendering options forwarded to the comment components.
 */
export function makeCommentThread (
	jsonInput: (RedditThing<CommentData> | RedditMoreChildren)[],
	commentOptions?: CommentOptions,
): HTMLElement {
	jsonInput.forEach((item,) => {
		if (item) { purifyObject(item,) }
	},)
	return makeTBElement(
		<TBCommentChildren items={jsonInput} options={commentOptions} subredditColorSalt={subredditColorSalt} />,
	)
}

// ====================================================================
// Action button click handlers - body-level delegation, kept as-is so
// content rendered by either React components or legacy callers (e.g.
// betterbuttons.js) all work without coupling.
// ====================================================================

/**
 * Wires a delegated click handler for a Toolbox action button. `perform` receives a
 * proposal context built from the element's data attributes and returns whether the
 * action was captured for review (training mode) or performed; the button is then
 * replaced with the appropriate status text.
 */
function actionButton (
	selector: string,
	perform: (ctx: ProposalContext,) => Promise<ProposeOrPerformResult | void>,
	pastTense: string,
) {
	delegate(document.body, 'click', selector, (element,) => {
		const fullname = element.getAttribute('data-fullname',)
		if (!fullname) { return }
		// The action button only carries `data-fullname`; the subreddit lives on the
		// enclosing `.toolbox-thing` container. Reading it from the button gave the
		// gateway an empty subreddit, which made the capture decision fall through and
		// perform the real action for a sandboxed trainee. Resolve it from the thing.
		const thing = element.closest('.toolbox-thing',)
		const ctx: ProposalContext = {
			subreddit: thing?.getAttribute('data-subreddit',) ?? '',
			itemId: fullname,
			itemKind: fullname.startsWith('t1_',) ? 'comment' : 'post',
		}
		perform(ctx,).then((outcome,) => {
			const result = document.createElement('span',)
			result.className = 'toolbox-actioned-button'
			result.textContent = outcome === 'captured' ? 'sent for review' : pastTense
			element.before(result,)
			element.remove()
		},).catch((error: unknown,) => {
			const result = document.createElement('span',)
			result.className = 'toolbox-actioned-button toolbox-actioned-error'
			// The rejection reason is an untyped thrown value; render it as text, falling back
			// to a generic message when it is falsy (matching the prior `||` behavior).
			result.textContent = error ? String(error,) : 'something went wrong'
			element.before(result,)
			element.remove()
		},)
	},)
}

actionButton(
	'.toolbox-comment-button-approve, .toolbox-submission-button-approve',
	(ctx,) => proposeOrApprove(ctx,),
	'approved',
)
actionButton(
	'.toolbox-comment-button-remove, .toolbox-submission-button-remove',
	(ctx,) => proposeOrRemove(ctx, false,),
	'removed',
)
actionButton(
	'.toolbox-comment-button-spam, .toolbox-submission-button-spam',
	(ctx,) => proposeOrRemove(ctx, true,),
	'spammed',
)
actionButton('.toolbox-submission-button-lock', (ctx,) => proposeOrLock(ctx,), 'locked',)
actionButton('.toolbox-submission-button-unlock', (ctx,) => proposeOrUnlock(ctx,), 'unlocked',)
// NSFW toggles route through the gateway, so they're captured as proposals in training mode.
actionButton('.toolbox-submission-button-nsfw', (ctx,) => proposeOrMarkNsfw(ctx, true,), 'marked nsfw',)
actionButton('.toolbox-submission-button-unsfw', (ctx,) => proposeOrMarkNsfw(ctx, false,), 'unmarked nsfw',)

// Toggle handler is now driven by component state in <TBComment>; legacy `.toolbox-comment-toggle`
// rendered by other code (none in current modules) is no longer supported.

delegate(document.body, 'click', '.toolbox-load-more-comments', (element,) => {
	const thisMoreComments = element.closest('.toolbox-more-comments',)
	if (!thisMoreComments) { return }
	const commentIDs = (element.getAttribute('data-ids',) || '').split(',',)
	const commentIDcount = commentIDs.length
	const thisComment = element.closest('.toolbox-comment',)
	if (!thisComment) { return }
	const threadPermalink = thisComment.getAttribute('data-thread-permalink',)
	if (!threadPermalink) { return }
	const commentOptionsData = thisComment.getAttribute('data-comment-options',)
	const commentOptions: CommentOptions = commentOptionsData ? JSON.parse(commentOptionsData,) as CommentOptions : {}
	commentOptions.commentDepthPlus = true

	let settledCount = 0
	let successCount = 0
	store.dispatch(startSpinner(),)
	commentIDs.forEach((id,) => {
		getMoreComments(threadPermalink, id,)
			.then(async (data,) => {
				await colorSaltReady
				// data[1] is the comment listing; its children are heterogeneous comment-tree
				// JSON nodes, narrowed here to the union the renderer accepts.
				const children = (data[1]?.data.children ?? []) as (RedditThing<CommentData> | RedditMoreChildren)[]
				const commentsEl = makeCommentThread(children, commentOptions,)
				window.requestAnimationFrame(() => {
					// Insert the host wrapper itself; its React tree stays intact
					// and synthetic events keep firing.
					thisMoreComments.before(commentsEl,)
				},)
				tbRedditEvent(commentsEl,)
				successCount += 1
			},)
			.catch((error: unknown,) => {
				log.error('Failed to load more comments', error,)
			},)
			// `finally` runs whether the fetch resolved or rejected, so the spinner counter is always
			// balanced - without it a single failed request would strand the global spinner (and the
			// beforeunload guard keyed off it) on permanently.
			.finally(() => {
				settledCount += 1
				if (settledCount === commentIDcount) {
					// Only drop the "load more comments" placeholder once everything loaded; if any
					// batch failed, leave it in place so the user can retry.
					if (successCount === commentIDcount) {
						thisMoreComments.remove()
					}
					store.dispatch(stopSpinner(),)
				}
			},)
	},)
},)

// Self-expando button handler is now driven by component state in <TBSubmission>.
