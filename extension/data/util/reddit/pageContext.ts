/**
 * Page context detection and URL-change tracking for both old Reddit and Shreddit.
 * Parses the current URL into a typed page context and fires `TBNewPage` events on navigation.
 */

/** Detail payload dispatched with `TBNewPage` custom events when the page URL changes. */
export interface TBPageContext {
	oldHref: string | undefined
	locationHref: string
	pageType: string
	pageDetails: Record<string, string>
}

declare global {
	interface WindowEventMap {
		TBNewPage: CustomEvent<TBPageContext>
	}
}

/** True when the current user is a moderator (detected by the `body.moderator` class on old Reddit). */
export const isMod = document.body.matches('body.moderator',)
/** The protocol + hostname of the current page (e.g. `https://old.reddit.com`). */
export const baseDomain = `https://${window.location.hostname}`

/** Returns the URL as-is. Exists as a hook point for future URL transformation needs. */
export const link = (l: string,) => l

/**
 * The page context from the most recent `TBNewPage` event. This is the whole
 * `TBPageContext` (matching `event.detail`), so per-page fields live under the
 * nested `pageDetails.pageDetails` (e.g. `pageDetails.pageDetails.subreddit`),
 * while `pageType` is top-level.
 */
export let pageDetails: TBPageContext = {
	oldHref: undefined,
	locationHref: location.href,
	pageType: '',
	pageDetails: {},
}

export const isEditUserPage = location.pathname.match(/\/about\/(?:contributors|moderator|banned)\/?/,)
export const isModpage = location.pathname.match(/\/about\/(?:reports|modqueue|spam|unmoderated|edited)\/?/,)
export const isModLogPage = location.pathname.match(/\/about\/(?:log)\/?/,)
export const isShredditModLogPage = location.pathname.match(/^\/mod\/([^/]+)\/log\/?$/,)
export const isShredditModQueuePage = location.pathname.match(/^\/mod\/(?:queue|[^/]+\/queue)\/?$/,)
export const isModQueuePage = location.pathname.match(/\/about\/(?:modqueue)\/?/,)
export const isUnmoderatedPage = location.pathname.match(/\/about\/(?:unmoderated)\/?/,)
export const isUserPage = location.pathname.match(/\/(?:user)\/?/,)
export const isCommentsPage = location.pathname.match(/\?*\/(?:comments)\/?/,)
export const isSubCommentsPage = location.pathname.match(/\/r\/.*?\/(?:comments)\/?/,)
export const isSubAllCommentsPage = location.pathname.match(/\/r\/.*?\/(?:comments)\/?$/,)
export const isModFakereddit = location.pathname.match(/^\/r\/mod\b/,) || location.pathname.match(/^\/me\/f\/mod\b/,)

const invalidPostSites = ['subreddits you moderate', 'mod (filtered)', 'all',]
const urlSubMatch = window.location.pathname.match(/^\/r\/([^/]+)/,)
export let postSite: string = isModFakereddit ? '' : (urlSubMatch ? decodeURIComponent(urlSubMatch[1]!,) : '')
if (!postSite || invalidPostSites.includes(postSite.toLowerCase(),)) {
	postSite = ''
}

let watchingForURLChanges = false
let locationHref: string | undefined
let locationHash: string | null | undefined

const redditFrontpageReg = /^\/?(hot|new|rising|controversial)?\/?$/
const subredditFrontpageReg = /^\/r\/([^/]*?)\/?(hot|new|rising|controversial)?\/?$/
const subredditCommentListingReg = /^\/r\/([^/]*?)\/comments\/?$/
const subredditCommentsPageReg = /^\/r\/([^/]*?)\/comments\/([^/]*?)\/([^/]*?)\/?$/
const subredditPermalinkCommentsPageReg = /^\/r\/([^/]*?)\/comments\/([^/]*?)\/([^/]*?)\/([^/]*?)\/?$/
const subredditWikiPageReg = /^\/r\/([^/]*?)\/wiki\/?(edit|revisions|settings|discussions)?\/(.+)\/?$/
const queuePageReg = /^\/r\/([^/]*?)\/about\/(modqueue|reports|edited|unmoderated|spam)\/?$/
const subredditPageReg = /^\/r\/([^/]+)/
const userProfileReg =
	/^\/user\/([^/]*?)\/?(overview|submitted|posts|comments|saved|upvoted|downvoted|hidden|gilded)?\/?$/
const userModMessageReg = /^\/message\/([^/]*?)\/([^/]*?)?\/?$/

