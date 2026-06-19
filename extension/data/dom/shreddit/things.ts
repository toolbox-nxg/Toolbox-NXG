/**
 * Typed helpers for Shreddit custom elements and shared utilities used across
 * the other shreddit redditDom modules.
 */

/**
 * Returns the nearest shreddit-comment, shreddit-post, or mod-queue-list-item ancestor of an
 * element, or `null`. Equivalent to `oldReddit.getThingFromDescendant` for Shreddit's
 * custom-element DOM.
 */
export function getThingFromDescendant (element: Element,): Element | null {
	return element.closest('shreddit-comment',)
		?? element.closest('shreddit-post',)
		?? element.closest('mod-queue-list-item',)
}

/**
 * Collects `root` itself (when it matches) plus all matching descendants.
 * The standard enumeration idiom for processing MutationObserver `addedNodes`,
 * where the added node may itself be the element of interest or contain them.
 */
export function collectMatches (root: Element | Document, selector: string,): Element[] {
	const matches: Element[] = root instanceof Element && root.matches(selector,) ? [root,] : []
	matches.push(...root.querySelectorAll(selector,),)
	return matches
}

/** Identifying context extracted from a shreddit thing element. */
export interface ThingContext {
	/** Thing fullname (e.g. `t3_abc123` or `t1_abc123`). */
	thingId: string
	/** Bare subreddit name without the `r/` prefix. */
	subreddit: string
	isComment: boolean
}

/**
 * Extracts the fullname, subreddit, and kind from a shreddit thing element
 * (`shreddit-comment`, `shreddit-post`, or `mod-queue-list-item`).
 * Returns `null` when either identifying attribute is missing.
 */
export function getThingContext (thing: Element,): ThingContext | null {
	if (thing.tagName.toLowerCase() === 'shreddit-comment') {
		const thingId = thing.getAttribute('thingid',) ?? ''
		const subreddit = subredditFromPermalink(thing.getAttribute('permalink',) ?? '',)
		if (!thingId || !subreddit) { return null }
		return {thingId, subreddit, isComment: true,}
	}

	// shreddit-post or mod-queue-list-item
	const thingId = thing.getAttribute('id',) ?? ''
	const subreddit = stripSubredditPrefix(thing.getAttribute('subreddit-prefixed-name',) ?? '',)
		|| (thing.getAttribute('subreddit-name',) ?? '')
	if (!thingId || !subreddit) { return null }
	return {thingId, subreddit, isComment: thingId.startsWith('t1_',),}
}

/**
 * Returns the native shreddit remove button inside a thing element, trying the
 * mod-action custom element first and falling back to the test-id/item-id
 * buttons used by other shreddit surfaces (including the overflow menu's
 * shadow DOM). Returns `null` when the thing has no native remove control.
 */
export function getNativeRemoveButton (thing: Element,): Element | null {
	return thing.querySelector('mod-action-button[data-mod-action="mod-remove-content"]',)
		?? thing.querySelector('button[data-testid="remove"]',)
		?? thing.querySelector('button[data-item-id="remove"]',)
		?? thing.querySelector('unpacking-overflow-menu',)?.shadowRoot?.querySelector('button[data-item-id="remove"]',)
		?? null
}

/**
 * Returns the native shreddit approve button inside a thing element, mirroring
 * {@link getNativeRemoveButton}: the `mod-action-button` custom element first, then the
 * test-id/item-id button fallbacks used by other shreddit surfaces. Used to relocate the
 * native approve control into the Toolbox flat-list action group so it sits alongside the
 * Toolbox remove button. Returns `null` when the thing has no native approve control
 * (e.g. an item that hasn't been removed/reported, where Reddit shows no approve).
 */
export function getNativeApproveButton (thing: Element,): Element | null {
	return thing.querySelector('mod-action-button[data-mod-action="mod-approve-content"]',)
		?? thing.querySelector('button[data-testid="approve"]',)
		?? thing.querySelector('button[data-item-id="approve"]',)
		?? null
}

