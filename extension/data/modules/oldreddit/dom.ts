/**
 * DOM crawling and event-dispatch logic for the Old Reddit module.
 *
 * This file IS the platform provider layer for the uiLocations slot system on Old Reddit.
 * Each host element creation followed by a `provideLocation()` call here is the intended pattern -
 * these are not missed migrations. Other modules register renderers via `renderAtLocation()` and
 * rely on these providers being present.
 */

import {getContentContainer, getUnseenContentThings,} from '../../dom/oldReddit/page'
import {
	ensureThingAuthorContainer,
	ensureThingSlot,
	getThingBylinkAnchor,
	getThingDomainEl,
	getThingFlatListButtons,
	getThingParentLinkThing,
	getThingSlot,
	markThingSeen,
} from '../../dom/oldReddit/things'
import {provideLocation,} from '../../dom/uiLocations'
import createLogger from '../../util/infra/logging'
import {RedditPlatform,} from '../../util/infra/platform'
import {postSite,} from '../../util/reddit/pageContext'
import {type OldRedditSettings,} from './settings'

const userListPageRe = /\/about\/(?:banned|moderators|contributors|muted)\/?/
const isUserListPage = userListPageRe.test(location.pathname,)
const UNSEEN_USER_LINK_SELECTOR = 'span.user > a:not(.toolbox-user-list-seen)'

const log = createLogger('oldreddit',)

/** Lifecycle callbacks returned by {@link createOldRedditHandlers}. */
export interface OldRedditHandlers {
	/** Scans for unseen `.thing` elements and registers them with the IntersectionObserver. */
	thingCrawler: () => void
	/** Scans for unprocessed author links on user-list pages (banned/moderators/contributors/muted). */
	userListCrawler: () => void
	/** The DOM element that should be observed for RES infinite-scroll mutations, or `null`. */
	resObserverTarget: Element | null
	/** MutationCallback that debounces and re-runs the appropriate crawler when new things appear. */
	resObserverCallback: MutationCallback
	/** Disconnects the IntersectionObserver and cancels any pending timers. */
	cleanup: () => void
}

function dispatchApiEvent (element: Element, object: any,) {
	const apiEvent = new CustomEvent('tbReddit', {detail: object,},)
	try {
		element.dispatchEvent(apiEvent,)
	} catch (error) {
		log.debug('Could not dispatch event', object, error,)
	}
}

/**
 * Creates crawlers and mutation observers that process old Reddit `.thing` elements and user-list
 * pages as they enter the viewport, injecting React UI location containers and dispatching
 * `tbReddit` API events consumed by third-party integrations.
 */
