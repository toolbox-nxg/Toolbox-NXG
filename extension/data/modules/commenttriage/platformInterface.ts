/**
 * Platform interface and old-Reddit binding for the Comment Triage module's DOM interactions.
 * Implementations provide platform-specific comment discovery, metadata reading, tree traversal,
 * and collapse/expand behavior.
 */
import {getCommentPageRootSitetable, getUncheckedCommentThings,} from '../../dom/oldReddit/comments'
import {
	collapseCommentThing,
	getCommentThingChildCount,
	getCommentThingScore,
	getThingAuthorEl,
	getThingChildSitetable,
	getThingDirectCommentChildren,
	getThingParentComment,
	isThingControversial,
	uncollapseCommentThing,
} from '../../dom/oldReddit/things'

export interface CommentTriageAdapter {
	/** CSS selector that matches a comment container element (e.g. `.thing` or `shreddit-comment`). */
	commentSelector: string

	/** Returns all comment elements not yet processed by the triage run. */
	findNewComments(): Element[]
	/** Marks a comment element as processed so it is not re-scored on subsequent runs. */
	markProcessed(el: Element,): void

	/**
	 * Reads the vote score for a comment.
	 * @returns The numeric score, or null if unavailable on this platform.
	 */
	readScore(el: Element,): number | null
	/**
	 * Reads the number of child comments.
	 * @returns The child count, or null if unavailable on this platform.
	 */
	readChildCount(el: Element,): number | null
	/** Returns true if the comment is marked controversial by Reddit. */
	isControversial(el: Element,): boolean
	/**
	 * Returns the href of the author link for a comment, used to identify the current user's own comments.
	 * @returns The author profile URL, or null if not present.
	 */
	getAuthorHref(el: Element,): string | null

	/**
	 * Returns the nearest ancestor comment element, for walking the comment tree upward.
	 * @returns The parent comment element, or null if at the root.
	 */
	getParentComment(el: Element,): Element | null
	/** Returns the direct child comment elements within a container, excluding "load more" stubs. */
	getDirectChildren(container: Element,): HTMLElement[]
	/**
	 * Returns the child sitetable/container element of a comment, used when recursively sorting children.
	 * @returns The child container, or null if the comment has no children.
	 */
	getChildContainer(el: Element,): Element | null

	/**
	 * Returns the root comment container for the page.
	 * @returns The root sitetable or equivalent element, or null if not found.
	 */
	getRootContainer(): Element | null

	/** Collapses a comment element. */
	collapse(el: Element,): void
	/** Expands (uncollapses) a comment element. */
	uncollapse(el: Element,): void

	/**
	 * Performs any pre-sort fixup needed before the sort algorithm runs.
	 * On old Reddit this flattens Never-Ending Reddit (NER) pagination markers;
	 * on other platforms this is a no-op.
	 */
	preSortFixup(container: Element,): void

	/**
	 * Returns the sitetable container to re-sort after a "load more comments" click.
	 * @param clickTarget The element that was clicked.
	 * @returns The container to re-sort, or null if not applicable.
	 */
	getMoreChildrenContainer(clickTarget: Element,): Element | null
}

/** Returns the old-Reddit binding for `CommentTriageAdapter`. */
export function createOldRedditAdapter (): CommentTriageAdapter {
	return {
		commentSelector: '.thing',

		findNewComments () {
			return getUncheckedCommentThings('toolbox-pc-proc',)
		},

		markProcessed (el,) {
			el.classList.add('toolbox-pc-proc',)
		},

		readScore (el,) {
			return getCommentThingScore(el,)
		},

		readChildCount (el,) {
			return getCommentThingChildCount(el,)
		},

		isControversial (el,) {
			return isThingControversial(el,)
		},

		getAuthorHref (el,) {
			return (getThingAuthorEl(el,) as HTMLAnchorElement | null)?.href ?? null
		},

		getParentComment (el,) {
			return getThingParentComment(el,)
		},

		getDirectChildren (container,) {
			return getThingDirectCommentChildren(container,)
		},

		getChildContainer (el,) {
			return getThingChildSitetable(el,)
		},

		getRootContainer () {
			return getCommentPageRootSitetable()
		},

		collapse (el,) {
			collapseCommentThing(el,)
		},

		uncollapse (el,) {
			uncollapseCommentThing(el,)
		},

		preSortFixup (container,) {
			const linklisting = container.querySelectorAll('.linklisting',)
			if (!linklisting.length) { return }
			linklisting.forEach((ner,) => {
				Array.from(ner.querySelectorAll(':scope > .thing',),).forEach((thing,) => container.appendChild(thing,))
			},)
			document.querySelectorAll('.NERPageMarker, .clearleft + .clearleft',).forEach((el,) => el.remove())
		},

		getMoreChildrenContainer (clickTarget,) {
			return clickTarget.closest('.sitetable',)
		},
	}
}

// NOTE: createShredditPlatformInterface() is deferred pending browser-side DOM research on
// shreddit-comment. Key unknowns: score attribute, collapse mechanism, child-count
// exposure, controversy signal, tree structure, and inject point.
// What is already determinable when that research is done:
//
//   findNewComments:   getUncheckedCommentThings equivalent using 'data-tb-ct-proc' attribute
//   markProcessed:     el.setAttribute('data-tb-ct-proc', '')
//   isControversial:   return false  (signal not exposed)
//   readChildCount:    return null   (not exposed in light DOM)
//   getParentComment:  el.parentElement?.closest('shreddit-comment')
