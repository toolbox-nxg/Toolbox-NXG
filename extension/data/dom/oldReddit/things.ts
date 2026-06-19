/**
 * Typed helpers for accessing individual `div.thing` elements and their
 * direct descendants in old Reddit's DOM.
 *
 * All functions return `null` (or an empty array) when expected markup is
 * absent rather than throwing, so callers can skip the enhancement gracefully.
 */

/** Returns all `div.thing` elements, optionally scoped to a container. */
export function getThings (container: Element | Document = document,): Element[] {
	return Array.from(container.querySelectorAll('div.thing',),)
}

/** Returns all `div.thing.link` elements, optionally scoped to a container. */
export function getLinkThings (container: Element | Document = document,): Element[] {
	return Array.from(container.querySelectorAll('div.thing.link',),)
}

/** Returns the first `div.thing` element whose `data-fullname` matches. */
export function getThingByFullname (fullname: string,): Element | null {
	return document.querySelector(`div.thing[data-fullname="${fullname}"]`,)
}

/** Returns the `data-fullname` attribute of a thing element. */
export function getThingFullname (thing: Element,): string | null {
	return thing.getAttribute('data-fullname',)
}

/** Returns the `data-subreddit` attribute of a thing element. */
export function getThingSubreddit (thing: Element,): string | null {
	return thing.getAttribute('data-subreddit',)
}

/**
 * Returns the parsed domain string from a thing's `span.domain a` href,
 * e.g. `"self.programming"` or `"/r/programming"`. Returns `null` when the
 * domain element or href is absent.
 */
