/** Tests for postRedditApi. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const apiOauthPOST = vi.hoisted(() => vi.fn())

vi.mock('../transport/http', () => ({apiOauthPOST,}),)

import {parseRedditApiResponse, postRedditApi, postRedditApiVoid, RedditApiError,} from './redditMutation'

function jsonResponse (body: unknown,): Response {
	return new Response(JSON.stringify(body,), {headers: {'content-type': 'application/json',},},)
}

beforeEach(() => {
	apiOauthPOST.mockReset().mockImplementation(() =>
		Promise.resolve(jsonResponse({json: {errors: [], data: {id: 'abc',},},},),)
	)
},)

describe('postRedditApi', () => {
	it('POSTs and returns extracted data', async () => {
		await expect(postRedditApi('/api/test', {key: 'val',},),).resolves.toEqual({id: 'abc',},)
		expect(apiOauthPOST,).toHaveBeenCalledWith('/api/test', {key: 'val',},)
	})

	it('applies a validator to the extracted data', async () => {
		const validator = (data: {id: string} | undefined,) => data!.id
		await expect(postRedditApi('/api/test', undefined, validator,),).resolves.toBe('abc',)
	})

	it('throws RedditApiError when the response contains errors', async () => {
		apiOauthPOST.mockResolvedValueOnce(jsonResponse({json: {errors: [['BAD', 'nope',],],},},),)
		await expect(postRedditApi('/api/test',),).rejects.toMatchObject({name: 'RedditApiError',},)
	})
})

describe('postRedditApiVoid', () => {
	it('POSTs and resolves void regardless of response data', async () => {
		await expect(postRedditApiVoid('/api/test', {key: 'val',},),).resolves.toBeUndefined()
		expect(apiOauthPOST,).toHaveBeenCalledWith('/api/test', {key: 'val',},)
	})
})

describe('reddit mutation parser', () => {
	it('returns nested data from successful Reddit API responses', async () => {
		await expect(parseRedditApiResponse<{id: string}>(jsonResponse({
			json: {errors: [], data: {id: 'abc',},},
		},),),).resolves.toEqual({id: 'abc',},)
	})

	it('throws typed errors from Reddit API error tuples', async () => {
		await expect(parseRedditApiResponse(jsonResponse({
			json: {errors: [['BAD', 'nope', 'field',],],},
		},),),).rejects.toMatchObject(
			{
				name: 'RedditApiError',
				errors: [['BAD', 'nope', 'field',],],
			} satisfies Partial<RedditApiError>,
		)
	})

	it('can require explicit success confirmation', async () => {
		await expect(parseRedditApiResponse(jsonResponse({json: {errors: [],}, success: true,},), {
			requireSuccess: true,
		},),).resolves.toBeUndefined()
		await expect(parseRedditApiResponse(jsonResponse({json: {errors: [],}, success: false,},), {
			requireSuccess: true,
		},),).rejects.toThrow('confirm success',)
	})

	it('runs a validator on the extracted data and returns the result', async () => {
		const validator = (data: {id: string} | undefined,): {id: string} => {
			if (!data?.id) {
				throw new Error('missing id',)
			}
			return data
		}
		await expect(parseRedditApiResponse<{id: string}, {id: string}>(
			jsonResponse({json: {errors: [], data: {id: 'abc',},},},),
			{validator,},
		),).resolves.toEqual({id: 'abc',},)
		await expect(parseRedditApiResponse<{id: string}, {id: string}>(
			jsonResponse({json: {errors: [], data: null,},},),
			{validator,},
		),).rejects.toThrow('missing id',)
	})
})
