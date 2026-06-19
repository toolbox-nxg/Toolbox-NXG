/** Tests for submissions API. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const apiOauthPOST = vi.hoisted(() => vi.fn())

vi.mock('../../util/infra/logging', () => ({default: () => ({debug: vi.fn(), error: vi.fn(),}),}),)
vi.mock('../transport/http', () => ({apiOauthPOST,}),)

import {postLink,} from './submissions'

function jsonResponse (body: unknown,): Response {
	return new Response(JSON.stringify(body,), {headers: {'content-type': 'application/json',},},)
}

beforeEach(() => {
	apiOauthPOST.mockReset().mockImplementation(() => Promise.resolve(jsonResponse({json: {errors: [],},},),))
},)

describe('submissions API', () => {
	it('returns posted link identifiers', async () => {
		apiOauthPOST.mockResolvedValue(jsonResponse({
			json: {
				errors: [],
				data: {
					name: 't3_link',
					url: 'https://reddit.com/r/test/comments/link',
				},
			},
		},),)

		await expect(postLink('testsub', 'https://example.com', 'Example',),).resolves.toEqual({
			name: 't3_link',
			url: 'https://reddit.com/r/test/comments/link',
		},)
	})

	it('throws on malformed posted link payloads', async () => {
		apiOauthPOST.mockResolvedValue(jsonResponse({json: {errors: [], data: {name: 't3_link',},},},),)

		await expect(postLink('testsub', 'https://example.com', 'Example',),).rejects.toThrow('posted link details',)
	})
})
