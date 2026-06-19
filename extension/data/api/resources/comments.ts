/** API functions for reading and posting Reddit comments. */

import {normalizeRedditPath,} from '../../util/reddit/reddit-domain'
import {postRedditApi,} from '../parsers/redditMutation'
import {getRedditPageJson,} from './listings'

/** Shape of the `data` field returned by `/api/comment`. */
interface RedditCommentData {
	things?: Array<{
		data?: {
			/** The short base-36 ID of the comment. */
			id?: string
			/** The fullname (e.g. `t1_abc123`) of the posted comment. */
			name?: string
		}
	}>
}

/** Identifiers for a successfully posted comment. */
interface PostedComment {
	/** The short base-36 ID of the comment. */
	id: string
	/** The comment's fullname (e.g. `t1_abc123`). */
	fullname: string
}

/** Extracts comment identifiers from a `/api/comment` response, throwing if the data is absent. */
function getPostedComment (data: RedditCommentData | undefined,): PostedComment {
	const thing = data?.things?.[0]?.data
	if (!thing?.id || !thing.name) {
		throw new Error('Reddit API response did not include a posted comment ID',)
	}
	return {id: thing.id, fullname: thing.name,}
}

/**
 * A single listing node from a Reddit comment-page response.
 * Comment pages return a two-element array of these (post listing + comment listing).
 */
export interface RedditCommentPageListing {
	kind: 'Listing'
	data: {
		children: unknown[]
		after: string | null
	}
}

/**
 * Fetches a comment's thread with surrounding context.
 * @param permalink The comment's permalink path.
 * @param context Number of ancestor comments to include above the target.
 */
export function getCommentContext (permalink: string, context = 3,): Promise<RedditCommentPageListing[]> {
	const normalizedPermalink = normalizeRedditPath(permalink,).replace(/\/?$/, '/',)
	return getRedditPageJson<RedditCommentPageListing[]>(normalizedPermalink, {context: String(context,),},)
}

/**
 * Fetches an entire comment thread rooted at a specific comment.
 * @param subreddit The subreddit the thread is in.
 * @param postID The base-36 ID of the parent submission.
 * @param commentID The base-36 ID of the target comment.
 * @param limit Maximum number of comments to return.
 */
export function getCommentThread (
	subreddit: string,
	postID: string,
	commentID: string,
	limit = 1500,
): Promise<RedditCommentPageListing[]> {
	return getRedditPageJson<RedditCommentPageListing[]>(`/r/${subreddit}/comments/${postID}/slug/${commentID}`, {
		limit: String(limit,),
	},)
}

/**
 * Fetches additional comments starting from a specific comment within an existing thread.
 * @param threadPermalink The thread's permalink path (with trailing slash).
 * @param commentID The base-36 ID of the comment to start from.
 * @param limit Maximum number of comments to return.
 */
export function getMoreComments (
	threadPermalink: string,
	commentID: string,
	limit = 1500,
): Promise<RedditCommentPageListing[]> {
	return getRedditPageJson<RedditCommentPageListing[]>(`/${threadPermalink}${commentID}`, {limit: String(limit,),},)
}

/**
 * Fetches the comment listing for a page identified by its pathname.
 * @param pathname The URL pathname of the comments page (e.g. `/r/sub/comments/abc`).
 * @param limit Maximum number of comments to return.
 */
export function getCommentsPageListing (pathname: string, limit = 1500,): Promise<RedditCommentPageListing[]> {
	return getRedditPageJson<RedditCommentPageListing[]>(pathname, {limit: String(limit,),},)
}

/**
 * Submits a reply to a submission or comment.
 * @param parent Fullname of the thing being replied to.
 * @param text Markdown body of the reply.
 * @returns Resolves with the identifiers of the newly created comment.
 */
export const postComment = (parent: string, text: string,) =>
	postRedditApi('/api/comment', {parent, text, api_type: 'json',}, getPostedComment,)
