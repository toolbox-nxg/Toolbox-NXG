/** Tests for modqueue handler. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const registerMessageHandler = vi.hoisted(() => vi.fn())
const getModqueueThingNames = vi.hoisted(() => vi.fn())
const storageLocal = vi.hoisted(() => ({get: vi.fn(), set: vi.fn(),}))

vi.mock('webextension-polyfill', () => ({
	default: {storage: {local: storageLocal,},},
}),)
vi.mock('../../api/resources/modqueue', () => ({getModqueueThingNames,}),)
vi.mock('../messageHandling', () => ({registerMessageHandler,}),)

import {registerModqueueHandlers,} from './modqueue'

const cacheKey = 'toolbox-modqueue-cache'
const testsubCacheKey = `${cacheKey}.testsub`

beforeEach(() => {
	registerMessageHandler.mockClear()
	getModqueueThingNames.mockReset().mockResolvedValue(['t3_fresh',],)
	storageLocal.get.mockReset().mockImplementation(async (key: unknown,) => typeof key === 'object' ? key : {})
	storageLocal.set.mockReset().mockResolvedValue(undefined,)
},)

function registerAndGetHandler () {
	registerModqueueHandlers()
	return registerMessageHandler.mock.calls[0]![1]
}

describe('modqueue handler', () => {
	it('returns true when a fresh cache contains the thing', async () => {
		storageLocal.get.mockResolvedValue({
			[testsubCacheKey]: {lastRefresh: Date.now(), things: ['t3_hit',], refreshActive: false,},
		},)
		const handler = registerAndGetHandler()

		await expect(handler({subreddit: 'testsub', thingName: 't3_hit', thingTimestamp: 0,},),).resolves.toBe(true,)

		expect(getModqueueThingNames,).not.toHaveBeenCalled()
	})

	it('refreshes stale caches and checks the updated queue', async () => {
		storageLocal.get
			.mockResolvedValueOnce({[testsubCacheKey]: null,},)
			.mockResolvedValueOnce({
				[testsubCacheKey]: {
					lastRefresh: Date.now(),
					things: ['t3_fresh',],
					refreshActive: false,
				},
			},)
		const handler = registerAndGetHandler()

		await expect(handler({subreddit: 'testsub', thingName: 't3_fresh', thingTimestamp: 9999999999,},),).resolves
			.toBe(true,)

		expect(getModqueueThingNames,).toHaveBeenCalledWith('testsub',)
	})

	it('clears refreshActive after refresh failures', async () => {
		const error = vi.spyOn(console, 'error',).mockImplementation(() => {},)
		getModqueueThingNames.mockRejectedValue(new Error('network',),)
		storageLocal.get.mockImplementation(async (key: unknown,) => typeof key === 'object' ? key : {})
		const handler = registerAndGetHandler()

		await expect(handler({subreddit: 'testsub', thingName: 't3_missing', thingTimestamp: 9999999999,},),).resolves
			.toBe(false,)

		expect(storageLocal.set,).toHaveBeenLastCalledWith({
			[testsubCacheKey]: expect.objectContaining({refreshActive: false,},),
		},)
		error.mockRestore()
	})

	it('persists stale refreshActive lock cleanup even when cache is otherwise fresh', async () => {
		const now = Date.now()
		const staleRefreshActive = now - 31_000
		storageLocal.get.mockResolvedValue({
			[testsubCacheKey]: {
				lastRefresh: now,
				things: ['t3_hit',],
				refreshActive: staleRefreshActive,
			},
		},)
		const handler = registerAndGetHandler()

		await expect(handler({subreddit: 'testsub', thingName: 't3_hit', thingTimestamp: 0,},),).resolves.toBe(true,)

		expect(getModqueueThingNames,).not.toHaveBeenCalled()
		expect(storageLocal.set,).toHaveBeenCalledWith({
			[testsubCacheKey]: {
				lastRefresh: now,
				things: ['t3_hit',],
				refreshActive: false,
			},
		},)
	})

	it('uses independent storage keys for concurrent subreddit refreshes', async () => {
		getModqueueThingNames.mockImplementation(async (subreddit: string,) => [`t3_${subreddit.toLowerCase()}`,])
		const storedValues: Record<string, unknown> = {}
		storageLocal.get.mockImplementation(async (defaults: Record<string, unknown>,) => {
			const key = Object.keys(defaults,)[0]!
			return {[key]: storedValues[key] ?? defaults[key],}
		},)
		storageLocal.set.mockImplementation(async (value: Record<string, unknown>,) => {
			Object.assign(storedValues, value,)
		},)
		const handler = registerAndGetHandler()

		await Promise.all([
			handler({subreddit: 'TestSub', thingName: 't3_testsub', thingTimestamp: 9999999999,},),
			handler({subreddit: 'OtherSub', thingName: 't3_othersub', thingTimestamp: 9999999999,},),
		],)

		expect(storedValues,).toEqual({
			[`${cacheKey}.testsub`]: expect.objectContaining({things: ['t3_testsub',], refreshActive: false,},),
			[`${cacheKey}.othersub`]: expect.objectContaining({things: ['t3_othersub',], refreshActive: false,},),
		},)
	})
})
