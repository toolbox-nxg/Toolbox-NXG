/** DOM-level handler factories for the Comments module: keyword highlighting, flat view, and context popups. */
import {useEffect,} from 'react'
import {getCommentContext,} from '../../api/resources/comments'
import {isModSub,} from '../../api/resources/modSubs'
import type {CommentData, RedditMoreChildren, RedditThing,} from '../../api/resources/things'
import {getMenuarea,} from '../../dom/oldReddit/page'
import {provideLocation, renderAtLocation,} from '../../dom/uiLocations'
import {createLifecycle,} from '../../framework/lifecycle'
import {GeneralInlineButton,} from '../../shared/controls/GeneralInlineButton'
import {addContextItem, removeContextItem,} from '../../store/contextMenu'
import {negativeTextFeedback,} from '../../store/feedback'
import createLogger from '../../util/infra/logging'
import {isOldReddit, RedditPlatform,} from '../../util/infra/platform'
import {isModpage, isSubCommentsPage, isUserPage, TBPageContext,} from '../../util/reddit/pageContext'
import {getThingInfo,} from '../../util/reddit/thingInfo'
import {drawPosition,} from '../../util/ui/drawPosition'
import {highlight,} from '../../util/ui/highlight'
import {showContextPopup,} from './components/ContextPopup'
import {showFlatViewOverlay,} from './components/FlatViewOverlay'

const log = createLogger('Comments',)

/**
 * Highlights keyword matches across a collection of comment-body elements.
 * Tolerates a `null`/`undefined` collection (e.g. the result of an optional-chained
 * `querySelectorAll`) so callers can pass query results directly without guarding.
 * @param elements - The markdown/body elements to highlight, or a nullish value to skip.
 * @param highlighted - Keywords to highlight.
 */
function highlightAll (elements: Iterable<Element> | null | undefined, highlighted: string[],): void {
	if (!elements) { return }
	for (const element of elements) {
		highlight(element, highlighted,)
	}
}

/**
 * Checks whether `subreddit` is moderated by the current user and, if so, highlights all
 * keyword matches within the comment markdown elements nearest to `target`.
 * @param target - Element from which to search upward for comment content containers.
 * @param subreddit - Subreddit name to check for mod status.
 * @param highlighted - Keywords to highlight.
 */
export async function applyHighlight (target: Element, subreddit: string, highlighted: string[],): Promise<void> {
	const isMod = await isModSub(subreddit,)
	if (!isMod) { return }
	highlightAll(target.closest('.toolbox-comment, .entry',)?.querySelectorAll('.md',), highlighted,)
	highlightAll(target.closest('.Comment',)?.querySelectorAll('p',), highlighted,)
}

/**
 * Runs keyword highlighting as a side-effect when mounted into a comment's `thingDetails` location.
 * Returns null - it produces no visible output; highlighting is applied directly to surrounding DOM.
 */
function HighlightEffect ({target, subreddit, highlighted,}: {
	target: Element
	subreddit: string
	highlighted: string[]
},) {
	useEffect(() => {
		void applyHighlight(target, subreddit, highlighted,)
	}, [],)
	return null
}

/**
 * Provides the `commentThreadControls` UI location on the page menuarea for user-page comment threads.
 * Performs the DOM query and DOM manipulation; call `lifecycle.mount(cleanup)` in `index.ts`.
 * @returns A cleanup function, or null if the menuarea element was not found.
 */
export function createUserPageCommentControls (): (() => void) | null {
	const menuarea = getMenuarea()
	if (!menuarea) { return null }
	return provideLocation('commentThreadControls', menuarea, {
		platform: RedditPlatform.Old,
		kind: 'commentThread',
	}, {shadow: false,},)
}

/**
 * Creates handlers that highlight a list of keywords in comment text on mod-subreddits.
 * Registers a `thingDetails` renderer so highlighting fires per-comment on both platforms.
 * @param highlighted The list of keyword strings to highlight.
 * @returns Handlers for expando clicks and page navigation, plus a cleanup function.
 *   Call `lifecycle.mount(handlers.cleanup)` in `index.ts`.
 */
export function createHighlightHandlers (highlighted: string[],) {
	const lifecycle = createLifecycle()
	renderAtLocation('thingDetails', {id: 'comment.highlight', lifecycle,}, ({context, target,},) => {
		if (context.kind !== 'comment') { return null }
		return (
			<HighlightEffect
				target={target}
				subreddit={context.subreddit ?? ''}
				highlighted={highlighted}
			/>
		)
	},)

	return {
		cleanup: lifecycle.cleanup,
		async handleExpando (element: Element,) {
			const thing = element as HTMLElement
			const thingInfo = await getThingInfo(thing, true,)
			if (thingInfo?.subreddit) {
				lifecycle.timeout(() => {
					highlightAll(thing.querySelectorAll('.md',), highlighted,)
				}, 200,)
			}
		},
		async handleNewPage (event: CustomEvent<TBPageContext>,) {
			const {pageType, pageDetails,} = event.detail
			if (pageType === 'subredditCommentPermalink' || pageType === 'subredditCommentsPage') {
				const isModSubreddit = await isModSub(pageDetails.subreddit ?? '',)
				if (isModSubreddit) {
					highlightAll(
						document.querySelectorAll('div[data-test-id="post-content"] p, .link .usertext-body p',),
						highlighted,
					)
				}
			}
		},
	}
}

