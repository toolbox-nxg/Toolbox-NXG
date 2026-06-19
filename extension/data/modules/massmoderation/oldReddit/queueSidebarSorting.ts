/** Adds a "sort by items" link to the old Reddit sidebar subscription box on mod queue pages. */

import {getCurrentUser,} from '../../../api/resources/me'
import {getSubredditListing,} from '../../../api/resources/subreddits'
import {
	getSubscriptionBox,
	getSubscriptionBoxItems,
	getSubscriptionBoxLinks,
	getSubscriptionBoxTitleHeaders,
} from '../../../dom/oldReddit/sidebar'
import {massModeration,} from '../../../framework/moduleIds'
import store from '../../../store'
import {neutralTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import {startSpinner, stopSpinner,} from '../../../store/spinnerSlice'
import {forEachChunked,} from '../../../util/data/iter'
import {getTime,} from '../../../util/data/time'
import createLogger from '../../../util/infra/logging'
import {getCache, setCache,} from '../../../util/persistence/cache'
import {isModFakereddit, isModQueuePage, isUnmoderatedPage, link,} from '../../../util/reddit/pageContext'

const log = createLogger(massModeration,)

/**
 * Injects "sort by items" links into the old Reddit sidebar subscription box and returns a click handler.
 * Only active on mod fakereddit pages (e.g. `/r/mod`).
 * @returns An object with `handleSortClick`, which is `null` if not on a sortable page.
 */
export function createSidebarSortHandlers () {
	if (!isModFakereddit) {
		return {handleSortClick: null as null | (() => void),}
	}

	// Intentional vanilla DOM: manipulates Reddit-owned sidebar structure.
	getSubscriptionBoxTitleHeaders().forEach((element,) => {
		element.insertAdjacentHTML('beforeend', '&nbsp;<a class="toolbox-sort-subs">sort by items</a>',)
	},)

	async function handleSortClick () {
		let prefix = ''
		let page = ''
		if (isUnmoderatedPage) {
			log.debug('sorting unmod',)
			prefix = 'umq-'
			page = 'unmoderated'
		} else if (isModQueuePage) {
			log.debug('sorting mod queue',)
			prefix = 'mq-'
			page = 'modqueue'
		} else {
			return
		}

		// Resolve once up front: cache keys below are per-user, and interpolating
		// the unresolved promise would bake "[object Promise]" into every key.
		const currentUser = await getCurrentUser()

		log.debug('sorting queue sidebar',)

		document.querySelectorAll('.toolbox-subreddit-item-count',).forEach((element,) => element.remove())

		const sortButton = document.querySelector<HTMLElement>('.toolbox-sort-subs',)
		if (sortButton) {
			sortButton.textContent = 'sorting...'
			sortButton.style.paddingLeft = '17px'
			sortButton.style.paddingRight = '16px'
		}

		const now = getTime()
		const modSubs: string[] = []

		store.dispatch(startSpinner(),)
		neutralTextFeedback('Getting subreddit items...',)

		forEachChunked(
			getSubscriptionBoxLinks(),
			20,
			100,
			(elem: Element,) => {
				const sr = elem.textContent ?? ''

				getCache(massModeration, `${prefix + currentUser}-${sr}`, '[0,0]',).then(
					(cacheData: unknown,) => {
						const data = JSON.parse(cacheData as string,)

						modSubs.push(sr,)
						positiveTextFeedback(`Getting items for: ${sr}`,)

						if (elem.parentElement) {
							const countA = document.createElement('a',)
							countA.href = link(`/r/${sr}/about/${page}`,)
							countA.setAttribute('count', String(data[0],),)
							countA.className = 'toolbox-subreddit-item-count'
							countA.textContent = String(data[0],)
							elem.parentElement.appendChild(countA,)
						}
						if (now > data[1]) {
							updateModqueueCount(sr,)
						}

						function updateModqueueCount (subName: string,) {
							getSubredditListing(subName, page, {limit: '100',},).then((d: any,) => {
								const items = d.data.children.length
								log.debug(`  subreddit: ${subName} items: ${items}`,)
								setCache(
									massModeration,
									`${prefix + currentUser}-${subName}`,
									`[${items},${new Date().valueOf()}]`,
								)
								;(getSubscriptionBox()?.querySelectorAll(
									`a[href$="/r/${subName}/about/${page}"]`,
								) ?? []).forEach((a: Element,) => {
									a.textContent = String(d.data.children.length,)
									a.setAttribute('count', String(d.data.children.length,),)
								},)
							},)
						}
					},
				)
			},
			() => {
				window.setTimeout(sortSubreddits, 2000,)
				store.dispatch(stopSpinner(),)
				neutralTextFeedback('Sorting sidebar...',)
				if (sortButton) {
					sortButton.textContent = 'sort by items'
					sortButton.style.paddingLeft = ''
					sortButton.style.paddingRight = ''
				}
			},
		)
	}

	return {handleSortClick,}
}

function sortSubreddits () {
	const subsEl = getSubscriptionBox()
	if (subsEl) {
		const subs = getSubscriptionBoxItems().sort((a, b,) => {
			// Primary: subscriber/queue count (last cell) descending.
			const countA = Number((a.lastChild as HTMLElement)?.textContent ?? 0,)
			const countB = Number((b.lastChild as HTMLElement)?.textContent ?? 0,)
			if (countB !== countA) { return countB - countA }
			// Tiebreak: subreddit name ascending. localeCompare yields a proper -1/0/1; the
			// old `+(a > b) || -1` form returned -1 for equal names (and never a negative from
			// the name branch), violating the comparator contract.
			const nameA = (a.firstChild as HTMLElement)?.nextSibling?.textContent?.toLowerCase() ?? ''
			const nameB = (b.firstChild as HTMLElement)?.nextSibling?.textContent?.toLowerCase() ?? ''
			return nameA.localeCompare(nameB,)
		},)
		subsEl.replaceChildren(...subs,)
	}
}
