/** Platform detection and URL mapping utilities for old Reddit and Shreddit. */

// Helpers for handling per-frontend (old Reddit vs Shreddit) differences.

/** The Reddit frontends Toolbox can run inside. */
export enum RedditPlatform {
	/** "old Reddit," old.reddit.com */
	Old,
	/** "shreddit" (current Reddit redesign), sh.reddit.com / www.reddit.com */
	Shreddit,
}

/** The Reddit platform detected at page load time, or `null` if unrecognized. */
export const currentPlatform = (() => {
	if (document.getElementById('header',)) {
		return RedditPlatform.Old
	}
	if (document.querySelector('shreddit-app',)) {
		return RedditPlatform.Shreddit
	}
	return null
})()

/** True when running on old.reddit.com. */
export const isOldReddit = currentPlatform === RedditPlatform.Old
/** True when running on the current Reddit redesign (shreddit). */
export const isShreddit = currentPlatform === RedditPlatform.Shreddit

/**
 * True when the extension is loaded inside an embedded frame (e.g. the
 * shreddit post-viewer iframe or pages with the `embedded-page` body class).
 */
export const isEmbedded = document.body.classList.contains('embedded-page',)
	|| !!window.location.pathname.match(/^(\/r\/.*?)\/post-viewer\//,)

interface PathMapping {
	/** Given a URL on old Reddit, return a transformed URL for shreddit, or null if this mapping doesn't apply. */
	toShreddit: (url: URL,) => URL | null
	/** Given a URL on shreddit, return a transformed URL for old Reddit, or null if this mapping doesn't apply. */
	toOld: (url: URL,) => URL | null
}

function subPath (url: URL, pathname: string, search = '',): URL {
	const result = new URL(url,)
	result.pathname = pathname
	result.search = search
	return result
}

/**
 * Builds a mapping for pages that exist on the aggregate /r/mod/ virtual subreddit
 * and map to /mod/queue on shreddit. Pass null for queueType to match the no-param form.
 */
function aggregateModMapping (oldPage: string, queueType: string | null,): PathMapping {
	const oldPattern = new RegExp(`^/r/mod/about/${oldPage}/?$`,)
	const search = queueType !== null ? `?queueType=${queueType}` : ''
	return {
		toShreddit (url,) {
			return oldPattern.test(url.pathname,) ? subPath(url, '/mod/queue', search,) : null
		},
		toOld (url,) {
			if (!/^\/mod\/queue\/?$/.test(url.pathname,)) { return null }
			return url.searchParams.get('queueType',) === queueType
				? subPath(url, `/r/mod/about/${oldPage}/`,)
				: null
		},
	}
}

/**
 * Builds a mapping for a per-subreddit page. The generic patterns exclude "mod" as a subreddit
 * name so aggregate mappings (defined first) always take priority for /r/mod/ pages.
 * Pass queueType when the shreddit side is /mod/<sub>/queue?queueType=<x>; omit for path-based pages.
 */
function perSubMapping (oldPage: string, shredditPage: string, queueType: string | null = null,): PathMapping {
	const oldPattern = new RegExp(`^/r/([^/]+)/about/${oldPage}/?$`,)
	const shredditOldPattern = queueType !== null
		? /^\/mod\/([^/]+)\/queue\/?$/
		: new RegExp(`^/mod/([^/]+)/${shredditPage}/?$`,)
	const search = queueType !== null ? `?queueType=${queueType}` : ''
	return {
		toShreddit (url,) {
			const m = url.pathname.match(oldPattern,)
			if (!m || m[1] === 'mod') { return null }
			return subPath(url, queueType !== null ? `/mod/${m[1]}/queue` : `/mod/${m[1]}/${shredditPage}`, search,)
		},
		toOld (url,) {
			const m = url.pathname.match(shredditOldPattern,)
			if (!m || url.searchParams.get('queueType',) !== queueType) { return null }
			return subPath(url, `/r/${m[1]}/about/${oldPage}/`,)
		},
	}
}

/** Pages whose URL structure differs between old Reddit and shreddit. */
const pathMappings: PathMapping[] = [
	// --- aggregate /r/mod/ mappings first so "mod" is never matched as a subreddit name ---
	aggregateModMapping('modqueue', 'mod',),
	aggregateModMapping('unmoderated', 'unmoderated',),
	aggregateModMapping('edited', 'edited',),
	aggregateModMapping('spam', 'removed',),
	aggregateModMapping('reports', null,), // /mod/queue with no queueType param
	// --- generic per-subreddit mappings ---
	perSubMapping('log', 'log',),
	perSubMapping('reports', 'queue', null,),
	perSubMapping('edited', 'queue', 'edited',),
	perSubMapping('spam', 'queue', 'removed',),
	perSubMapping('traffic', 'insights',),
	perSubMapping('unmoderated', 'queue', 'unmoderated',),
	perSubMapping('flair', 'userflair',),
	perSubMapping('muted', 'muted',),
	perSubMapping('banned', 'banned',),
]

function remapURL (url: URL, goingToShreddit: boolean,): URL {
	for (const mapping of pathMappings) {
		const result = goingToShreddit ? mapping.toShreddit(url,) : mapping.toOld(url,)
		if (result) { return result }
	}
	return url
}

/** Returns the URL and label for the old↔new Reddit toggle button, or null if the button should be hidden. */
export function getDirectingTo () {
	// These pages have no old Reddit equivalent - hide the button entirely.
	if (window.location.pathname.startsWith('/mail',) || window.location.pathname.startsWith('/notifications',)) {
		return null
	}

	let url = window.location.href.replace(/^http:/, 'https:',)
	let directingTo: string
	let goingToShreddit: boolean
	if (url.startsWith('https://old.',)) {
		url = url.replace('old.', 'sh.',)
		directingTo = 'sh.Reddit'
		goingToShreddit = true
	} else if (url.startsWith('https://sh.',)) {
		url = url.replace('sh.', 'old.',)
		directingTo = 'old.Reddit'
		goingToShreddit = false
	} else {
		goingToShreddit = isOldReddit
		url = url.replace(/https:\/\/.*?\.reddit/, goingToShreddit ? 'https://sh.reddit' : 'https://old.reddit',)
		directingTo = goingToShreddit ? 'sh.Reddit' : 'old.Reddit'
	}

	const remapped = remapURL(new URL(url,), goingToShreddit,)
	return {url: remapped.toString(), directingTo,}
}

/**
 * Cheaply tests whether anyone is logged in. We don't need any details about
 * the account here - only a yes/no before we begin firing API requests for user
 * info and authentication/modhash.
 */
export function isUserLoggedInQuick () {
	switch (currentPlatform) {
		// old Reddit sets the `loggedin` class on the body
		case RedditPlatform.Old:
			return document.body.classList.contains('loggedin',)

		// shreddit will have an attribute `user-logged-in` on its app root
		case RedditPlatform.Shreddit:
			return !!document.querySelector('shreddit-app[user-logged-in=true]',)

		default:
			return false
	}
}
