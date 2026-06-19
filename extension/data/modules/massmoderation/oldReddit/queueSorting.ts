/** DOM utilities for sorting and grouping old Reddit queue items. */

import {getSiteTable,} from '../../../dom/oldReddit/page'
import {
	getSiteTableThings,
	getThingEditedTimestampEl,
	getThingFlatListContextLink,
	getThingRemovedAtEl,
	getThingSubredditEl,
	getThingTimestampEl,
	getThingVisibleScoreEl,
} from '../../../dom/oldReddit/queue'
import {getReportedStamp, getThingFullname, getThings,} from '../../../dom/oldReddit/things'
import {isModpage,} from '../../../util/reddit/pageContext'

const numberRX = /-?\d+/

/** Class on the wrapper that pins auto-refresh "new items" to the bottom of the queue. */
const newItemsGroupClass = 'toolbox-new-items-group'

/** Returns the queue's "New Items" section wrapper if one exists, else null. */
function getNewItemsSection (sitetable: Element,): Element | null {
	return sitetable.querySelector(`:scope > .${newItemsGroupClass}`,)
}

/**
 * Appends auto-refresh `things` to a "New Items" section pinned at the very bottom of the queue,
 * creating the section (with its header) on first use. The section is kept as the site table's last
 * child so it stays at the bottom even when subreddit grouping is active; items remain here until the
 * user triggers a resort (see {@link dissolveNewItemsSection}).
 * @param sitetable The queue site table.
 * @param things Newly fetched `.thing` elements to pin at the bottom.
 */
export function appendNewItems (sitetable: Element, things: Element[],): void {
	let group = getNewItemsSection(sitetable,)
	if (!group) {
		group = document.createElement('div',)
		group.className = newItemsGroupClass
		const header = document.createElement('div',)
		header.className = 'toolbox-new-items-header'
		header.textContent = 'New Items'
		group.appendChild(header,)
	}
	things.forEach((thing,) => group!.appendChild(thing,))
	// Re-append so the section is always the last child, below any subreddit groups.
	sitetable.appendChild(group,)
}

/**
 * Dissolves the "New Items" section, moving its items back into the main queue flow and removing the
 * wrapper and header. Called when the user triggers a resort so new items merge into sorted order.
 * @param sitetable The queue site table.
 */
function dissolveNewItemsSection (sitetable: Element,): void {
	const group = getNewItemsSection(sitetable,)
	if (!group) { return }
	group.querySelectorAll(':scope > .thing',).forEach((thing,) => sitetable.appendChild(thing,))
	group.remove()
}

function unwrapCommentGroups (sitetable: Element,): void {
	sitetable.querySelectorAll('.toolbox-comment-group',).forEach((group,) => {
		group.querySelectorAll(':scope > .thing',).forEach((thing,) => {
			sitetable.appendChild(thing,)
		},)
		group.remove()
	},)
}

/**
 * Groups mod-queue comments under their parent submission using wrapper divs.
 * Intentional vanilla DOM: reorders Reddit's .thing nodes; React cannot own nodes it didn't render.
 */
