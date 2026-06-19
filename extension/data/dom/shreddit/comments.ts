/** DOM finders for comment-thread surfaces in the Shreddit UI (shreddit-comment and shreddit-post elements). */

import {stripSubredditPrefix, subredditFromPermalink,} from './things'

/** Data extracted from a `u/` username span inside a shreddit comment or post. */
export interface UsernameTarget {
	/** The `<span dir="auto">` element containing the username text. */
	span: Element
	author: string
	subreddit: string
	/** Fullname of the parent post (e.g. `t3_abc123`). */
	postId: string
	/** Fullname of the comment, or undefined when extracted from a post element. */
	commentId: string | undefined
}

/**
 * Find u/ username spans that need a toolbox author anchor.
 * Skips spans inside mod-notes-opener elements, hover card slots, and already-processed spans.
 * Only returns spans inside a shreddit-comment or shreddit-post.
 *
 * shreddit-comment carries `thingid` and `postid` (no dashes) and has no
 * `subreddit-prefixed-name` attribute - subreddit is extracted from `permalink`.
 */
export function findUsernameTargets (root: Element,): UsernameTarget[] {
	const results: UsernameTarget[] = []
	for (const span of root.querySelectorAll('span[dir="auto"]',)) {
		const text = span.textContent?.trim() ?? ''
		if (!text.startsWith('u/',)) { continue }
		if (span.closest('mod-notes-opener',)) { continue }
		if (span.closest('[slot="content"]',)) { continue }
		if (span.nextElementSibling?.classList.contains('toolbox-author-slot',)) { continue }

		const author = text.slice(2,)
		const commentEl = span.closest('shreddit-comment',)
		const postEl = span.closest('shreddit-post',)

		if (commentEl) {
			const commentId = commentEl.getAttribute('thingid',) ?? undefined
			const postId = postEl?.getAttribute('id',) ?? commentEl.getAttribute('postid',) ?? ''
			const subreddit = subredditFromPermalink(commentEl.getAttribute('permalink',) ?? '',)
				|| (postEl?.getAttribute('subreddit-name',) ?? '')
			if (!subreddit) { continue }
			results.push({span, author, subreddit, postId, commentId,},)
		} else if (postEl) {
			const postId = postEl.getAttribute('id',) ?? ''
			const subreddit = stripSubredditPrefix(postEl.getAttribute('subreddit-prefixed-name',) ?? '',)
			results.push({span, author, subreddit, postId, commentId: undefined,},)
		}
	}
	return results
}

/** Finds the comment entry element with the given comment ID within a rendered comment thread. */
export function getCommentEntryByCommentId (root: Element, commentId: string,): Element | null {
	return root.querySelector(`[data-comment-id="${CSS.escape(commentId,)}"]`,)
}

/** Data extracted from a `div[slot="commentMeta"]` that needs a `thingTaglineStatus` slot. */
export interface CommentMetaTarget {
	/** The `<shreddit-comment-badges>` element to insert after. */
	badges: Element
	/** Comment fullname (e.g. `t1_abc123`). */
	thingId: string
	/** Post fullname (e.g. `t3_abc123`). */
	postId: string
	subreddit: string
}

/**
 * Finds `div[slot="commentMeta"]` elements that need a `thingTaglineStatus` slot injected.
 * Each result's `badges` field is the `<shreddit-comment-badges>` element to insert after.
 * Skips elements that already have a `toolbox-tagline-status-slot` sibling.
 */
export function findCommentMetaTargets (root: Element,): CommentMetaTarget[] {
	const metas: Element[] = root.matches('[slot="commentMeta"]',) ? [root,] : []
	metas.push(...root.querySelectorAll('[slot="commentMeta"]',),)

	const results: CommentMetaTarget[] = []
	for (const meta of metas) {
		const badges = meta.querySelector('shreddit-comment-badges',)
		if (!badges) { continue }
		if (badges.nextElementSibling?.classList.contains('toolbox-tagline-status-slot',)) { continue }

		const commentEl = meta.closest('shreddit-comment',)
		if (!commentEl) { continue }

		const thingId = commentEl.getAttribute('thingid',)
		const postId = commentEl.getAttribute('postid',) ?? ''
		const subreddit = subredditFromPermalink(commentEl.getAttribute('permalink',) ?? '',)
		if (!thingId || !postId || !subreddit) { continue }

		results.push({badges, thingId, postId, subreddit,},)
	}
	return results
}
