/** DOM helpers for the Shreddit mod queue page (/mod/<sub>/queue or /mod/queue). */

/** A single reason entry from the `mod-queue-reasons` JSON attribute on a queue item. */
export interface ModQueueReason {
	/** GraphQL typename (e.g. `'ReportReason'`, `'AutoModFilterReason'`). */
	__typename: string
	title: string
	description?: {markdown: string}
	/** HTML entity or URL string for the reason icon. */
	icon: string
	/** The user or bot that triggered this reason, if applicable. */
	actor?: {displayName: string; icon?: {url: string}}
}

/** Returns all `shreddit-post[view-context="ModQueue"]` elements within a container. */
export function getQueueItems (container: Element | Document = document,): Element[] {
	return Array.from(container.querySelectorAll('shreddit-post[view-context="ModQueue"]',),)
}

/** Returns the score of a queue item, defaulting to 1 when the attribute is absent or non-numeric. */
export function getQueueItemScore (item: Element,): number {
	const raw = item.getAttribute('score',) ?? ''
	return /\d+/.test(raw,) ? parseInt(raw, 10,) : 1
}

/** Returns the bare subreddit name from a queue item (the `subreddit-name` attribute). */
export function getQueueItemSubreddit (item: Element,): string {
	return item.getAttribute('subreddit-name',) ?? ''
}

/** Returns the permalink of a queue item. */
export function getQueueItemPermalink (item: Element,): string {
	return item.getAttribute('permalink',) ?? ''
}

/**
 * Parses the `mod-queue-reasons` JSON from the `modqueue-smart-truncate-text` inside a queue
 * item. Returns an empty array when the element or attribute is missing or the JSON is invalid.
 */
export function getQueueItemReasons (item: Element,): ModQueueReason[] {
	const el = item.querySelector('modqueue-smart-truncate-text[mod-queue-reasons]',)
	if (!el) { return [] }
	try {
		return JSON.parse(el.getAttribute('mod-queue-reasons',) ?? '[]',) as ModQueueReason[]
	} catch {
		return []
	}
}

/** Returns the `div[slot="text-body"]` light-DOM element within a queue item, or `null`. */
export function getQueueItemTextBodyEl (item: Element,): Element | null {
	return item.querySelector('div[slot="text-body"]',)
}
