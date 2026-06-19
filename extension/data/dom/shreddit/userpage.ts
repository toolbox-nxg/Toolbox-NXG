/** DOM finders for user profile pages. */

/** Data extracted from a shreddit-profile-comment element on user profile pages. */
export interface ProfileCommentTarget {
	element: Element
	author: string
	subreddit: string
	thingId: string
	postId: string
}

/**
 * Find shreddit-profile-comment elements that need a toolbox thing container.
 * These appear on user profile pages and don't contain mod-notes-opener elements,
 * so they are handled separately from findModNotesTargets.
 *
 * Author is extracted from the poster-info anchor rather than a direct attribute since
 * shreddit-profile-comment only carries user-id, not user-name.
 */
export function findProfileCommentTargets (root: Element,): ProfileCommentTarget[] {
	const elements: Element[] = root.matches('shreddit-profile-comment',) ? [root,] : []
	elements.push(...root.querySelectorAll('shreddit-profile-comment',),)

	const results: ProfileCommentTarget[] = []
	for (const element of elements) {
		if (element.querySelector(':scope > .toolbox-thing-slot',)) { continue }

		const thingId = element.getAttribute('comment-id',)
		if (!thingId || !thingId.startsWith('t1_',)) { continue }

		const href = element.getAttribute('href',) ?? ''
		const match = href.match(/^\/r\/([^/]+)\/comments\/([^/]+)\//,)
		const subreddit = match?.[1]
		const postShortId = match?.[2]
		if (!subreddit || !postShortId) { continue }
		const postId = `t3_${postShortId}`

		const posterInfo = element.querySelector(`[id="poster-info-${thingId}"]`,)
		const authorHref = posterInfo?.querySelector('a[href^="/user/"]',)?.getAttribute('href',) ?? ''
		const authorMatch = authorHref.match(/^\/user\/([^/]+)/,)
		const author = authorMatch?.[1]
		if (!author) { continue }

		results.push({element, author, subreddit, thingId, postId,},)
	}
	return results
}
