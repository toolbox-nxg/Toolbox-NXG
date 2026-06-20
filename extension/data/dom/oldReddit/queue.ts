/**
 * Typed helpers for queue and moderation page elements in old Reddit's DOM.
 *
 * All functions return `null` (or an empty array) when expected markup is
 * absent rather than throwing, so callers can skip the enhancement gracefully.
 */

/** Returns all `.sitetable .thing` elements, optionally scoped to a container. */
export function getSiteTableThings (container: Element | Document = document,): Element[] {
	return Array.from(container.querySelectorAll('.sitetable .thing',),)
}

/** Returns the `input[type=checkbox]` within a thing, or `null`. */
export function getThingCheckbox (thing: Element,): HTMLInputElement | null {
	return thing.querySelector<HTMLInputElement>('input[type=checkbox]',)
}

/** Returns all `input[type=checkbox]` inputs within `.thing` elements on the page. */
export function getAllThingCheckboxes (): HTMLInputElement[] {
	return Array.from(document.querySelectorAll<HTMLInputElement>('.thing input[type=checkbox]',),)
}

/** Returns the first non-edited `time` element in a thing's tagline, or `null`. */
export function getThingTimestampEl (thing: Element,): Element | null {
	return thing.querySelector('.tagline time:not(.edited-timestamp):first-of-type',)
}

/** Returns the `time.edited-timestamp` element in a thing's tagline, or `null`. */
export function getThingEditedTimestampEl (thing: Element,): Element | null {
	return thing.querySelector('time.edited-timestamp:first-of-type',)
}

/** Returns the `li[title^="removed at"]` element within a thing, or `null`. */
export function getThingRemovedAtEl (thing: Element,): Element | null {
	return thing.querySelector('li[title^="removed at"]',)
}

/**
 * Returns the first `.score` element within a thing whose computed `display` is not `'none'`.
 * Requires a live document with layout; cannot be unit-tested with jsdom.
 */
export function getThingVisibleScoreEl (thing: Element,): Element | null {
	return Array.from(thing.querySelectorAll('.score',),).find(
		(element,) => getComputedStyle(element,).display !== 'none',
	) ?? null
}

/**
 * Returns the score element that matches the current vote state
 * (`.score.likes`, `.score.unvoted`, or `.score.dislikes`) within a thing, or `null`.
 */
export function getThingScoreTextEl (thing: Element,): Element | null {
	return thing.querySelector('.likes .score.likes, .unvoted .score.unvoted, .dislikes .score.dislikes',)
}

/** Returns the `.flat-list.buttons .first a` context-link within a thing, or `null`. */
export function getThingFlatListContextLink (thing: Element,): Element | null {
	return thing.querySelector('.flat-list.buttons .first a',)
}

/** Returns `.thing.spam` elements, optionally scoped to a container. */
export function getSpamThings (container: Element | Document = document,): Element[] {
	return Array.from(container.querySelectorAll('.thing.spam',),)
}

/** Returns `.report-reasons .mod-report` elements, optionally scoped to a container. */
export function getModReports (container: Element | Document = document,): Element[] {
	return Array.from(container.querySelectorAll('.report-reasons .mod-report',),)
}

/** Returns `.report-reasons .user-report` elements (free-text user reports), optionally scoped to a container. */
export function getUserReports (container: Element | Document = document,): Element[] {
	return Array.from(container.querySelectorAll('.report-reasons .user-report',),)
}

/** Returns all `.entry .collapsed a.expand` expand buttons on the page. */
export function getCollapsedExpandButtons (): Element[] {
	return Array.from(document.querySelectorAll('.entry .collapsed a.expand',),)
}

/**
 * Returns `true` if a thing is a promoted post, detected by `.parent` text ending with
 * `[promoted post]`.
 */
export function isThingPromotedPost (thing: Element,): boolean {
	return thing.querySelector('.parent',)?.textContent?.endsWith('[promoted post]',) ?? false
}

/** Returns the `.subreddit` link element within a thing, or `null`. */
export function getThingSubredditEl (thing: Element,): Element | null {
	return thing.querySelector('.subreddit',)
}

/** Returns `#siteTable_promoted`, `#siteTable_organic`, and `.rank` elements for removal. */
export function getPromotedAndRankEls (): Element[] {
	return Array.from(document.querySelectorAll('#siteTable_promoted,#siteTable_organic,.rank',),)
}

/** Returns all `.md` (markdown) elements within a thing. */
export function getThingMarkdownEls (thing: Element,): Element[] {
	return Array.from(thing.querySelectorAll('.md',),)
}

/** Returns all `a.title` link elements within a thing. */
export function getThingTitleLinks (thing: Element,): Element[] {
	return Array.from(thing.querySelectorAll('a.title',),)
}
