/** Tests for modqueue API. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const apiOauthGetJSON = vi.hoisted(() => vi.fn())

vi.mock('../transport/http', () => ({apiOauthGetJSON,}),)

import {getModqueueThingNames,} from './modqueue'

describe('modqueue API', () => {
	beforeEach(() => {
		apiOauthGetJSON.mockReset().mockResolvedValue({
			data: {
				children: [
					{data: {name: 't3_first',},},
					{data: {name: 't1_second',},},
				],
			},
		},)
	},)

	it('fetches modqueue thing names', async () => {
		await expect(getModqueueThingNames('testsub',),).resolves.toEqual(['t3_first', 't1_second',],)

		expect(apiOauthGetJSON,).toHaveBeenCalledWith('/r/testsub/about/modqueue.json', {limit: '100',},)
	})

	it('passes the limit parameter', async () => {
		apiOauthGetJSON.mockResolvedValue({data: {children: [],},},)
		await getModqueueThingNames('testsub', 50,)
		expect(apiOauthGetJSON,).toHaveBeenCalledWith('/r/testsub/about/modqueue.json', {limit: '50',},)
	})
})