/**
 * Creates handlers that manage the flat-view context menu item and open the flat-view overlay.
 * @param openContextInPopup Whether clicking a context link should open a popup instead of navigating.
 * @returns Handlers for page navigation events and the flat-view button click.
 */
export function createFlatViewHandlers (openContextInPopup: boolean,) {
	return {
		handleNewPage (event: CustomEvent<TBPageContext>,) {
			if (event.detail.pageType === 'subredditCommentsPage') {
				addContextItem('toolbox-flatview-link', {
					title: 'View comments for this thread in chronological flat view.',
					text: 'comment flat view',
					icon: 'list',
				},)
			} else {
				removeContextItem('toolbox-flatview-link',)
			}
		},
		handleFlatViewClick (_target: Element, _event: Event,) {
			showFlatViewOverlay(openContextInPopup ? openCommentContextPopup : false,)
		},
	}
}

/**
 * Fetches comment context from the Reddit API and displays it in a `ContextPopup`.
 * @param commentID The fullname of the comment to highlight in the popup.
 * @param permalink The comment permalink used to fetch context data.
 * @param event The mouse event that triggered the popup, used to position it.
 */
export function openCommentContextPopup (commentID: string, permalink: string, event: MouseEvent,) {
	const positions = drawPosition(event,)
	getCommentContext(permalink,).then((data,) => {
		const listing = data[1]
		if (!listing?.data.children.length) {
			negativeTextFeedback('Content inaccessible; removed or deleted?',)
			return
		}
		// Children are untyped comment things from the API; narrow to the modeled comment shape.
		const children = listing.data.children as (RedditThing<CommentData> | RedditMoreChildren)[]
		// The first context child is the highlighted comment; read its author/subreddit directly.
		const firstChild = children[0] as RedditThing<CommentData> | undefined
		const contextUser = firstChild?.data?.author
		const contextSubreddit = firstChild?.data?.subreddit
		showContextPopup({
			title: `Context for /u/${contextUser} in /r/${contextSubreddit}`,
			initialPosition: {top: positions.topPosition, left: positions.leftPosition,},
			commentsData: children,
			highlightCommentId: commentID,
		},)
	},).catch((error: unknown,) => log.error(error,))
}

/**
 * Creates handlers for context-popup button injection on comment action rows.
 *
 * Old Reddit: registers a `thingFlatListActions` renderer, limited to mod/user/permalink pages.
 * The slot is provided per-comment by `oldreddit/dom.ts`; no `TBNewThings` wiring is needed.
 *
 * Shreddit: registers a `thingActions` renderer, limited to user-profile pages (the popup is only
 * useful where comments appear out of thread context).
 *
 * @returns `{cleanup}` to be wired by `index.ts`.
 */
export function createContextPopupHandlers () {
	log.debug('openContextInPopup enabled.',)

	if (isOldReddit) {
		// Old Reddit: render into the flat-list button row provided by oldreddit/dom.ts.
		// The page-type guard here mirrors the old per-element check: only mod queue,
		// user pages, and single-comment permalink pages have the native "context" link.
		const cleanup = renderAtLocation('thingFlatListActions', {id: 'comment.contextPopup',}, ({context,},) => {
			if (!(isModpage || isUserPage || isSubCommentsPage)) { return null }
			if (context.kind !== 'comment') { return null }
			const {thingId, postId, subreddit,} = context
			if (!thingId?.startsWith('t1_',) || !postId || !subreddit) { return null }
			const permalink = `/r/${subreddit}/comments/${postId.substring(3,)}/-/${thingId.substring(3,)}/`
			return (
				<a
					className="context-popup"
					style={{cursor: 'pointer',}}
					onClick={(event,) => openCommentContextPopup(thingId, permalink, event.nativeEvent,)}
				>
					context-popup
				</a>
			)
		},)
		return {cleanup,}
	}

	// Shreddit: inject via thingActions. Only useful on user-profile pages, where comments are
	// shown out of their thread context - in a normal comment thread the comment is already in
	// context, so the popup is redundant (and clutters the new per-comment Toolbox action row).
	const cleanup = renderAtLocation('thingActions', {id: 'comment.contextPopup',}, ({context,},) => {
		if (!isUserPage) { return null }
		if (context.kind !== 'comment') { return null }
		const {thingId, postId, subreddit,} = context
		if (!thingId?.startsWith('t1_',) || !postId || !subreddit) { return null }
		const permalink = `/r/${subreddit}/comments/${postId.substring(3,)}/-/${thingId.substring(3,)}/`
		return (
			<GeneralInlineButton
				className="context-popup"
				onClick={(event,) => openCommentContextPopup(thingId, permalink, event.nativeEvent,)}
			>
				context-popup
			</GeneralInlineButton>
		)
	},)

	return {cleanup,}
}