export function getThingDomain (thing: Element,): string | null {
	const href = thing.querySelector('span.domain a',)?.getAttribute('href',)?.toLowerCase()
	if (!href) { return null }
	let match = /\/domain\/(.+)\//.exec(href,)
	if (!match) { match = /(\/r\/.+)\//.exec(href,) }
	return match ? match[1]! : null
}

/** Returns the `span.domain` element within a thing's entry, or `null`. */
export function getThingDomainEl (thing: Element,): Element | null {
	return getEntry(thing,)?.querySelector('span.domain',) ?? null
}

/** Returns the `.entry` element of a thing, or `null`. */
export function getEntry (thing: Element,): Element | null {
	return thing.querySelector('.entry',)
}

/** Returns the `.reported-stamp` element of a thing, or `null`. */
export function getReportedStamp (thing: Element,): Element | null {
	return thing.querySelector('.reported-stamp',)
}

/** Returns the nearest `.thing` ancestor of an element, or `null`. */
export function getThingFromDescendant (element: Element,): Element | null {
	return element.closest('.thing',)
}

/**
 * Returns the subreddit name from a thing's `a.subreddit` link text, without the `r/` prefix,
 * or `null` when the link is absent or empty.
 */
export function getThingSubredditName (thing: Element,): string | null {
	const text = thing.querySelector('a.subreddit',)?.textContent?.trim() ?? ''
	return text.replace(/^r\//, '',) || null
}

/**
 * Returns the text content of the `.flat-list li[title]` element inside a thing's entry,
 * which old Reddit uses to show the removal/spam action reason. Returns `null` when absent.
 */
export function getThingRemovedBy (thing: Element,): string | null {
	return thing.querySelector('.flat-list li[title]',)?.textContent?.trim() ?? null
}

/** Returns the `.big-mod-buttons` element within a thing's entry, or `null`. */
export function getThingBigModButtons (thing: Element,): Element | null {
	return thing.querySelector(':scope > .entry .big-mod-buttons',)
}

/** Returns the approve/positive button within a thing's entry button row, or `null`. */
export function getThingApproveButton (thing: Element,): Element | null {
	return thing.querySelector(':scope > .entry .buttons .positive',)
}

/** Returns the `input[value="removed"]` within a thing's entry, or `null`. */
export function getThingRemovedInput (thing: Element,): Element | null {
	return thing.querySelector(':scope > .entry input[value="removed"]',)
}

/** Returns the `a.bylink` (context permalink) anchor within a thing, or `null`. */
export function getThingBylinkAnchor (thing: Element,): HTMLAnchorElement | null {
	return thing.querySelector<HTMLAnchorElement>('a.bylink',)
}

/** Returns the nearest `div.link[data-fullname]` ancestor (parent submission), or `null`. */
export function getThingParentLinkThing (thing: Element,): HTMLElement | null {
	return thing.parentElement?.closest<HTMLElement>('div.link[data-fullname]',) ?? null
}

/** Returns the toolbox thing slot (`toolbox-thing-slot`) within a thing's entry, or `null`. */
export function getThingSlot (thing: Element,): Element | null {
	return thing.querySelector(':scope > .entry > .toolbox-thing-slot',)
}

/**
 * Creates (if absent) the `.toolbox-thing-slot` div (with a `span[data-name="toolbox"]` inside)
 * as a child of the thing's `.entry`. Returns the container, or `null` when no entry exists.
 */
export function ensureThingSlot (thing: Element,): Element | null {
	const existing = getThingSlot(thing,)
	if (existing) { return existing }
	const entry = getEntry(thing,)
	if (!entry) { return null }
	const div = document.createElement('div',)
	div.className = 'toolbox-thing-slot'
	const span = document.createElement('span',)
	span.dataset.name = 'toolbox'
	div.appendChild(span,)
	entry.appendChild(div,)
	return div
}

/** Returns the `.flat-list` button row within a thing, or `null`. */
export function getThingFlatListButtons (thing: Element,): Element | null {
	return thing.querySelector('.flat-list',)
}

/** Returns the `a.title` link anchor within a thing, or `null`. */
export function getThingTitleAnchor (thing: Element,): HTMLAnchorElement | null {
	return thing.querySelector<HTMLAnchorElement>('a.title',)
}

/** Returns all link things on a listing page (`.listing-page .content .thing.link`). */
export function getListingPageLinkThings (): Element[] {
	return Array.from(document.querySelectorAll('.listing-page .content .thing.link',),)
}

/** Returns all link things not yet marked with `marker`. */
export function getUncheckedLinkThings (marker: string,): Element[] {
	return Array.from(document.querySelectorAll(`.thing.link:not(.${CSS.escape(marker,)})`,),)
}

/** Returns all `div.comment` elements not yet marked with `marker`. */
export function getUncheckedComments (marker: string,): Element[] {
	return Array.from(document.querySelectorAll(`div.comment:not(.${CSS.escape(marker,)})`,),)
}

/** Returns the remove button anchor within a comment's button row, or `null`. */
export function getCommentRemoveButton (comment: Element,): Element | null {
	return comment.querySelector(':scope > .entry ul.buttons a[data-event-action="remove"]',)
}

// ========== Author / tagline helpers ==========

/**
 * Returns the `.author` link in a thing's entry, or - for deleted content - a span in the
 * first `.tagline` whose text includes `[deleted]`. Returns `null` when neither is found.
 */
export function getThingAuthorEl (thing: Element,): Element | null {
	const entry = getEntry(thing,)
	if (!entry) { return null }
	return entry.querySelector('.author',)
		?? Array.from(entry.querySelectorAll('.tagline:first-of-type span',),).find(
			(s,) => s.textContent?.includes('[deleted]',),
		)
		?? null
}

/**
 * Returns the `.toolbox-author-slot` span inserted by Toolbox after the author element,
 * or `null` when not yet created.
 */
export function getThingAuthorContainer (thing: Element,): Element | null {
	const entry = getEntry(thing,)
	return entry?.querySelector('.toolbox-author-slot',) ?? null
}

/**
 * Creates (if absent) the `.toolbox-author-slot` span after the author element.
 * Returns the container element, or `null` when no author element was found.
 */
export function ensureThingAuthorContainer (thing: Element,): Element | null {
	const existing = getThingAuthorContainer(thing,)
	if (existing) { return existing }
	const authorEl = getThingAuthorEl(thing,)
	if (!authorEl) { return null }
	const span = document.createElement('span',)
	span.className = 'toolbox-author-slot'
	authorEl.insertAdjacentElement('afterend', span,)
	return span
}

// ========== Idempotency helpers ==========

/** Marks a thing as seen with the given class marker (default `'toolbox-seen'`). */
export function markThingSeen (thing: Element, marker = 'toolbox-seen',): void {
	thing.classList.add(marker,)
}

// ========== Comment tree helpers ==========

/**
 * Returns the nearest `.thing` ancestor of a comment thing's own parent - i.e. the parent
 * comment in the thread tree. Returns `null` when the comment is at the root.
 */
export function getThingParentComment (thing: Element,): Element | null {
	return thing.parentElement?.closest('.thing',) ?? null
}

/**
 * Returns all direct child comment things within a container, excluding "load more" stubs.
 * Equivalent to the immediate children of a sitetable that are real comments.
 */
export function getThingDirectCommentChildren (container: Element,): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(':scope > .thing:not(.morechildren)',),)
}

