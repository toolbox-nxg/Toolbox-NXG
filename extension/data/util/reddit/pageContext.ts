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

// URL-path-derived page-type flags. On Shreddit these must be recomputed on soft
// navigation (via refreshPageFlags, called from refreshPathContext) - otherwise a
// value frozen at content-script load leaves e.g. the comment context button
// missing after navigating to a profile. Importers read these at call time, and
// ES module live bindings mean reassigning here updates every consumer.
export let isEditUserPage: RegExpMatchArray | null = null
export let isModpage: RegExpMatchArray | null = null
export let isModLogPage: RegExpMatchArray | null = null
export let isShredditModLogPage: RegExpMatchArray | null = null
export let isShredditModQueuePage: RegExpMatchArray | null = null
export let isModQueuePage: RegExpMatchArray | null = null
export let isUnmoderatedPage: RegExpMatchArray | null = null
export let isUserPage: RegExpMatchArray | null = null
export let isCommentsPage: RegExpMatchArray | null = null
export let isSubCommentsPage: RegExpMatchArray | null = null
export let isSubAllCommentsPage: RegExpMatchArray | null = null
export let isModFakereddit: RegExpMatchArray | null = null
export let postSite = ''

const invalidPostSites = ['subreddits you moderate', 'mod (filtered)', 'all',]

/** Recomputes the URL-derived page-type flags from the current location; call on every navigation. */
function refreshPageFlags () {
	const path = location.pathname
	isEditUserPage = path.match(/\/about\/(?:contributors|moderator|banned)\/?/,)
	isModpage = path.match(/\/about\/(?:reports|modqueue|spam|unmoderated|edited)\/?/,)
	isModLogPage = path.match(/\/about\/(?:log)\/?/,)
	isShredditModLogPage = path.match(/^\/mod\/([^/]+)\/log\/?$/,)
	isShredditModQueuePage = path.match(/^\/mod\/(?:queue|[^/]+\/queue)\/?$/,)
	isModQueuePage = path.match(/\/about\/(?:modqueue)\/?/,)
	isUnmoderatedPage = path.match(/\/about\/(?:unmoderated)\/?/,)
	// Anchored to the path start so subreddits like /r/userexperience are not
	// mistaken for a user profile page.
	isUserPage = path.match(/^\/user\/?/,)
	isCommentsPage = path.match(/\?*\/(?:comments)\/?/,)
	isSubCommentsPage = path.match(/\/r\/.*?\/(?:comments)\/?/,)
	isSubAllCommentsPage = path.match(/\/r\/.*?\/(?:comments)\/?$/,)
	isModFakereddit = path.match(/^\/r\/mod\b/,) || path.match(/^\/me\/f\/mod\b/,)

	const urlSubMatch = path.match(/^\/r\/([^/]+)/,)
	postSite = isModFakereddit ? '' : (urlSubMatch ? decodeURIComponent(urlSubMatch[1]!,) : '')
	if (!postSite || invalidPostSites.includes(postSite.toLowerCase(),)) {
		postSite = ''
	}
}

// Initialize at module load so importers reading during startup see correct values.
refreshPageFlags()

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
		// Keep the URL-derived page-type flags in sync with soft navigations.
		refreshPageFlags()

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
