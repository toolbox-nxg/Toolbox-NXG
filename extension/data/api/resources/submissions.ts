/** API function for submitting link posts to Reddit. */

import {postRedditApi,} from '../parsers/redditMutation'

/** Identifiers for a successfully submitted link post. */
interface PostedLink {
	/** The fullname (e.g. `t3_abc123`) of the new submission. */
	name: string
	/** The canonical URL of the new submission on Reddit. */
	url: string
}

function getPostedLink (data: Partial<PostedLink> | undefined,): PostedLink {
	if (!data?.name || !data.url) {
		throw new Error('Reddit API response did not include posted link details',)
	}
	return {name: data.name, url: data.url,}
}

/**
 * Posts a link submission in a subreddit.
 * @param subreddit The subreddit to submit to
 * @param url The URL to submit
 * @param title The title of the submission
 * @returns Resolves to the posted submission identifiers
 */
export const postLink = (subreddit: string, url: string, title: string,) =>
	postRedditApi(
		'/api/submit',
		{kind: 'link', resubmit: 'true', url, title, sr: subreddit, sendreplies: 'true', api_type: 'json',},
		getPostedLink,
	)