/**
 * Removes the `should-include-mod-actions` boolean attribute from a thing's lazy overflow
 * (...) menu so Reddit renders that menu WITHOUT the native mod actions (approve / remove /
 * remove-as-spam / lock / distinguish / ...), while keeping the non-mod entries (share, save,
 * award, ...). Toolbox surfaces those mod actions inline in the flat-list row instead, so the
 * native copies would only duplicate them.
 *
 * The overflow menu is lazy-loaded (`shreddit-async-loader` -> `unpacking-overflow-menu`), so it
 * may not exist yet when a feed item first mounts. The shared mutation pass re-processes added
 * nodes, so a freshly-inserted menu gets stripped on a later call; the menu carries the attribute
 * from the moment it is inserted (verified in captured feed HTML), so stripping it before the user
 * opens the menu keeps the mod actions from ever rendering. Safe to call repeatedly.
 *
 * @param thing A `shreddit-post`, `shreddit-comment`, or `shreddit-comment-action-row` element.
 * @returns A cleanup that restores the attribute on every menu it stripped.
 */
export function suppressNativeOverflowModActions (thing: Element,): () => void {
	const stripped: Element[] = []
	for (const menu of thing.querySelectorAll('unpacking-overflow-menu[should-include-mod-actions]',)) {
		menu.removeAttribute('should-include-mod-actions',)
		stripped.push(menu,)
	}
	return () => {
		for (const menu of stripped) {
			menu.setAttribute('should-include-mod-actions', '',)
		}
	}
}

/**
 * Returns all `div.thing` elements within a container.
 * Used for content rendered via old-Reddit-style helpers (e.g. profile overlay, history views).
 */
export function getThings (container: Element | Document = document,): Element[] {
	return Array.from(container.querySelectorAll('div.thing',),)
}

/**
 * Returns the `data-subreddit` attribute of a thing element rendered via old-Reddit-style helpers.
 */
export function getThingSubreddit (thing: Element,): string | null {
	return thing.getAttribute('data-subreddit',)
}

/**
 * Returns true when a shreddit thing element has been removed.
 * Checks the legacy `removed` attribute, `item-state="REMOVED"`, and
 * `moderation-verdict="MOD_REMOVED"`.
 */
export function isThingRemoved (el: Element,): boolean {
	return el.hasAttribute('removed',)
		|| el.getAttribute('item-state',) === 'REMOVED'
		|| el.getAttribute('moderation-verdict',) === 'MOD_REMOVED'
}

/**
 * Extracts the subreddit name from a Reddit permalink such as `/r/subreddit/comments/...`.
 * Returns an empty string when the permalink is absent or malformed.
 */
export function subredditFromPermalink (permalink: string,): string {
	return permalink.match(/^\/r\/([^/]+)/,)?.[1] ?? ''
}

/**
 * Strips the `r/` prefix from a `subreddit-prefixed-name` attribute value.
 * Returns the bare subreddit name, or an empty string when the input is absent.
 */