/**
 * Returns the child sitetable element of a comment thing, used when recursively
 * processing children. Returns `null` when the comment has no children.
 */
export function getThingChildSitetable (thing: Element,): Element | null {
	return thing.querySelector(':scope > .child > .sitetable',)
}

/** Returns `true` when the comment thing is marked as controversial by Reddit. */
export function isThingControversial (thing: Element,): boolean {
	return /\bcontroversial\b/.test(thing.className,)
}

/**
 * Collapses a comment thing by adding the `.collapsed` class and updating the
 * expand button text to `[+]`.
 */
export function collapseCommentThing (thing: Element,): void {
	thing.classList.add('collapsed',)
	const expand = thing.querySelector(':scope > .entry .expand',)
	if (expand) { expand.textContent = '[+]' }
}

/**
 * Expands (uncollapses) a comment thing by removing the `.collapsed` class and
 * updating the expand button text to `[–]`.
 */
export function uncollapseCommentThing (thing: Element,): void {
	thing.classList.remove('collapsed',)
	const expand = thing.querySelector(':scope > .entry .expand',)
	if (expand) { expand.textContent = '[–]' }
}

/**
 * Reads the vote score from a comment thing's `.score.unvoted` element.
 * @returns The numeric score, or `null` if the element is absent or unparseable.
 */
export function getCommentThingScore (thing: Element,): number | null {
	const text = thing.querySelector('.score.unvoted',)?.textContent
	if (!text) { return null }
	const match = text.match(/^-?\d+/,)
	return match ? parseInt(match[0], 10,) : null
}

/**
 * Reads the child-comment count from a comment thing's `.numchildren` element.
 * @returns The child count, or `null` if the element is absent or unparseable.
 */
export function getCommentThingChildCount (thing: Element,): number | null {
	const text = thing.querySelector('.numchildren',)?.textContent
	if (!text) { return null }
	const match = text.match(/\d+/,)
	return match ? parseInt(match[0], 10,) : null
}

/**
 * Returns the native remove button (or its inner action link) for a thing.
 *
 * Prefers the `.remove-button` wrapper whose action is "remove" (as opposed to
 * the spam button, which shares the class); identified via the
 * `data-event-action` attribute or the hidden `spam`/`executed` form inputs.
 * On subreddit listing pages there is no `.remove-button` wrapper, so the
 * `<a data-event-action="remove">` link is returned directly.
 */
export function getNativeRemoveButton (thing: HTMLElement,): HTMLElement | null {
	const removeButtons = [...thing.querySelectorAll<HTMLElement>(':scope > .entry .remove-button',),]
	const byClass = removeButtons.find((button,) => {
		const action = button.querySelector<HTMLElement>('[data-event-action]',)?.dataset.eventAction?.toLowerCase()
		const spamInput = button.querySelector<HTMLInputElement>('input[name="spam"]',)
		const executedInput = button.querySelector<HTMLInputElement>('input[name="executed"]',)
		return action === 'remove'
			|| spamInput?.value.toLowerCase() === 'false'
			|| executedInput?.value.toLowerCase() === 'removed'
	},) ?? removeButtons[0]
	if (byClass) { return byClass }

	// On subreddit listing pages there is no .remove-button wrapper; fall back to the
	// <a data-event-action="remove"> link directly so its parent <li> can be replaced.
	return thing.querySelector<HTMLElement>(':scope > .entry [data-event-action="remove"]',)
}