export function groupThings (): void {
	const threadGroups: Record<string, Element[]> = {}
	const threadIDs: string[] = []

	document.querySelectorAll('.sitetable .toolbox-comment-group',).forEach((element,) => element.remove())

	getSiteTableThings().forEach((thing,) => {
		let threadID: string | undefined
		if (thing.classList.contains('comment',)) {
			const match = getThingFlatListContextLink(thing,)
				?.getAttribute('href',)
				?.match(/\/comments\/([a-z0-9]+)\//,)
			threadID = match?.[1]
		} else {
			threadID = getThingFullname(thing,)?.replace('t3_', '',)
		}
		if (!threadID) { return }
		if (threadIDs.indexOf(threadID,) < 0) {
			threadIDs.push(threadID,)
		}
		if (!threadGroups[threadID]) {
			threadGroups[threadID] = []
		}
		threadGroups[threadID]!.push(thing,)
	},)

	const siteTable = getSiteTable()
	threadIDs.forEach((id,) => {
		const group = threadGroups[id]!
		// Only wrap if the group contains at least one comment - a post with no associated comments
		// in the queue doesn't need a group wrapper and would just produce single-item noise.
		const hasComment = group.some((item,) => item.classList.contains('comment',))
		if (!hasComment) {
			group.forEach((item,) => siteTable?.appendChild(item,))
			return
		}
		const wrapper = document.createElement('div',)
		wrapper.className = 'toolbox-comment-group'
		wrapper.setAttribute('data-id', id,)
		siteTable?.appendChild(wrapper,)
		group.forEach((item,) => {
			wrapper.appendChild(item,)
		},)
		wrapper.insertAdjacentHTML('beforeend', '<hr />',)
	},)
}

/**
 * Compares two things by a timestamp pulled from each via `extract`, returning a
 * `sort`-compatible millisecond difference. A nullish or unparseable extraction parses
 * to an invalid `Date` (`NaN`), mirroring the original per-case behaviour.
 * @param firstThing The thing sorted earlier when ascending.
 * @param secondThing The thing sorted later when ascending.
 * @param extract Reads the date string (e.g. a `datetime`/`title` attribute) for a thing.
 */
function compareByTime (
	firstThing: Element,
	secondThing: Element,
	extract: (thing: Element,) => string | null | undefined,
): number {
	const timeA = new Date(extract(firstThing,) ?? '',).getTime()
	const timeB = new Date(extract(secondThing,) ?? '',).getTime()
	return timeA - timeB
}

/**
 * Sorts the queue items in the site table by the given field and direction.
 * Intentional vanilla DOM: reorders existing Reddit `.thing` nodes; React cannot own nodes it didn't render.
 * @param order The sort field: `'age'`, `'edited'`, `'removed'`, `'score'`, or `'reports'`.
 * @param asc Whether to sort ascending (`true`) or descending (`false`).
 * @param groupCommentsOnModPage Whether to group comments by submission after sorting (mod pages only).
 */
export function sortThings (order: string, asc: boolean, groupCommentsOnModPage: boolean,): void {
	const sitetable = getSiteTable()
	if (!sitetable) { return }
	// A resort is the one action that merges auto-refresh "new items" back into the queue, so flatten
	// the section before collecting things to sort.
	dissolveNewItemsSection(sitetable,)
	const sorted = Array.from(getThings(sitetable,),).sort((a, b,) => {
		let firstThing: Element
		let secondThing: Element
		if (asc) {
			firstThing = a
			secondThing = b
		} else {
			firstThing = b
			secondThing = a
		}

		switch (order) {
			case 'age':
			default:
				return compareByTime(
					firstThing,
					secondThing,
					(thing,) => getThingTimestampEl(thing,)?.getAttribute('datetime',),
				)
			case 'edited':
				return compareByTime(
					firstThing,
					secondThing,
					(thing,) =>
						(getThingEditedTimestampEl(thing,) ?? getThingTimestampEl(thing,))?.getAttribute('datetime',),
				)
			case 'removed':
				return compareByTime(firstThing, secondThing, (thing,) => {
					// Old Reddit shows the removal time either as a <time datetime> element or, when
					// only a tooltip is available, as a "removed at ..." title attribute.
					const removeElement = getThingRemovedAtEl(thing,) ?? getThingTimestampEl(thing,)
					if (removeElement?.matches('time',)) {
						return removeElement.getAttribute('datetime',)
					}
					return removeElement?.getAttribute('title',)?.replace('removed at ', '',)
				},)
			case 'score': {
				const scoreA = getThingVisibleScoreEl(firstThing,)?.getAttribute('title',)
				const scoreB = getThingVisibleScoreEl(secondThing,)?.getAttribute('title',)
				return Number(scoreA ?? 0,) - Number(scoreB ?? 0,)
			}
			case 'reports': {
				const reportsA = getReportedStamp(firstThing,)?.textContent?.match(numberRX,)
				const reportsB = getReportedStamp(secondThing,)?.textContent?.match(numberRX,)
				return Number(reportsA?.[0] ?? 0,) - Number(reportsB?.[0] ?? 0,)
			}
			case 'author': {
				const authorA = firstThing.querySelector('.author',)?.textContent?.trim() ?? ''
				const authorB = secondThing.querySelector('.author',)?.textContent?.trim() ?? ''
				return authorA.localeCompare(authorB,)
			}
		}
	},)
	getThings(sitetable,).forEach((element,) => element.remove())
	sitetable.prepend(...sorted,)

	if (isModpage && groupCommentsOnModPage) {
		groupThings()
	}
}

/**
 * Groups queue items in the site table by subreddit, wrapping each subreddit's items
 * in a labelled `.toolbox-sub-group` container. Call again to re-group after sorting.
 * Intentional vanilla DOM: wraps and reorders existing Reddit `.thing` nodes; React cannot own nodes it didn't render.
 * @param sitetable The site table element to group within.
 */
export function groupBySubreddit (sitetable: Element,): void {
	unwrapCommentGroups(sitetable,)

	sitetable.querySelectorAll('.toolbox-sub-group',).forEach((el,) => {
		Array.from(el.children,).forEach((child,) => {
			if (!child.classList.contains('toolbox-sub-group-header',)) {
				sitetable.appendChild(child,)
			}
		},)
		el.remove()
	},)

	const subGroups: Record<string, Element[]> = {}
	const subOrder: string[] = []

	// Exclude items in the "New Items" section: they stay pinned at the bottom regardless of grouping
	// until the user triggers a resort.
	getSiteTableThings(sitetable,)
		.filter((thing,) => !thing.closest(`.${newItemsGroupClass}`,))
		.forEach((thing,) => {
			const subreddit = getThingSubredditEl(thing,)?.textContent?.trim() ?? ''
			if (!subOrder.includes(subreddit,)) { subOrder.push(subreddit,) }
			if (!subGroups[subreddit]) { subGroups[subreddit] = [] }
			subGroups[subreddit]!.push(thing,)
		},)

	subOrder.forEach((subreddit,) => {
		const wrapper = document.createElement('div',)
		wrapper.className = 'toolbox-sub-group'
		wrapper.setAttribute('data-sub', subreddit,)

		const header = document.createElement('div',)
		header.className = 'toolbox-sub-group-header'
		header.textContent = subreddit
		wrapper.appendChild(header,)

		subGroups[subreddit]!.forEach((item,) => wrapper.appendChild(item,))
		sitetable.appendChild(wrapper,)
	},)

	// Keep the "New Items" section below the freshly built subreddit groups.
	const newItems = getNewItemsSection(sitetable,)
	if (newItems) { sitetable.appendChild(newItems,) }
}

/**
 * Ungroups items previously grouped by {@link groupBySubreddit}, restoring them
 * as direct children of the site table.
 * @param sitetable The site table element to ungroup within.
 */
export function ungroupBySubreddit (sitetable: Element,): void {
	sitetable.querySelectorAll('.toolbox-sub-group',).forEach((group,) => {
		Array.from(group.children,).forEach((child,) => {
			if (!child.classList.contains('toolbox-sub-group-header',)) {
				sitetable.appendChild(child,)
			}
		},)
		group.remove()
	},)
	// Restoring grouped items appends them to the end, so re-pin the "New Items" section last.
	const newItems = getNewItemsSection(sitetable,)
	if (newItems) { sitetable.appendChild(newItems,) }
}
