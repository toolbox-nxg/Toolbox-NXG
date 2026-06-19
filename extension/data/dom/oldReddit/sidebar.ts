/**
 * Typed helpers for old Reddit's sidebar DOM elements.
 *
 * All functions return `null` (or an empty array) when expected markup is
 * absent rather than throwing, so callers can skip the enhancement gracefully.
 */

/** Returns the `.subscription-box` element, or `null`. */
export function getSubscriptionBox (): Element | null {
	return document.querySelector('.subscription-box',)
}

/** Returns `.sidecontentbox:has(.subscription-box) > .title` header elements. */
export function getSubscriptionBoxTitleHeaders (): Element[] {
	return Array.from(document.querySelectorAll('.sidecontentbox:has(.subscription-box) > .title',),)
}

/** Returns all `a.title` links within the subscription box. */
export function getSubscriptionBoxLinks (): Element[] {
	const box = getSubscriptionBox()
	return box ? Array.from(box.querySelectorAll('a.title',),) : []
}

/** Returns all `li` items within the subscription box. */
export function getSubscriptionBoxItems (): Element[] {
	const box = getSubscriptionBox()
	return box ? Array.from(box.querySelectorAll('li',),) : []
}
