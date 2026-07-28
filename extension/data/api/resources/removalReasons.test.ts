/** Tests for the native removal reasons API. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

const apiOauthGetJSON = vi.hoisted(() => vi.fn())
const apiOauthPOST = vi.hoisted(() => vi.fn())
vi.mock('../transport/http', () => ({apiOauthGetJSON, apiOauthPOST,}),)

import {CaptureSuppressedError, setCaptureActivePredicate, setPageSubreddit,} from '../../util/infra/captureGuard'
import {applyNativeRemovalReason, getNativeRemovalReasons,} from './removalReasons'

function jsonResponse (body: unknown,): Response {
	return new Response(JSON.stringify(body,), {headers: {'content-type': 'application/json',},},)
}

beforeEach(() => {
	apiOauthGetJSON.mockReset()
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
