/** Tests for flair API. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

const apiOauthGetJSON = vi.hoisted(() => vi.fn())
const apiOauthPOST = vi.hoisted(() => vi.fn())
const apiOauthPostJSON = vi.hoisted(() => vi.fn())

vi.mock('../transport/http', () => ({apiOauthGetJSON, apiOauthPOST, apiOauthPostJSON,}),)

import {CaptureSuppressedError, setCaptureActivePredicate,} from '../../util/infra/captureGuard'
import {RedditApiError,} from '../parsers/redditMutation'
import {flairPost, flairUser, getFlairSelector, getLinkFlairTemplates, getUserFlairTemplates,} from './flair'

function jsonResponse (body: unknown,): Response {
	return new Response(JSON.stringify(body,), {headers: {'content-type': 'application/json',},},)
}

beforeEach(() => {
	apiOauthGetJSON.mockReset().mockResolvedValue([{id: 'template',},],)
	apiOauthPOST.mockReset().mockImplementation(() => Promise.resolve(jsonResponse({},),))
	apiOauthPostJSON.mockReset().mockResolvedValue({choices: [],},)
},)

afterEach(() => {
	setCaptureActivePredicate(() => false)
},)

describe('flair API', () => {
	it('fetches user and link flair templates through OAuth endpoints', async () => {
		await expect(getUserFlairTemplates('testsub',),).resolves.toEqual([{id: 'template',},],)
		await expect(getLinkFlairTemplates('testsub',),).resolves.toEqual([{id: 'template',},],)

		expect(apiOauthGetJSON.mock.calls,).toEqual([
			['/r/testsub/api/user_flair_v2',],
			['/r/testsub/api/link_flair_v2',],
		],)
	})

	it('fetches flair selector data for a user via POST JSON', async () => {
		const result = await getFlairSelector('testsub', 'alice',)

		expect(result,).toEqual({choices: [],},)
		// Sanitization of user-controlled flair text is guaranteed by apiOauthPostJSON
		expect(apiOauthPostJSON,).toHaveBeenCalledWith('/r/testsub/api/flairselector', {name: 'alice',},)
	})

	it('sets post and user flair through OAuth', async () => {
		await expect(
			flairPost({
				postLink: 't3_post',
				subreddit: 'testsub',
				text: 'Text',
				cssClass: 'css',
				templateID: 'template_id',
			},),
		).resolves.toBeUndefined()
		await expect(flairUser({user: 'alice', subreddit: 'testsub', text: 'User Text',},),).resolves.toBeUndefined()

		expect(apiOauthPOST.mock.calls,).toEqual([
			['/api/selectflair', {
				api_type: 'json',
				link: 't3_post',
				text: 'Text',
				css_class: 'css',
				flair_template_id: 'template_id',
				r: 'testsub',
			},],
			['/api/selectflair', {
				api_type: 'json',
				name: 'alice',
				r: 'testsub',
				text: 'User Text',
				css_class: undefined,
				flair_template_id: undefined,
			},],
		],)
	})

	it('blocks setting user and post flair for a sandboxed trainee without performing them', () => {
		setCaptureActivePredicate((sub,) => sub === 'sandboxed')

		expect(() => flairUser({user: 'alice', subreddit: 'sandboxed',},)).toThrow(CaptureSuppressedError,)
		expect(() => flairPost({postLink: 't3_post', subreddit: 'sandboxed',},)).toThrow(CaptureSuppressedError,)
		expect(apiOauthPOST,).not.toHaveBeenCalled()
	})

	it('throws typed Reddit API errors from flair setters', async () => {
		apiOauthPOST.mockResolvedValueOnce(jsonResponse({json: {errors: [['BAD_FLAIR', 'no flair', 'flair',],],},},),)

		await expect(flairUser({user: 'alice', subreddit: 'testsub',},),).rejects.toBeInstanceOf(RedditApiError,)
	})
})
