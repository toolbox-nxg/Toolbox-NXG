/** Tests for modmail API. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const apiOauthGetJSON = vi.hoisted(() => vi.fn())
const apiOauthPOST = vi.hoisted(() => vi.fn())
const apiOauthPostJSON = vi.hoisted(() => vi.fn())

vi.mock('../transport/http', () => ({apiOauthGetJSON, apiOauthPOST, apiOauthPostJSON,}),)

import {RedditApiError,} from '../parsers/redditMutation'
import {archiveModmail, getModmailParticipant, getModmailUnreadCount, sendModmail,} from './modmail'
import {muteUser, unmuteUser,} from './relationships'

function jsonResponse (body: unknown,): Response {
	return new Response(JSON.stringify(body,), {headers: {'content-type': 'application/json',},},)
}

beforeEach(() => {
	apiOauthGetJSON.mockReset().mockResolvedValue({archived: 1, new: 2,},)
	apiOauthPOST.mockReset().mockImplementation(() => Promise.resolve(jsonResponse({},),))
	apiOauthPostJSON.mockReset().mockResolvedValue({conversation: {id: 'conv',},},)
},)

describe('modmail API', () => {
	it('sends modmail conversations with optional internal recipients omitted', async () => {
		await expect(sendModmail({
			subreddit: 'testsub',
			to: null,
			subject: 'Subject',
			body: 'Body',
			isAuthorHidden: true,
		},),).resolves.toEqual({conversation: {id: 'conv',},},)

		expect(apiOauthPostJSON,).toHaveBeenCalledWith('/api/mod/conversations', {
			srName: 'testsub',
			to: undefined,
			subject: 'Subject',
			body: 'Body',
			isAuthorHidden: 'true',
		},)
	})

	it('archives conversations and fetches unread counts', async () => {
		await archiveModmail('conv',)
		await expect(getModmailUnreadCount(),).resolves.toEqual({archived: 1, new: 2,},)

		expect(apiOauthPOST,).toHaveBeenCalledWith('/api/mod/conversations/conv/archive',)
		expect(apiOauthGetJSON,).toHaveBeenCalledWith('/api/mod/conversations/unread/count',)
	})

	it('reads participant info from the conversation response user field', async () => {
		const participant = {recentPosts: {}, recentComments: {}, recentConvos: {},}
		apiOauthGetJSON.mockResolvedValueOnce({user: participant,},)

		await expect(getModmailParticipant('conv',),).resolves.toBe(participant,)
		expect(apiOauthGetJSON,).toHaveBeenCalledWith('/api/mod/conversations/conv',)
	})

	it('returns an empty participant when the conversation has no user', async () => {
		apiOauthGetJSON.mockResolvedValueOnce({},)

		await expect(getModmailParticipant('conv',),).resolves.toEqual({},)
	})

	it('mutes and unmutes users through OAuth with truncated notes', async () => {
		await expect(muteUser({user: 'alice', subreddit: 'testsub', note: 'n'.repeat(305,), duration: 7,},),)
			.resolves.toBeUndefined()
		await expect(unmuteUser('testsub', 'alice',),).resolves.toBeUndefined()

		expect(apiOauthPOST.mock.calls,).toContainEqual(['/api/friend', {
			api_type: 'json',
			type: 'muted',
			name: 'alice',
			r: 'testsub',
			note: 'n'.repeat(300,),
			duration: '7',
		},],)
		expect(apiOauthPOST.mock.calls,).toContainEqual(['/api/unfriend', {
			api_type: 'json',
			type: 'muted',
			name: 'alice',
			r: 'testsub',
		},],)
	})

	it('throws typed Reddit API errors from mute actions', async () => {
		apiOauthPOST.mockResolvedValueOnce(jsonResponse({json: {errors: [['MUTE_ERROR', 'no mute', 'name',],],},},),)

		await expect(muteUser({user: 'alice', subreddit: 'testsub',},),).rejects.toBeInstanceOf(RedditApiError,)
	})
})
