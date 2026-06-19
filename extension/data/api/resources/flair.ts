/** API functions for reading and applying post and user flair in subreddits. */

import {assertActionAllowed,} from '../../util/infra/captureGuard'
import {postRedditApiVoid,} from '../parsers/redditMutation'
import {apiOauthGetJSON, apiOauthPostJSON,} from '../transport/http'

/** Minimal shape of a flair template entry from `/api/user_flair_v2` or `/api/link_flair_v2`. */
export interface FlairTemplateData {
	id: string
	text: string
	css_class: string
}

/** Response shape of `/api/flairselector`. */
export interface FlairSelectorResponse {
	/** The current flair assignment for the user, or `null` if unset. */
	current: {
		flair_text: string
		flair_css_class: string
		flair_template_id: string | null
	} | null
	choices: FlairTemplateData[]
}

/** Gets user flair templates for a subreddit. */
export const getUserFlairTemplates = (subreddit: string,): Promise<FlairTemplateData[]> =>
	apiOauthGetJSON<FlairTemplateData[]>(`/r/${subreddit}/api/user_flair_v2`,)

/** Gets link flair templates for a subreddit. */
export const getLinkFlairTemplates = (subreddit: string,): Promise<FlairTemplateData[]> =>
	apiOauthGetJSON<FlairTemplateData[]>(`/r/${subreddit}/api/link_flair_v2`,)

/**
 * Gets the current flair and available flair templates for a user in a
 * subreddit. Response is sanitized at the API boundary (flair text is
 * user-controlled content).
 */
export const getFlairSelector = (subreddit: string, user: string,): Promise<FlairSelectorResponse> =>
	apiOauthPostJSON<FlairSelectorResponse>(`/r/${subreddit}/api/flairselector`, {name: user,},)

// flairPost and flairUser are kept as separate exported functions rather than merged into
// one because their target fields (`link` vs `name`) are named differently, and callers
// always know which type they're applying. A unified function would require a discriminant
// that adds indirection without reducing the call-site code.
function applyFlair (
	guardName: string,
	subreddit: string,
	text: string | undefined,
	cssClass: string | undefined,
	templateID: string | undefined,
	target: {link: string} | {name: string},
) {
	// Setting flair is a real moderation action; gate it by the training-mode capture
	// guard so a sandboxed trainee is blocked (the proposals gateway captures it properly).
	assertActionAllowed(guardName, {subreddit,},)
	return postRedditApiVoid('/api/selectflair', {
		api_type: 'json',
		r: subreddit,
		text,
		css_class: cssClass,
		flair_template_id: templateID,
		...target,
	},)
}

/**
 * Applies link flair to a submission.
 * @param options Flair options.
 * @param postLink Fullname of the submission to flair.
 * @param subreddit Subreddit the submission belongs to.
 * @param text Flair text to display.
 * @param cssClass Flair CSS class to assign.
 * @param templateID Flair template ID to apply.
 */
export const flairPost = ({
	postLink,
	subreddit,
	text,
	cssClass,
	templateID,
}: {
	postLink: string
	subreddit: string
	text?: string
	cssClass?: string
	templateID?: string
},) => applyFlair('flairPost', subreddit, text, cssClass, templateID, {link: postLink,},)

/**
 * Sets a flair on a user in a subreddit.
 * @param options Flair options.
 * @param user The username to flair.
 * @param subreddit The subreddit to apply the flair in.
 * @param text The flair text.
 * @param cssClass The flair CSS class.
 * @param templateID The flair template ID.
 */
export const flairUser = ({
	user,
	subreddit,
	text,
	cssClass,
	templateID,
}: {
	user: string
	subreddit: string
	text?: string
	cssClass?: string
	templateID?: string
},) => applyFlair('flairUser', subreddit, text, cssClass, templateID, {name: user,},)
