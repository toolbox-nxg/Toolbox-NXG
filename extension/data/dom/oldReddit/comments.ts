/**
 * Typed helpers for comment-page elements in old Reddit's DOM.
 *
 * All functions return `null` (or an empty array) when expected markup is
 * absent rather than throwing, so callers can skip the enhancement gracefully.
 */

/** Returns the comment-visits dropdown (`#comment-visits`), or `null`. */
export function getCommentVisits (): HTMLSelectElement | null {
	return document.getElementById('comment-visits',) as HTMLSelectElement | null
}

/** Returns the `.comment-visits-box` element, or `null`. */
export function getCommentVisitsBox (): HTMLElement | null {
	return document.querySelector<HTMLElement>('.comment-visits-box',)
}

/** Returns the title element within `.comment-visits-box`, or `null`. */
export function getCommentVisitsTitle (): Element | null {
	return document.querySelector('.comment-visits-box .title',)
}

/** Returns all comment things that are not new (old comments, excluding link things). */
export function getOldCommentThings (): Element[] {
	return Array.from(document.querySelectorAll('.thing:not(.new-comment):not(.link)',),)
}

/** Returns all moderator-flagged elements (distinguished comments and spam-tagged items). */
export function getModeratorActionElements (): Element[] {
	return Array.from(document.querySelectorAll('.moderator, [data-subreddit="spam"]',),)
}

/** Returns all spam comment entries on the comments page. */
export function getSpammedCommentEntries (): Element[] {
	return Array.from(document.querySelectorAll('.comments-page .thing.comment.spam > .entry',),)
}

/**
 * Returns all comment things not yet marked with the given idempotency marker class.
 * Defaults to `'toolbox-comments-checked'`.
 */
export function getUncheckedCommentThings (marker = 'toolbox-comments-checked',): Element[] {
	return Array.from(document.querySelectorAll(`.thing.comment:not(.${CSS.escape(marker,)})`,),)
}

/** Returns all `.action-reason` elements on the page. */
export function getActionReasonElements (): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>('.action-reason',),)
}

/**
 * Returns the root comment sitetable for the current page.
 * On listing pages returns `.content > .sitetable`; on comment pages returns
 * `.commentarea > .sitetable`. Returns `null` when neither is found.
 */
export function getCommentPageRootSitetable (): Element | null {
	if (document.body.classList.contains('listing-page',)) {
		return document.querySelector('.content > .sitetable',)
	}
	return document.querySelector('.commentarea > .sitetable',)
}
