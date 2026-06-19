/**
 * Typed helpers for page-level navigation and layout elements in old Reddit's DOM.
 *
 * All functions return `null` (or an empty array) when expected markup is
 * absent rather than throwing, so callers can skip the enhancement gracefully.
 */

/** Returns the `#siteTable` element, or `null`. */
export function getSiteTable (): Element | null {
	return document.querySelector('#siteTable',)
}

/** Returns the `p#noresults` element shown when a queue is empty, or `null`. */
export function getQueueEmptyMessage (): Element | null {
	return document.querySelector('p#noresults',)
}

/** Returns the `.tabmenu` navigation element, or `null`. */
export function getQueueTabMenu (): Element | null {
	return document.querySelector('.tabmenu',)
}

/** Returns the current subreddit name from the sidebar titlebox, or `null`. */
export function getCurrentSubredditName (): string | null {
	return document.querySelector('.side .titlebox h1.redditname a',)?.textContent?.trim() ?? null
}

/** Returns the page-level `.menuarea` element, or `null`. */
export function getMenuarea (): Element | null {
	return document.querySelector('.menuarea',)
}

/** Returns the `div.content` page container, or `null`. */
export function getContentContainer (): Element | null {
	return document.querySelector('div.content',)
}

/** Returns all things inside `div.content` not yet seen (missing `.toolbox-seen` class). */
export function getUnseenContentThings (): Element[] {
	return Array.from(document.querySelectorAll('div.content .thing:not(.toolbox-seen)',),)
}

/** Returns the `.content .menuarea` element, or `null`. */
export function getContentMenuarea (): Element | null {
	return document.querySelector('.content .menuarea',)
}

/** Returns all `.content > .nextprev` pagination elements. */
export function getContentNextPrevLinks (): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>('.content > .nextprev',),)
}

/**
 * Returns all `.sitetable.nestedlisting>.comment>.entry .buttons .toggle` elements
 * (distinguish toggles on top-level comments in a thread).
 */
export function getNestedCommentDistinguishToggles (): Element[] {
	return Array.from(
		document.querySelectorAll('.sitetable.nestedlisting>.comment>.entry .buttons .toggle',),
	)
}
