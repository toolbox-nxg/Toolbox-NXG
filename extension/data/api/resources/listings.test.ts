/** Tests for listing API helpers. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const apiOauthGetJSON = vi.hoisted(() => vi.fn())

vi.mock('../transport/http', () => ({apiOauthGetJSON,}),)

import {getAbsoluteRedditJson, getRedditEndpointJson, getRedditPageJson,} from './listings'

describe('listing API helpers', () => {
	beforeEach(() => {
		apiOauthGetJSON.mockReset().mockResolvedValue({},)
	},)

	it('fetches an explicit Reddit endpoint', async () => {
		await getRedditEndpointJson('/r/test/about/log.json?limit=100',)

		expect(apiOauthGetJSON,).toHaveBeenCalledWith('/r/test/about/log.json?limit=100', {raw_json: '1',},)
	})

	it('fetches current-page style JSON from pathname and query params', async () => {
		await getRedditPageJson('/r/test/about/log', {after: 't1_abc',},)

		expect(apiOauthGetJSON,).toHaveBeenCalledWith('/r/test/about/log.json', {raw_json: '1', after: 't1_abc',},)
	})

	it('fetches absolute Reddit JSON through absolute mode', async () => {
		await getAbsoluteRedditJson('https://www.reddit.com/r/test/comments/post.json',)

		expect(apiOauthGetJSON,).toHaveBeenCalledWith('https://www.reddit.com/r/test/comments/post.json', {
			raw_json: '1',
		}, {
			absolute: true,
		},)
	})
})
