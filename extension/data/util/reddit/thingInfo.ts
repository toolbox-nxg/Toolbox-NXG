/** Functions for resolving Reddit thing (submission/comment) metadata from the API or DOM. */

import {getCurrentUser,} from '../../api/resources/me'
import {getModSubs, isModSub,} from '../../api/resources/modSubs'
import {getThingInfo as getApiThingInfoById,} from '../../api/resources/things'
import {baseDomain, link,} from './pageContext'
import {cleanSubredditName,} from './reddit-domain'

const permaCommentLinkRegex = /(\/(?:r|user)\/[^/]*?\/comments\/[^/]*?\/)([^/]*?)(\/[^/]*?\/?)$/

/**
 * Thrown by {@link getApiThingInfo} when the Reddit API returns an empty listing for a
 * fullname - a definitive "not found" (deleted/removed thing), as opposed to a transient
 * error. Callers can branch on `instanceof ThingNotFoundError` instead of matching the
 * message text.
 */
export class ThingNotFoundError extends Error {
	constructor (fullname: string, subreddit: string,) {
		super(`No data returned for ${fullname} in /r/${subreddit}`,)
		this.name = 'ThingNotFoundError'
	}
}

/**
 * Strips a Reddit fullname's type prefix (`t1_`, `t3_`, ...) to the bare base-36 id.
 * `t3_abc123` -> `abc123`. A value without a recognised prefix is returned unchanged.
 * @param fullname A Reddit fullname (or already-bare id).
 * @returns The bare base-36 id.
 */
function fullnameToId (fullname: string,): string {
	return fullname.replace(/^t\d+_/, '',)
}

/**
 * Whether a thing's normalized info (from {@link getApiThingInfo}) indicates it is currently
 * removed or spammed. `ham` (Reddit's "removed" flag) isn't reliably populated by `/api/info`, so
 * `spam` and `banned_by` are ORed in to also catch queue-removed/spammed items.
 * @param info Normalized thing info exposing the `ham`/`spam`/`banned_by` fields.
 */
export function isInfoRemoved (info: {ham?: unknown; spam?: unknown; banned_by?: unknown},): boolean {
	return !!info.ham || !!info.spam || !!info.banned_by
}

/**
 * Fetches thing info from the Reddit API and normalizes it into a flat object used by modules.
 * @param subreddit Subreddit context for the request.
 * @param fullname Fullname of the thing (e.g. `t3_abc123`).
 * @param modCheck When true, returns an empty subreddit field if the current user is not a mod there.
 */
export async function getApiThingInfo (subreddit: string, fullname: string, modCheck?: boolean,) {
	const response = await getApiThingInfoById(subreddit, fullname,)
	const thing = response.data?.children?.[0]
	if (!thing) {
		throw new ThingNotFoundError(fullname, subreddit,)
	}
	// Cast to Record<string, any>: getApiThingInfo is the adapter layer that reads
	// many optional fields from raw API data; the loose cast is intentional here.
	const thingData = thing.data as Record<string, any>

	let user = thingData.author
	const body = thingData.body || thingData.selftext || ''
	let permalink = thingData.permalink
	const title = thingData.title || ''
	const postlink = thingData.url || ''
	subreddit = cleanSubredditName(subreddit,)

	const isMod = await isModSub(subreddit,)
	if (modCheck && !isMod) {
		subreddit = ''
	}

	if (user === '[deleted]') {
		user = ''
	}

	if (permalink && permalink.slice(0, 1,) === '/') {
		permalink = baseDomain + permalink
	}

	if (permalink && permaCommentLinkRegex.test(permalink,)) {
		permalink = permalink.replace(permaCommentLinkRegex, '$1-$3',)
	}

	return {
		subreddit,
		user,
		author: user,
		permalink,
		url: permalink,
		domain: thingData.domain || '',
		fullname,
		id: fullnameToId(fullname,),
		body: `> ${body.split('\n',).join('\n> ',)}`,
		raw_body: body,
		uri_body: encodeURIComponent(body,).replace(/\\/g, '\\\\',).replace(/\)/g, '\\)',),
		approved_by: thingData.approved_by,
		title,
		uri_title: encodeURIComponent(title,).replace(/\\/g, '\\\\',).replace(/\)/g, '\\)',),
		kind: thing.kind === 't3' ? 'submission' : 'comment',
		postlink,
		link: postlink,
		banned_by: thingData.banned_by,
		spam: thingData.spam,
		ham: thingData.removed,
		rules: subreddit ? link(`/r/${subreddit}/about/rules`,) : '',
		sidebar: subreddit ? link(`/r/${subreddit}/about/sidebar`,) : '',
		wiki: subreddit ? link(`/r/${subreddit}/wiki/index`,) : '',
		mod: await getCurrentUser(),
		userReports: thingData.user_reports,
		modReports: thingData.mod_reports,
		// When a post/comment is removed or its reports are ignored, Reddit moves the reports out
		// of user_reports/mod_reports and into these *_dismissed arrays (leaving the active arrays
		// empty), so anything wanting to surface dismissed reports must read these.
		userReportsDismissed: thingData.user_reports_dismissed,
		modReportsDismissed: thingData.mod_reports_dismissed,
		reportsIgnored: thingData.ignore_reports,
	}
}

/**
 * Extracts thing info from a Toolbox-rendered DOM element (`.toolbox-thing`).
 * @param sender Any element inside a `.toolbox-thing`; the nearest ancestor is used.
 * @param modCheck When true, returns null if the current user is not a mod in the thing's subreddit.
 */
export async function getThingInfo (sender: Element | null, modCheck?: boolean,): Promise<any> {
	if (!sender) { return null }

	const currentUser = await getCurrentUser()

	const thing = (sender.closest('.toolbox-thing',) || sender) as HTMLElement
	const subreddit = cleanSubredditName(thing.getAttribute('data-subreddit',) || '',)

	if (modCheck) {
		const modSubs = await getModSubs(false,)
		if (!modSubs.includes(subreddit,)) { return null }
	}

	const isComment = thing.classList.contains('toolbox-comment',)
	// `data-fullname` already carries the prefixed fullname (e.g. `t3_abc`/`t1_abc`) for both
	// submissions and comments, so read it directly.
	const fullname = thing.getAttribute('data-fullname',) || ''
	const id = fullnameToId(fullname,)
	const user = thing.getAttribute(isComment ? 'data-comment-author' : 'data-submission-author',) || ''
	const permalink = thing.getAttribute('data-thread-permalink',) || ''

	return {
		subreddit,
		user,
		author: user,
		permalink,
		url: permalink,
		domain: '',
		fullname,
		id,
		body: '',
		raw_body: '',
		uri_body: '',
		approved_by: '',
		title: '',
		uri_title: '',
		kind: isComment ? 'comment' : 'submission',
		postlink: permalink,
		link: permalink,
		banned_by: '',
		spam: '',
		ham: '',
		rules: subreddit ? link(`/r/${subreddit}/about/rules`,) : '',
		sidebar: subreddit ? link(`/r/${subreddit}/about/sidebar`,) : '',
		wiki: subreddit ? link(`/r/${subreddit}/wiki/index`,) : '',
		mod: currentUser,
		userReports: [],
		modReports: [],
		reportsIgnored: false,
	}
}
