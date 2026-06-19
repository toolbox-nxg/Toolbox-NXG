/** DOM finders for feed-level surfaces: credit bars and community highlight cards. */

import {stripSubredditPrefix,} from './things'

export type CreditBarTarget =
	| {
		kind: 'mod-notes'
		creditBar: Element
		separator: Element
		author: string
		subreddit: string
		thingId: string
		postId: string
		postEl: Element
		isCompact: boolean
		/** Whether postEl still needs a thing-level container appended. */
		needsThingContainer: boolean
	}
	| {
		kind: 'feed-only'
		creditBar: Element
		separator: Element
		postEl: Element
		author: string
		subreddit: string
		postId: string
		/** Whether postEl still needs a thing-level container appended. */
		needsThingContainer: boolean
		/**
		 * True when the credit bar already has a native [slot="authorName"] element (e.g. mod
		 * queues). In that case the username link must not be inserted, but needsThingContainer
		 * should still be processed.
		 */
		hasNativeAuthor: boolean
	}

/**
 * Find feed post credit bars that need a toolbox anchor.
 * Returns both mod-notes-backed targets and feed-only targets (no mod-notes-opener present).
 * Callers should skip feed-only targets when the feedPageUsernames setting is disabled.
 */
export function findCreditBarTargets (root: Element,): CreditBarTarget[] {
	const creditBars: Element[] = root.id?.startsWith('feed-post-credit-bar-',) ? [root,] : []
	creditBars.push(...root.querySelectorAll('[id^="feed-post-credit-bar-"]',),)

	const results: CreditBarTarget[] = []
	for (const creditBar of creditBars) {
		const separator = creditBar.querySelector(':scope > .created-separator',)
		if (!separator) { continue }
		if (separator.previousElementSibling?.classList.contains('toolbox-author-slot',)) { continue }

		const opener = creditBar.querySelector('mod-notes-opener',)
		if (opener) {
			const author = opener.getAttribute('user-name',)
			const subreddit = opener.getAttribute('subreddit-name',)
			if (!author || !subreddit) { continue }

			const thingId = opener.getAttribute('thing-id',) ?? ''
			const postId = opener.getAttribute('post-id',) ?? ''
			const postEl = creditBar.closest('shreddit-post',)
			if (!postEl) { continue }

			const isCompact = postEl.getAttribute('view-type',) === 'compactView'
			const needsThingContainer = !postEl.querySelector('.toolbox-thing-slot',)
			results.push({
				kind: 'mod-notes',
				creditBar,
				separator,
				author,
				subreddit,
				thingId,
				postId,
				postEl,
				isCompact,
				needsThingContainer,
			},)
		} else {
			const postEl = creditBar.closest('shreddit-post',)
			if (!postEl) { continue }

			const author = postEl.getAttribute('author',)
			const subreddit = stripSubredditPrefix(postEl.getAttribute('subreddit-prefixed-name',) ?? '',)
			const postId = postEl.getAttribute('id',) ?? ''
			if (!author || !subreddit) { continue }

			const needsThingContainer = !postEl.querySelector('.toolbox-thing-slot',)
			const hasNativeAuthor = !!creditBar.querySelector('[slot="authorName"]',)
			results.push({
				kind: 'feed-only',
				creditBar,
				separator,
				postEl,
				author,
				subreddit,
				postId,
				needsThingContainer,
				hasNativeAuthor,
			},)
		}
	}
	return results
}

/** Data extracted from a community-highlight-card element. */
export interface HighlightCardTarget {
	card: Element
	titleEl: Element | null
	labelSlot: HTMLElement
	author: string
	subreddit: string
	postId: string
	avatarSrc: string
}

/**
 * Find community-highlight-card elements that need a credit bar injected.
 * Skips cards that have already been processed (contain .toolbox-author-slot).
 * These appear on subreddit pages as pinned-post cards.
 */
export function findHighlightCardTargets (root: Element,): HighlightCardTarget[] {
	const cards: Element[] = root.matches('community-highlight-card[author-id]',) ? [root,] : []
	cards.push(...root.querySelectorAll('community-highlight-card[author-id]',),)

	const results: HighlightCardTarget[] = []
	for (const card of cards) {
		if (card.querySelector('.toolbox-author-slot',)) { continue }

		const labelSlot = card.querySelector(':scope > [slot="label"]',)
		if (!labelSlot) { continue }

		const authorImg = labelSlot.querySelector('img[alt]',)
		const author = authorImg?.getAttribute('alt',)
		if (!author) { continue }

		const subreddit = stripSubredditPrefix(card.getAttribute('subreddit-prefixed-name',) ?? '',)
		const postId = (card.getAttribute('id',) ?? '').replace('highlight_card_', '',)
		if (!subreddit || !postId) { continue }

		const avatarSrc = authorImg!.getAttribute('src',) ?? ''
		const titleEl = card.querySelector(':scope > [slot="title"]',)
		results.push({card, titleEl, labelSlot: labelSlot as HTMLElement, author, subreddit, postId, avatarSrc,},)
	}
	return results
}
