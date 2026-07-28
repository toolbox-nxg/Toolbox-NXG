/** Tests for the native removal reasons API. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

const apiOauthGetJSON = vi.hoisted(() => vi.fn())
const apiOauthPOST = vi.hoisted(() => vi.fn())
const getCache = vi.hoisted(() => vi.fn())
const setCache = vi.hoisted(() => vi.fn())
vi.mock('../transport/http', () => ({apiOauthGetJSON, apiOauthPOST,}),)
vi.mock('../../framework/moduleIds', () => ({utils: 'utils',}),)
vi.mock('../../util/persistence/cache', () => ({getCache, setCache,}),)

import {CaptureSuppressedError, setCaptureActivePredicate, setPageSubreddit,} from '../../util/infra/captureGuard'
import {applyNativeRemovalReason, clearNativeReasonsCache, getNativeRemovalReasons,} from './removalReasons'

function jsonResponse (body: unknown,): Response {
	return new Response(JSON.stringify(body,), {headers: {'content-type': 'application/json',},},)
}

beforeEach(() => {
	clearNativeReasonsCache()
	apiOauthGetJSON.mockReset()
	getCache.mockReset().mockImplementation((_moduleId: unknown, _key: unknown, fallback: unknown,) =>
		Promise.resolve(fallback,)
	)
	setCache.mockReset().mockResolvedValue(undefined,)
	apiOauthPOST.mockReset().mockImplementation(() =>
		Promise.resolve(jsonResponse({json: {errors: [],}, success: true,},),)
	)
},)

describe('getNativeRemovalReasons', () => {
	it('returns reasons in the configured `order`', async () => {
		apiOauthGetJSON.mockResolvedValueOnce({
			data: {
				b: {id: 'b', title: 'Second', message: 'msg b',},
				a: {id: 'a', title: 'First', message: 'msg a',},
			},
			order: ['a', 'b',],
		},)

		await expect(getNativeRemovalReasons('somesub',),).resolves.toEqual([
			{id: 'a', title: 'First', message: 'msg a',},
			{id: 'b', title: 'Second', message: 'msg b',},
		],)
		expect(apiOauthGetJSON,).toHaveBeenCalledWith('/api/v1/somesub/removal_reasons',)
	})

	it('falls back to insertion order when `order` is missing or empty', async () => {
		apiOauthGetJSON.mockResolvedValueOnce({
			data: {a: {id: 'a', title: 'First', message: 'msg a',},},
			order: [],
		},)

		await expect(getNativeRemovalReasons('somesub',),).resolves.toEqual([
			{id: 'a', title: 'First', message: 'msg a',},
		],)
	})

	it('drops ids in `order` with no matching entry', async () => {
		apiOauthGetJSON.mockResolvedValueOnce({
			data: {a: {id: 'a', title: 'First', message: 'msg a',},},
			order: ['a', 'stale',],
		},)

		await expect(getNativeRemovalReasons('somesub',),).resolves.toEqual([
			{id: 'a', title: 'First', message: 'msg a',},
		],)
	})

	it('returns an empty array when no reasons are configured', async () => {
		apiOauthGetJSON.mockResolvedValueOnce({data: {}, order: [],},)
		await expect(getNativeRemovalReasons('somesub',),).resolves.toEqual([],)
	})
})

describe('applyNativeRemovalReason', () => {
	it('posts the reason association with the item id', async () => {
		await expect(applyNativeRemovalReason({itemId: 't3_post', reasonId: 'r1',},),).resolves.toBeUndefined()

		expect(apiOauthPOST.mock.calls,).toEqual([
			[
				'/api/v1/modactions/removal_reasons',
				{type: 'json', data: {item_ids: ['t3_post',], reason_id: 'r1',},},
			],
		],)
	})

	it('includes the mod note only when provided', async () => {
		await applyNativeRemovalReason({itemId: 't3_post', reasonId: 'r1', modNote: 'context',},)

		expect(apiOauthPOST,).toHaveBeenCalledWith('/api/v1/modactions/removal_reasons', {
			type: 'json',
			data: {item_ids: ['t3_post',], reason_id: 'r1', mod_note: 'context',},
		},)
	})
})

describe('applyNativeRemovalReason training-mode guard', () => {
	afterEach(() => {
		setCaptureActivePredicate(() => false)
		setPageSubreddit(undefined,)
	},)

	it('blocks a sandboxed trainee without performing the action', () => {
		setCaptureActivePredicate((sub,) => sub === 'sandboxed')
		setPageSubreddit('sandboxed',)

		expect(() => applyNativeRemovalReason({itemId: 't3_post', reasonId: 'r1',},)).toThrow(CaptureSuppressedError,)
		expect(apiOauthPOST,).not.toHaveBeenCalled()
	})
})

describe('getNativeRemovalReasons caching', () => {
	const reasons = {data: {a: {id: 'a', title: 'First', message: 'msg a',},}, order: ['a',],}

	it('serves a second call from memory without touching storage or the network', async () => {
		apiOauthGetJSON.mockResolvedValueOnce(reasons,)

		await getNativeRemovalReasons('somesub',)
		getCache.mockClear()
		await expect(getNativeRemovalReasons('somesub',),).resolves.toHaveLength(1,)

		expect(apiOauthGetJSON,).toHaveBeenCalledOnce()
		expect(getCache,).not.toHaveBeenCalled()
	})

	it('serves a persisted hit without fetching', async () => {
		getCache.mockResolvedValue({somesub: [{id: 'a', title: 'Stored', message: 'stored',},],},)

		await expect(getNativeRemovalReasons('somesub',),).resolves.toEqual([
			{id: 'a', title: 'Stored', message: 'stored',},
		],)
		expect(apiOauthGetJSON,).not.toHaveBeenCalled()
	})

	it('writes a fetched list into the persisted cache alongside other subreddits', async () => {
		getCache.mockResolvedValue({othersub: [],},)
		apiOauthGetJSON.mockResolvedValueOnce(reasons,)

		await getNativeRemovalReasons('somesub',)

		expect(setCache,).toHaveBeenCalledWith('utils', 'nativeRemovalReasons', {
			othersub: [],
			somesub: [{id: 'a', title: 'First', message: 'msg a',},],
		},)
	})

	it('coalesces concurrent callers for the same subreddit onto one fetch', async () => {
		apiOauthGetJSON.mockResolvedValue(reasons,)

		const [first, second,] = await Promise.all([
			getNativeRemovalReasons('somesub',),
			getNativeRemovalReasons('somesub',),
		],)

		expect(apiOauthGetJSON,).toHaveBeenCalledOnce()
		expect(first,).toEqual(second,)
	})

	it('fetches different subreddits independently', async () => {
		apiOauthGetJSON.mockResolvedValue(reasons,)

		await Promise.all([getNativeRemovalReasons('one',), getNativeRemovalReasons('two',),],)

		expect(apiOauthGetJSON.mock.calls.map(([path,],) => path),).toEqual([
			'/api/v1/one/removal_reasons',
			'/api/v1/two/removal_reasons',
		],)
	})

	it('does not cache a failed fetch, so the next call retries', async () => {
		apiOauthGetJSON.mockRejectedValueOnce(new Error('boom',),)
		await expect(getNativeRemovalReasons('somesub',),).rejects.toThrow('boom',)

		apiOauthGetJSON.mockResolvedValueOnce(reasons,)
		await expect(getNativeRemovalReasons('somesub',),).resolves.toHaveLength(1,)
		expect(setCache,).toHaveBeenCalledOnce()
	})

	it('bypasses both layers when asked for a fresh read', async () => {
		getCache.mockResolvedValue({somesub: [{id: 'a', title: 'Stored', message: 'stored',},],},)
		apiOauthGetJSON.mockResolvedValue(reasons,)

		await getNativeRemovalReasons('somesub',)
		await expect(getNativeRemovalReasons('somesub', {fresh: true,},),).resolves.toEqual([
			{id: 'a', title: 'First', message: 'msg a',},
		],)
		expect(apiOauthGetJSON,).toHaveBeenCalledOnce()
	})

	it('refetches after the subreddit is cleared from the cache', async () => {
		apiOauthGetJSON.mockResolvedValue(reasons,)

		await getNativeRemovalReasons('somesub',)
		clearNativeReasonsCache('somesub',)
		getCache.mockResolvedValue({},)
		await getNativeRemovalReasons('somesub',)

		expect(apiOauthGetJSON,).toHaveBeenCalledTimes(2,)
	})
})