export function createOldRedditHandlers (_s: OldRedditSettings,): OldRedditHandlers {
	function handleThing (entries: IntersectionObserverEntry[], observer: IntersectionObserver,) {
		type EntryData = {
			thing: HTMLElement
			author: string
			fullname: string
			subreddit: string
			isComment: boolean
			spam: boolean
			ham: boolean
			postID: string
			permalink: string
		}

		// Read all data synchronously from DOM attributes before the RAF so that a
		// single RAF handles the whole batch instead of one RAF per intersecting entry.
		const toProcess: EntryData[] = []
		for (const entry of entries) {
			if (!entry.isIntersecting) {
				continue
			}

			observer.unobserve(entry.target,)
			const thing = entry.target as HTMLElement

			// If the element's parent is updated, sometimes it gets emitted again anyway.
			// Check for existing containers and avoid adding duplicates.
			if (getThingSlot(thing,)) {
				continue
			}

			// Read data directly from native old Reddit element attributes.
			// getThingInfo() reads toolbox's own data-submission-author / data-post-id
			// attributes which don't exist on native old-Reddit elements.
			const author = thing.getAttribute('data-author',) || ''
			const fullname = thing.getAttribute('data-fullname',) || ''
			const subreddit = thing.getAttribute('data-subreddit',) || ''
			const isComment = thing.classList.contains('comment',)
			const spam = thing.classList.contains('spam',)
			const ham = thing.classList.contains('approved',)

			// For comments, extract the parent post ID from the bylink href or from
			// a parent .link thing (the latter works on comment-thread pages).
			let postID = ''
			if (isComment) {
				const parentLink = getThingParentLinkThing(thing,)
				if (parentLink) {
					postID = parentLink.getAttribute('data-fullname',) || ''
				} else {
					const bylinkHref = getThingBylinkAnchor(thing,)?.href || ''
					const match = bylinkHref.match(/\/comments\/([a-z0-9]+)\//i,)
					if (match) {
						postID = `t3_${match[1]}`
					}
				}
				if (!postID) {
					log.debug('Could not determine postID for comment thing', thing,)
				}
			}

			const permalink = thing.getAttribute('data-permalink',) || ''
			toProcess.push({thing, author, fullname, subreddit, isComment, spam, ham, postID, permalink,},)
		}

		if (!toProcess.length) {
			return
		}

		requestAnimationFrame(() => {
			for (const {thing, author, fullname, subreddit, isComment, spam, ham, postID, permalink,} of toProcess) {
				const thingSlot = ensureThingSlot(thing,)
				if (!thingSlot) {
					continue
				}

				const authorSlot = ensureThingAuthorContainer(thing,)
				if (authorSlot) {
					const authorSpan = document.createElement('span',)
					authorSpan.dataset.name = 'toolbox'
					authorSlot.appendChild(authorSpan,)
				}

				const displayAuthor = author || '[deleted]'
				const postId = isComment ? postID : fullname
				const fullPermalink = permalink ? `https://www.reddit.com${permalink}` : ''
				const isRemoved = ham || spam
				const thingKind = isComment ? 'comment' as const : 'post' as const
				const thingContext = {
					platform: RedditPlatform.Old,
					kind: thingKind,
					author: displayAuthor,
					subreddit,
					thingId: fullname,
					postId,
					permalink: fullPermalink,
					isRemoved,
				}

				if (!thingSlot.classList.contains('toolbox-frontend-container',)) {
					provideLocation('thingActions', thingSlot, thingContext,)
					provideLocation('thingDetails', thingSlot, thingContext,)
				}

				const domainEl = getThingDomainEl(thing,)
				if (domainEl && !domainEl.nextElementSibling?.classList.contains('toolbox-domain-controls',)) {
					const domainContainer = document.createElement('span',)
					domainContainer.className = 'toolbox-domain-controls'
					domainEl.after(domainContainer,)
					provideLocation('thingDomainControls', domainContainer, thingContext, {shadow: false,},)
				}

				const flatList = getThingFlatListButtons(thing,)
				if (flatList && !flatList.querySelector('.toolbox-flat-list-actions-slot',)) {
					const slot = document.createElement('li',)
					slot.className = 'toolbox-flat-list-actions-slot'
					const flairLi = flatList.querySelector<HTMLElement>('li:has(.flairselectbtn)',)
					const removedByLi = flatList.querySelector<HTMLElement>('li[title]',)
					if (flairLi) {
						flairLi.after(slot,)
					} else if (removedByLi) {
						removedByLi.before(slot,)
					} else {
						flatList.appendChild(slot,)
					}
					provideLocation('thingFlatListActions', slot, thingContext, {shadow: false, hostTag: 'span',},)
				}

				if (isComment) {
					const tagline = thing.querySelector<HTMLElement>('.entry .tagline',)
					if (tagline && !tagline.querySelector('.toolbox-tagline-status-slot',)) {
						const taglineSlot = document.createElement('span',)
						taglineSlot.className = 'toolbox-tagline-status-slot'
						tagline.appendChild(taglineSlot,)
						provideLocation('thingTaglineStatus', taglineSlot, thingContext, {
							shadow: false,
							hostTag: 'span',
						},)
					}
				}

				if (authorSlot && !authorSlot.classList.contains('toolbox-frontend-container',)) {
					provideLocation('authorActions', authorSlot, {
						platform: RedditPlatform.Old,
						kind: 'user',
						author: displayAuthor,
						subreddit,
						thingId: fullname,
						postId,
					},)
				}

				if (!isComment) {
					if (!thingSlot.classList.contains('toolbox-frontend-container',)) {
						dispatchApiEvent(thingSlot, {
							type: 'TBpost',
							data: {
								author: displayAuthor,
								id: fullname,
								isRemoved,
								permalink: fullPermalink,
								subreddit: {name: subreddit,},
							},
						},)
					}
					if (
						authorSlot
						&& !authorSlot.classList.contains('toolbox-frontend-container',)
					) {
						dispatchApiEvent(authorSlot, {
							type: 'TBpostAuthor',
							data: {
								author: displayAuthor,
								post: {id: fullname,},
								subreddit: {name: subreddit,},
							},
						},)
					}
				} else {
					if (!thingSlot.classList.contains('toolbox-frontend-container',)) {
						dispatchApiEvent(thingSlot, {
							type: 'TBcommentOldReddit',
							data: {
								author: displayAuthor,
								post: {id: postID,},
								isRemoved,
								id: fullname,
								subreddit: {name: subreddit,},
							},
						},)
					}
					if (
						authorSlot
						&& !authorSlot.classList.contains('toolbox-frontend-container',)
					) {
						dispatchApiEvent(authorSlot, {
							type: 'TBcommentAuthor',
							data: {
								author: displayAuthor,
								post: {id: postID,},
								comment: {id: fullname,},
								subreddit: {name: subreddit,},
							},
						},)
					}
				}
			}
		},)
	}

	const viewportObserver = new IntersectionObserver(handleThing, {rootMargin: '200px',},)

	function thingCrawler () {
		for (const thing of getUnseenContentThings()) {
			markThingSeen(thing,)
			viewportObserver.observe(thing,)
		}
	}

	function userListCrawler () {
		if (!isUserListPage) { return }
		const authorLinks = document.querySelectorAll<HTMLAnchorElement>(UNSEEN_USER_LINK_SELECTOR,)
		for (const authorLink of authorLinks) {
			authorLink.classList.add('toolbox-user-list-seen',)
			const username = authorLink.textContent?.trim() ?? ''
			if (!username) { continue }
			const container = document.createElement('span',)
			container.className = 'toolbox-author-slot'
			const innerSpan = document.createElement('span',)
			innerSpan.dataset.name = 'toolbox'
			container.appendChild(innerSpan,)
			authorLink.insertAdjacentElement('afterend', container,)
			provideLocation('authorActions', container, {
				platform: RedditPlatform.Old,
				kind: 'user',
				author: username,
				subreddit: postSite,
			},)
			dispatchApiEvent(container, {
				type: 'TBpostAuthor',
				data: {
					author: username,
					post: {id: '',},
					subreddit: {name: postSite,},
				},
			},)
		}
	}

	// RES infinite scroll appends new .thing elements to div.content without
	// firing TBNewThings, so the MutationObserver callback re-runs the crawler.
	// Debounce so that a burst of mutation records from a single RES scroll event
	// only triggers one crawler run.
	let crawlerTimer: ReturnType<typeof setTimeout> | undefined
	let userListTimer: ReturnType<typeof setTimeout> | undefined
	const resObserverCallback: MutationCallback = (mutations,) => {
		const hasNewThings = mutations.some((mutation,) =>
			Array.from(mutation.addedNodes,).some((node,) =>
				node instanceof HTMLElement
				&& (node.classList.contains('thing',) || node.querySelector('.thing',))
			)
		)
		if (hasNewThings) {
			clearTimeout(crawlerTimer,)
			crawlerTimer = setTimeout(thingCrawler, 50,)
		}
		if (isUserListPage) {
			const hasNewAuthors = mutations.some((mutation,) =>
				Array.from(mutation.addedNodes,).some((node,) =>
					node instanceof HTMLElement
					&& (node.matches('span.user > a',) || node.querySelector('span.user > a',) != null)
				)
			)
			if (hasNewAuthors) {
				clearTimeout(userListTimer,)
				userListTimer = setTimeout(userListCrawler, 50,)
			}
		}
	}

	return {
		thingCrawler,
		userListCrawler,
		resObserverTarget: getContentContainer(),
		resObserverCallback,
		cleanup: () => {
			viewportObserver.disconnect()
			clearTimeout(crawlerTimer,)
			clearTimeout(userListTimer,)
		},
	}
}