function refreshHashContext () {
	if (window.location.hash && window.location.hash !== locationHash) {
		locationHash = window.location.hash
		const hash = locationHash.substring(1,)
		if (hash.startsWith('?tb',)) {
			const paramObject: Record<string, string> = {}
			const params = hash.split('&',)
			params.forEach((param,) => {
				const keyval = param.split('=',)
				const key = keyval[0]!.replace('?', '',)
				const val = keyval[1] ?? ''
				paramObject[key] = val
			},)
			setTimeout(() => {
				window.dispatchEvent(new CustomEvent('TBHashParams', {detail: paramObject,},),)
			}, 500,)
		}
	} else if (!window.location.hash) {
		locationHash = null
	}
}

function refreshPathContext () {
	const samePage = locationHref === location.href
	if (!samePage) {
		const oldHref = locationHref
		locationHref = location.href

		const contextObject: {
			oldHref: string | undefined
			locationHref: string
			pageType: string
			pageDetails: Record<string, string>
		} = {
			oldHref,
			locationHref,
			pageType: '',
			pageDetails: {},
		}

		if (redditFrontpageReg.test(location.pathname,)) {
			const matchDetails = location.pathname.match(redditFrontpageReg,)!
			contextObject.pageType = 'frontpage'
			contextObject.pageDetails = {sortType: matchDetails[1] || 'hot',}
		} else if (subredditFrontpageReg.test(location.pathname,)) {
			const matchDetails = location.pathname.match(subredditFrontpageReg,)!
			contextObject.pageType = 'subredditFrontpage'
			contextObject.pageDetails = {
				subreddit: matchDetails[1]!,
				sortType: matchDetails[2] || 'hot',
			}
		} else if (subredditCommentListingReg.test(location.pathname,)) {
			const matchDetails = location.pathname.match(subredditCommentListingReg,)!
			contextObject.pageType = 'subredditCommentListing'
			contextObject.pageDetails = {subreddit: matchDetails[1]!,}
		} else if (subredditCommentsPageReg.test(location.pathname,)) {
			const matchDetails = location.pathname.match(subredditCommentsPageReg,)!
			contextObject.pageType = 'subredditCommentsPage'
			contextObject.pageDetails = {
				subreddit: matchDetails[1]!,
				submissionID: matchDetails[2]!,
				linkSafeTitle: matchDetails[3]!,
			}
		} else if (subredditPermalinkCommentsPageReg.test(location.pathname,)) {
			const matchDetails = location.pathname.match(subredditPermalinkCommentsPageReg,)!
			contextObject.pageType = 'subredditCommentPermalink'
			contextObject.pageDetails = {
				subreddit: matchDetails[1]!,
				submissionID: matchDetails[2]!,
				linkSafeTitle: matchDetails[3]!,
				commentID: matchDetails[4]!,
			}
		} else if (subredditWikiPageReg.test(location.pathname,)) {
			const matchDetails = location.pathname.match(subredditWikiPageReg,)!
			contextObject.pageType = 'subredditWiki'
			contextObject.pageDetails = {
				subreddit: matchDetails[1]!,
				action: matchDetails[2] ?? '',
				page: matchDetails[3]!,
			}
		} else if (queuePageReg.test(location.pathname,)) {
			const matchDetails = location.pathname.match(queuePageReg,)!
			contextObject.pageType = 'queueListing'
			contextObject.pageDetails = {
				subreddit: matchDetails[1]!,
				queueType: matchDetails[2]!,
			}
		} else if (subredditPageReg.test(location.pathname,)) {
			const matchDetails = location.pathname.match(subredditPageReg,)!
			contextObject.pageType = 'subredditPage'
			contextObject.pageDetails = {subreddit: matchDetails[1]!,}
		} else if (userProfileReg.test(location.pathname,)) {
			const matchDetails = location.pathname.match(userProfileReg,)!
			let listing = matchDetails[2]
			if (listing === 'posts') {
				listing = 'submitted'
			}
			if (!listing) {
				listing = 'overview'
			}
			contextObject.pageType = 'userProfile'
			contextObject.pageDetails = {
				user: matchDetails[1]!,
				listing,
			}
		} else if (userModMessageReg.test(location.pathname,)) {
			const matchDetails = location.pathname.match(userModMessageReg,)!
			contextObject.pageType = 'message'
			contextObject.pageDetails = {type: matchDetails[1]!,}
		} else {
			contextObject.pageType = 'unknown'
		}

		pageDetails = contextObject

		setTimeout(() => {
			window.dispatchEvent(new CustomEvent('TBNewPage', {detail: contextObject,},),)
		}, 500,)
	}
}

/**
 * Starts firing TBNewPage and TBHashParam events (with metadata) each time the
 * background page reports that this tab's URL has changed.
 */
export function watchForURLChanges () {
	if (watchingForURLChanges) {
		return
	}
	watchingForURLChanges = true

	refreshPathContext()
	refreshHashContext()

	window.addEventListener('toolbox-url-changed', () => {
		refreshPathContext()
		refreshHashContext()
	},)
}
