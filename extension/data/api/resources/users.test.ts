/** Tests for users API. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const apiOauthGetJSON = vi.hoisted(() => vi.fn())

vi.mock('../transport/http', () => ({apiOauthGetJSON,}),)

import {aboutUser, getUserActivity, getUserComments, getUserListingPage, getUserSubmissions,} from './users'

beforeEach(() => {
	apiOauthGetJSON.mockReset()
},)

describe('users API', () => {
	it('fetches user about info', async () => {
		apiOauthGetJSON.mockResolvedValue({name: 'alice', id: 't2_a',},)

		await expect(aboutUser('alice',),).resolves.toEqual({name: 'alice', id: 't2_a',},)
		expect(apiOauthGetJSON,).toHaveBeenCalledWith('/user/alice/about.json',)
	})

	it('fetches all submission pages until there is no after cursor', async () => {
		apiOauthGetJSON
			.mockResolvedValueOnce({data: {children: [{id: 'a',},], after: 'after_a',},},)
			.mockResolvedValueOnce({data: {children: [{id: 'b',},], after: null,},},)

		await expect(getUserSubmissions('alice',),).resolves.toEqual([{id: 'a',}, {id: 'b',},],)
		expect(apiOauthGetJSON.mock.calls,).toEqual([
			['/user/alice/submitted.json', {after: undefined, sort: 'new', limit: '100',},],
			['/user/alice/submitted.json', {after: 'after_a', sort: 'new', limit: '100',},],
		],)
	})

	it('throws a shadowban-style error when submissions cannot be loaded', async () => {
		const original = new Error('not found',)
		apiOauthGetJSON.mockRejectedValue(original,)

		const error = await getUserSubmissions('alice',).catch((e,) => e)
		expect(error,).toMatchObject({message: 'unable to load userdata; shadowbanned?',},)
		expect(error.cause,).toBe(original,)
	})

	it('fetches comments until maxCount is reached', async () => {
		apiOauthGetJSON
			.mockResolvedValueOnce({data: {children: [{id: 'a',}, {id: 'b',},], after: 'after_a',},},)
			.mockResolvedValueOnce({data: {children: [{id: 'c',},], after: null,},},)

		await expect(getUserComments('alice', 2,),).resolves.toEqual([{id: 'a',}, {id: 'b',},],)
		expect(apiOauthGetJSON,).toHaveBeenCalledTimes(1,)
	})

	it('fetches one-page listing and activity responses', async () => {
		apiOauthGetJSON
			.mockResolvedValueOnce({data: {children: [],},},)
			.mockResolvedValueOnce({data: {children: [{id: 'activity',},],},},)

		await expect(getUserListingPage('alice', 'overview', {limit: '10',},),).resolves.toEqual({
			data: {children: [],},
		},)
		await expect(getUserActivity('alice', {limit: '1',},),).resolves.toEqual({
			data: {children: [{id: 'activity',},],},
		},)
		expect(apiOauthGetJSON.mock.calls,).toEqual([
			['/user/alice/overview.json', {limit: '10',},],
			['/user/alice.json', {limit: '1',},],
		],)
	})
})
