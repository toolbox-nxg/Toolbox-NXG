/** Tests for things API. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

const apiOauthGetJSON = vi.hoisted(() => vi.fn())
const apiOauthPOST = vi.hoisted(() => vi.fn())
vi.mock('../transport/http', () => ({apiOauthGetJSON, apiOauthPOST,}),)

import {CaptureSuppressedError, setCaptureActivePredicate, setPageSubreddit,} from '../../util/infra/captureGuard'
import {
	approveThing,
	distinguishThing,
	getInfo,
	getInfoBulk,
	getThingInfo,
	ignoreReports,
	lock,
	markOver18,
	removeThing,
	sendOfficialRemovalMessage,
	stickyThread,
	unlock,
	unMarkOver18,
	unstickyThread,
} from './things'

function jsonResponse (body: unknown,): Response {
	return new Response(JSON.stringify(body,), {headers: {'content-type': 'application/json',},},)
}

beforeEach(() => {
	apiOauthPOST.mockReset().mockImplementation(() =>
		Promise.resolve(jsonResponse({json: {errors: [],}, success: true,},),)
	)
},)

describe('things API', () => {
	it('posts common moderation actions through OAuth and resolves void', async () => {
		await expect(approveThing('t3_post',),).resolves.toBeUndefined()
		await expect(removeThing('t3_post', true,),).resolves.toBeUndefined()

		expect(apiOauthPOST.mock.calls,).toEqual([
			['/api/approve', {id: 't3_post',},],
			['/api/remove', {id: 't3_post', spam: 'true',},],
		],)
	})

	it('posts simple moderation actions and resolves void', async () => {
		await expect(ignoreReports('t3_post',),).resolves.toBeUndefined()
		await expect(markOver18('t3_post',),).resolves.toBeUndefined()
		await expect(unMarkOver18('t3_post',),).resolves.toBeUndefined()
		await expect(unlock('t1_comment',),).resolves.toBeUndefined()

		expect(apiOauthPOST.mock.calls,).toEqual([
			['/api/ignore_reports', {id: 't3_post',},],
			['/api/marknsfw', {id: 't3_post',},],
			['/api/unmarknsfw', {id: 't3_post',},],
			['/api/unlock', {id: 't1_comment',},],
		],)
	})

	it('uses OAuth for lock and sticky actions and resolves void', async () => {
		await expect(lock('t1_comment',),).resolves.toBeUndefined()
		await expect(stickyThread('t3_post', 2,),).resolves.toBeUndefined()
		await expect(unstickyThread('t3_post',),).resolves.toBeUndefined()

		expect(apiOauthPOST,).toHaveBeenCalledWith('/api/lock', {id: 't1_comment',},)
		expect(apiOauthPOST,).toHaveBeenCalledWith('/api/set_subreddit_sticky', {
			id: 't3_post',
			num: '2',
			state: 'true',
		},)
		expect(apiOauthPOST,).toHaveBeenCalledWith('/api/set_subreddit_sticky', {
			id: 't3_post',
			num: undefined,
			state: 'false',
		},)
	})

	it('requires success confirmation for distinguish actions', async () => {
		apiOauthPOST.mockResolvedValueOnce(jsonResponse({json: {errors: [],}, success: true,},),)
		await expect(distinguishThing('t1_comment', true,),).resolves.toBeUndefined()

		apiOauthPOST.mockResolvedValueOnce(jsonResponse({json: {errors: [],}, success: false,},),)
		await expect(distinguishThing('t1_comment', true,),).rejects.toThrow('confirm success',)
	})

	it('selects official removal message endpoints by fullname prefix', async () => {
		await sendOfficialRemovalMessage({fullname: 't1_comment', message: 'removed', lockComment: true,},)
		await sendOfficialRemovalMessage({fullname: 't3_post', message: 'removed',},)

		expect(apiOauthPOST.mock.calls,).toEqual([
			[
				'/api/v1/modactions/removal_comment_message',
				{
					type: 'json',
					data: {
						item_id: ['t1_comment',],
						message: 'removed',
						title: 'removal reason through Toolbox-NXG',
						type: 'public_as_subreddit',
						lock_comment: true,
					},
				},
			],
			[
				'/api/v1/modactions/removal_link_message',
				{
					type: 'json',
					data: {
						item_id: ['t3_post',],
						message: 'removed',
						title: 'removal reason through Toolbox-NXG',
						type: 'public_as_subreddit',
						lock_comment: false,
					},
				},
			],
		],)
	})
})

describe('things API training-mode guard', () => {
	afterEach(() => {
		setCaptureActivePredicate(() => false)
		setPageSubreddit(undefined,)
	},)

	it('blocks NSFW and ignore-reports actions for a sandboxed trainee without performing them', () => {
		setCaptureActivePredicate((sub,) => sub === 'sandboxed')
		setPageSubreddit('sandboxed',)

		expect(() => ignoreReports('t3_post',)).toThrow(CaptureSuppressedError,)
		expect(() => markOver18('t3_post',)).toThrow(CaptureSuppressedError,)
		expect(() => unMarkOver18('t3_post',)).toThrow(CaptureSuppressedError,)
		expect(apiOauthPOST,).not.toHaveBeenCalled()
	})

	it('blocks sticky and unsticky for a sandboxed trainee without performing them', async () => {
		setCaptureActivePredicate((sub,) => sub === 'sandboxed')
		setPageSubreddit('sandboxed',)

		await expect(stickyThread('t3_post', 1,),).rejects.toThrow(CaptureSuppressedError,)
		await expect(unstickyThread('t3_post',),).rejects.toThrow(CaptureSuppressedError,)
		expect(apiOauthPOST,).not.toHaveBeenCalled()
	})
})

describe('info API', () => {
	beforeEach(() => {
		apiOauthGetJSON.mockReset()
	},)

	it('fetches thing info within a subreddit context', async () => {
		apiOauthGetJSON.mockResolvedValue({data: {children: [{kind: 't3', data: {id: 'abc',},},],},},)

		await expect(getThingInfo('testsub', 't3_abc',),).resolves.toEqual({
			data: {children: [{kind: 't3', data: {id: 'abc',},},],},
		},)
		expect(apiOauthGetJSON,).toHaveBeenCalledWith('/r/testsub/api/info.json', {id: 't3_abc',},)
	})

	it('returns an empty array without making a request when called with no fullnames', async () => {
		await expect(getInfoBulk([],),).resolves.toEqual([],)
		expect(apiOauthGetJSON,).not.toHaveBeenCalled()
	})

	it('coalesces concurrent getInfo calls into one request and resolves each with its matching child', async () => {
		vi.useFakeTimers()
		try {
			apiOauthGetJSON.mockResolvedValue({
				data: {
					children: [
						{kind: 't1', data: {id: 'abc', name: 't1_abc',},},
						{kind: 't3', data: {id: 'def', name: 't3_def',},},
					],
				},
			},)

			const p1 = getInfo('t1_abc',)
			const p2 = getInfo('t3_def',)

			// Flush the 100ms debounce timer and all resulting microtasks
			await vi.runAllTimersAsync()

			await expect(p1,).resolves.toEqual({kind: 't1', data: {id: 'abc', name: 't1_abc',},},)
			await expect(p2,).resolves.toEqual({kind: 't3', data: {id: 'def', name: 't3_def',},},)
			expect(apiOauthGetJSON,).toHaveBeenCalledOnce()
			expect(apiOauthGetJSON,).toHaveBeenCalledWith('/api/info.json', {
				raw_json: '1',
				id: 't1_abc,t3_def',
			},)
		} finally {
			vi.useRealTimers()
		}
	})

	it('rejects callers for things Reddit omits and resolves callers for things returned', async () => {
		vi.useFakeTimers()
		try {
			// Only t3_returned is present in the response; t1_missing was deleted/inaccessible
			apiOauthGetJSON.mockResolvedValue({
				data: {children: [{kind: 't3', data: {id: 'returned', name: 't3_returned',},},],},
			},)

			const pMissing = getInfo('t1_missing',)
			const pReturned = getInfo('t3_returned',)

			const checkMissing = expect(pMissing,).rejects.toThrow('No result returned for item: t1_missing',)
			await vi.runAllTimersAsync()

			await checkMissing
			await expect(pReturned,).resolves.toEqual({kind: 't3', data: {id: 'returned', name: 't3_returned',},},)
		} finally {
			vi.useRealTimers()
		}
	})

	it('fetches bulk thing info through the sanitized Reddit API boundary', async () => {
		apiOauthGetJSON.mockResolvedValue({
			data: {
				children: [{kind: 't1', data: {id: 'abc',},},],
			},
		},)

		await expect(getInfoBulk(['t1_abc', 't3_def',],),).resolves.toEqual([{kind: 't1', data: {id: 'abc',},},],)
		expect(apiOauthGetJSON,).toHaveBeenCalledWith('/api/info.json', {
			raw_json: '1',
			id: 't1_abc,t3_def',
		},)
	})
})
