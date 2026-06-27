/** DOM finders for comment-thread-level surfaces: sort bar and composer. */

import {collectMatches, subredditFromPermalink,} from './things'

/** Data extracted from a `shreddit-comments-sort-dropdown` that needs a `commentThreadControls` slot. */
export interface CommentSortTarget {
	/** The `<div slot="comment-sort">` element to append the slot into. */
	sortDiv: Element
	/** Post fullname (e.g. `t3_abc123`). */
	postId: string
	subreddit: string
}

/** Data extracted from a `shreddit-composer` that needs a `commentComposerControls` slot. */
export interface ComposerTarget {
	/** The `<shreddit-composer>` element - the cancel-button slot sibling is inserted here. */
	composer: Element
	/** Post fullname (e.g. `t3_abc123`). */
	postId: string
	subreddit: string
}

/**
 * Finds `div[slot="comment-sort"]` elements that need a `commentThreadControls` slot injected.
 * Context (postId, subreddit) is extracted from the nearest `shreddit-comment-tree` ancestor.
 * Skips elements that already have a `toolbox-thread-controls-slot` child.
 */
export function findCommentSortTargets (root: Element,): CommentSortTarget[] {
	const results: CommentSortTarget[] = []
	for (const sortDiv of collectMatches(root, '[slot="comment-sort"]',)) {
		if (sortDiv.querySelector(':scope > .toolbox-thread-controls-slot',)) { continue }

		// shreddit-comment-tree carries post-id and permalink; it wraps the sort dropdown.
		// When the sort div is rendered outside the tree (e.g. via a slot projection),
		// fall back to the single document-level tree element.
		const tree = sortDiv.closest('shreddit-comment-tree',) ?? document.querySelector('shreddit-comment-tree',)
		if (!tree) { continue }

		const postId = tree.getAttribute('post-id',) ?? ''
		const subreddit = subredditFromPermalink(tree.getAttribute('permalink',) ?? '',)
		if (!postId || !subreddit) { continue }

		results.push({sortDiv, postId, subreddit,},)
	}
	return results
}

/**
 * Finds `shreddit-composer` elements that need a `commentComposerControls` slot injected.
 * The cancel-button slot sibling is used as the injection point so toolbox controls appear
 * in the composer's footer button row. Subreddit is extracted from the page URL since
 * `shreddit-composer` carries no subreddit attribute directly.
 * Skips elements that already have a `toolbox-composer-controls-slot` sibling of the cancel button.
 */
export function findComposerTargets (root: Element,): ComposerTarget[] {
	const results: ComposerTarget[] = []
	for (const composer of collectMatches(root, 'shreddit-composer',)) {
		const cancelButton = composer.querySelector('#comment-composer-cancel-button',)
		if (!cancelButton) { continue }
		if (cancelButton.previousElementSibling?.classList.contains('toolbox-composer-controls-slot',)) { continue }

		const composerHost = composer.closest('comment-composer-host',)
		const postId = composerHost?.getAttribute('post-id',) ?? ''
		if (!postId) { continue }

		const subreddit = subredditFromPermalink(window.location.pathname,)
		if (!subreddit) { continue }

		results.push({composer, postId, subreddit,},)
	}
	return results
}