export function stripSubredditPrefix (prefixed: string,): string {
	return prefixed.replace(/^r\//, '',)
}

/**
 * Returns the element a thing's `toolbox-flat-list-slot` should be appended to so the Toolbox
 * mod-action row renders on its own line below the post/comment rather than crammed into Reddit's
 * width-constrained native action bar: the thing's existing `toolbox-thing-slot` container when one
 * is present (keeping Toolbox's thing-level UI grouped), otherwise the thing element itself. Both
 * render in the thing's default-slot area, the same place the proven-clickable domain-tag button
 * already sits.
 */
export function flatListThingContainer (thing: Element,): Element {
	return thing.querySelector(':scope > .toolbox-thing-slot',) ?? thing
}

/**
 * Returns true when a thing already has a `toolbox-flat-list-slot` injected - either appended
 * straight to the thing or nested in its `toolbox-thing-slot`. Both checks use `:scope >` so a
 * parent comment is not considered "done" merely because a nested reply has its own slot.
 */
function hasFlatListSlot (thing: Element,): boolean {
	return thing.querySelector(':scope > .toolbox-flat-list-slot',) !== null
		|| thing.querySelector(':scope > .toolbox-thing-slot > .toolbox-flat-list-slot',) !== null
}

/** Data extracted from a `shreddit-post` that needs a `thingFlatListActions` slot. */
export interface PostFlatListTarget {
	/** The `shreddit-post` element to append the slot to (via {@link flatListThingContainer}). */
	post: Element
	/** Post fullname (e.g. `t3_abc123`). */
	thingId: string
	subreddit: string
	isRemoved: boolean
}

/** Data extracted from a `shreddit-comment` that needs a `thingFlatListActions` slot. */
export interface CommentFlatListTarget {
	/**
	 * The `shreddit-comment-action-row` to insert the slot immediately before. Comments nest
	 * (a reply is a descendant `shreddit-comment` of its parent), so appending to the end of the
	 * `shreddit-comment` would place the row below the entire reply tree. Inserting right before the
	 * action row keeps it above *this* comment's action bar, ahead of any nested replies.
	 */
	actionRow: Element
	/** The enclosing `shreddit-comment` (used to suppress its native overflow mod actions). */
	comment: Element
	/** Comment fullname (e.g. `t1_abc123`). */
	thingId: string
	/** Post fullname (e.g. `t3_abc123`). */
	postId: string
	subreddit: string
	isRemoved: boolean
}

/**
 * Finds `shreddit-post` elements that need a `thingFlatListActions` slot injected.
 * Returns one result per post that exposes a `<mod-content-actions slot="mod-content-actions">`
 * child (Reddit's signal that the post is mod-actionable) and does not already have a
 * `toolbox-flat-list-slot`.
 */
export function findPostFlatListTargets (root: Element,): PostFlatListTarget[] {
	const results: PostFlatListTarget[] = []
	for (const post of collectMatches(root, 'shreddit-post',)) {
		if (!post.querySelector(':scope > mod-content-actions[slot="mod-content-actions"]',)) { continue }
		if (hasFlatListSlot(post,)) { continue }

		const thingId = post.getAttribute('id',)
		const subreddit = post.getAttribute('subreddit-name',)
		if (!thingId || !subreddit) { continue }

		results.push({post, thingId, subreddit, isRemoved: isThingRemoved(post,),},)
	}
	return results
}

/**
 * Finds `shreddit-comment-action-row` elements that need a `thingFlatListActions` slot injected.
 * Returns one result per action row that exposes a `<mod-content-actions slot="mod-content-actions">`
 * child and does not already have a `toolbox-flat-list-slot` injected immediately after it.
 */
export function findCommentFlatListTargets (root: Element,): CommentFlatListTarget[] {
	const results: CommentFlatListTarget[] = []
	for (const actionRow of collectMatches(root, 'shreddit-comment-action-row',)) {
		if (!actionRow.querySelector(':scope > mod-content-actions[slot="mod-content-actions"]',)) { continue }
		// The slot is inserted as a sibling right before the action row, so dedup against the action
		// row's own parent (not the whole comment - that would also match a nested reply's slot).
		if (actionRow.parentElement?.querySelector(':scope > .toolbox-flat-list-slot',)) { continue }

		const thingId = actionRow.getAttribute('comment-id',)
		if (!thingId) { continue }

		// shreddit-comment-action-row is a light-DOM child (slot="actionRow") of shreddit-comment
		const commentEl = actionRow.closest('shreddit-comment',)
		if (!commentEl) { continue }
		const postId = commentEl.getAttribute('postid',) ?? ''
		const subreddit = subredditFromPermalink(commentEl.getAttribute('permalink',) ?? '',)
		if (!postId || !subreddit) { continue }

		results.push({
			actionRow,
			comment: commentEl,
			thingId,
			postId,
			subreddit,
			isRemoved: isThingRemoved(commentEl,),
		},)
	}
	return results
}

/**
 * Returns the domain of a `shreddit-post` element, in the same format used by old Reddit's
 * domain tagger: `"imgur.com"` for link posts, `"self.subredditname"` for self posts.
 *
 * Reads `content-href` - for link posts this is the external URL; for self posts it is the
 * reddit.com permalink, which we detect by hostname to return the `self.X` form.
 *
 * A leading `www.` is stripped from link domains so the result matches old Reddit's display
 * domain (e.g. `nytimes.com`, not `www.nytimes.com`). Keeping the two platforms in the same
 * format means a tag created on one matches on the other, and approval/removal stats are
 * tallied against a single domain key rather than split across `www`/non-`www` variants.
 *
 * Returns `null` when the subreddit name is unavailable.
 */
export function getShredditPostDomain (postEl: Element,): string | null {
	const subreddit = postEl.getAttribute('subreddit-name',) ?? ''
	const href = postEl.getAttribute('content-href',) ?? ''
	if (!href) {
		return subreddit ? `self.${subreddit}` : null
	}
	try {
		const url = new URL(href,)
		if (
			url.hostname === 'www.reddit.com'
			|| url.hostname === 'reddit.com'
			|| url.hostname === 'old.reddit.com'
		) {
			return subreddit ? `self.${subreddit}` : null
		}
		return url.hostname.toLowerCase().replace(/^www\./, '',)
	} catch {
		return subreddit ? `self.${subreddit}` : null
	}
}
