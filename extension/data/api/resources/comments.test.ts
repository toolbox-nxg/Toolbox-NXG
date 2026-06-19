/** Tests for comments API reads. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const getRedditPageJson = vi.hoisted(() => vi.fn())
const apiOauthPOST = vi.hoisted(() => vi.fn())

vi.mock('../../util/infra/logging', () => ({default: () => ({debug: vi.fn(), error: vi.fn(),}),}),)
vi.mock('./listings', () => ({getRedditPageJson,}),)
vi.mock('../transport/http', () => ({apiOauthPOST,}),)

import {RedditApiError,} from '../parsers/redditMutation'
import {getCommentContext, getCommentsPageListing, getCommentThread, getMoreComments, postComment,} from './comments'

function jsonResponse (body: unknown,): Response {
	return new Response(JSON.stringify(body,), {headers: {'content-type': 'application/json',},},)
}

beforeEach(() => {
	getRedditPageJson.mockReset().mockResolvedValue({},)
	apiOauthPOST.mockReset().mockImplementation(() => Promise.resolve(jsonResponse({json: {errors: [],},},),))
},)

describe('comments API reads', () => {
	it('fetches comment context JSON from a permalink', async () => {
		await getCommentContext('/r/test/comments/post/-/comment/',)

		expect(getRedditPageJson,).toHaveBeenCalledWith('/r/test/comments/post/-/comment/', {context: '3',},)
	})

	it('normalizes absolute reddit permalinks for comment context', async () => {
		await getCommentContext('https://old.reddit.com/r/test/comments/post/-/comment/',)

		expect(getRedditPageJson,).toHaveBeenCalledWith('/r/test/comments/post/-/comment/', {context: '3',},)
	})

	it('normalizes bare reddit.com URLs (no subdomain) for comment context', async () => {
		await getCommentContext('https://reddit.com/r/test/comments/post/-/comment/',)

		expect(getRedditPageJson,).toHaveBeenCalledWith('/r/test/comments/post/-/comment/', {context: '3',},)
	})

	it('passes non-reddit absolute URLs through unchanged (behaviour undefined — inputs are always Reddit-origin)', async () => {
		await getCommentContext('https://notreddit.com/r/test/comments/post/-/comment/',)

		expect(getRedditPageJson,).toHaveBeenCalledWith('https://notreddit.com/r/test/comments/post/-/comment/', {
			context: '3',
		},)
	})

	it('builds comment thread URLs', async () => {
		await getCommentThread('testsub', 'post', 'comment',)

		expect(getRedditPageJson,).toHaveBeenCalledWith('/r/testsub/comments/post/slug/comment', {limit: '1500',},)
	})

	it('builds more-comments URLs from a thread permalink (threadPermalink must not have a leading slash)', async () => {
		// getMoreComments prepends '/'; a leading slash on threadPermalink would produce '//r/...'
		await getMoreComments('r/test/comments/post/title/', 'comment',)

		expect(getRedditPageJson,).toHaveBeenCalledWith('/r/test/comments/post/title/comment', {limit: '1500',},)
	})

	it('fetches a comments page listing by pathname', async () => {
		await getCommentsPageListing('/r/test/comments/post/title',)

		expect(getRedditPageJson,).toHaveBeenCalledWith('/r/test/comments/post/title', {limit: '1500',},)
	})
})

describe('comments API writes', () => {
	it('throws typed Reddit API errors', async () => {
		apiOauthPOST.mockResolvedValueOnce(jsonResponse({json: {errors: [['BAD', 'nope', 'text',],],},},),)

		try {
			await postComment('t3_post', 'hello',)
			throw new Error('Expected postComment to reject',)
		} catch (error) {
			expect(error,).toBeInstanceOf(RedditApiError,)
			expect(error,).toMatchObject({errors: [['BAD', 'nope', 'text',],],},)
		}
	})

	it('returns posted comment identifiers', async () => {
		apiOauthPOST.mockResolvedValue(jsonResponse({
			json: {
				errors: [],
				data: {
					things: [{data: {id: 'abc123', name: 't1_abc123',},},],
				},
			},
		},),)

		await expect(postComment('t3_post', 'hello',),).resolves.toEqual({
			id: 'abc123',
			fullname: 't1_abc123',
		},)
	})

	it('throws on malformed posted comment payloads', async () => {
		apiOauthPOST.mockResolvedValue(jsonResponse({json: {errors: [], data: {things: [],},},},),)

		await expect(postComment('t3_post', 'hello',),).rejects.toThrow('posted comment ID',)
	})
})
