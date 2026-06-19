/** Tests for cache handlers. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

import {makeHandlerFinder, mockJwtCookie,} from './test-helpers'

const registerMessageHandler = vi.hoisted(() => vi.fn())
const cookies = vi.hoisted(() => ({get: vi.fn(),}))
const storageLocal = vi.hoisted(() => ({get: vi.fn(), set: vi.fn(), remove: vi.fn(),}))
const storageOnChanged = vi.hoisted(() => ({addListener: vi.fn(),}))

vi.mock('webextension-polyfill', () => ({
	default: {cookies, storage: {local: storageLocal, onChanged: storageOnChanged,},},
}),)
vi.mock('../messageHandling', () => ({registerMessageHandler,}),)

import {registerCacheHandlers,} from './cache'

const handlerFor = makeHandlerFinder(registerMessageHandler,)

function sender () {
	return {tab: {url: 'https://old.reddit.com/r/test', cookieStoreId: 'store',},} as any
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(new Date('2024-01-01T00:00:00Z',),)
	registerMessageHandler.mockClear()
	cookies.get.mockReset().mockResolvedValue(mockJwtCookie({sub: 't2_user',},),)
	storageLocal.get.mockReset().mockImplementation(async (key?: unknown,) => typeof key === 'object' ? key : {})
	storageLocal.set.mockReset().mockResolvedValue(undefined,)
	storageLocal.remove.mockReset().mockResolvedValue(undefined,)
},)

describe('cache handlers', () => {
	it('sets user-scoped cache values with timestamps', async () => {
		registerCacheHandlers()

		await handlerFor('toolbox-cache',)(
			{method: 'set', storageKey: 'Utils.example', inputValue: {ok: true,},},
			sender(),
		)

		expect(storageLocal.set,).toHaveBeenCalledWith({
			'TBCache.user.Utils.example': {
				value: {ok: true,},
				timeStamp: Date.now(),
			},
		},)
	})

	it('returns stored cache values', async () => {
		storageLocal.get.mockImplementation(async (key: unknown,) => {
			if (typeof key === 'object') { return key }
			if (key === 'TBCache.user.Utils.example') {
				return {'TBCache.user.Utils.example': {value: 'cached', timeStamp: Date.now(),},}
			}
			return {}
		},)
		registerCacheHandlers()

		await expect(
			handlerFor('toolbox-cache',)({
				method: 'get',
				storageKey: 'Utils.example',
				inputValue: 'default',
			}, sender(),),
		).resolves.toEqual({value: 'cached',},)
	})

	it('expires known short-cache values using configured TTL', async () => {
		storageLocal.get.mockImplementation(async (key: unknown,) => {
			if (typeof key === 'object') { return key }
			if (key === 'TBCache.user.Utils.noteCache') {
				return {'TBCache.user.Utils.noteCache': {value: 'stale', timeStamp: Date.now() - 20 * 60 * 1000,},}
			}
			if (key === 'tbsettings') {
				return {tbsettings: {'Toolbox.Utils.shortLength': 15,},}
			}
			return {}
		},)
		registerCacheHandlers()

		await expect(
			handlerFor('toolbox-cache',)({
				method: 'get',
				storageKey: 'Utils.noteCache',
				inputValue: 'default',
			}, sender(),),
		).resolves.toEqual({value: 'default',},)
		expect(storageLocal.remove,).toHaveBeenCalledWith('TBCache.user.Utils.noteCache',)
	})

	it('clears all cache entries for the current session user', async () => {
		storageLocal.get.mockImplementation(async (key?: unknown,) => {
			if (typeof key === 'object') { return key }
			return {
				'TBCache.user.Utils.a': 1,
				'TBCache.other.Utils.b': 2,
			}
		},)
		registerCacheHandlers()

		await handlerFor('toolbox-cache',)({method: 'clear',}, sender(),)

		expect(storageLocal.remove,).toHaveBeenCalledWith(['TBCache.user.Utils.a',],)
	})

	it('force-timeout removes only expirable cache entries for the current user', async () => {
		storageLocal.get.mockImplementation(async (key?: unknown,) => {
			if (typeof key === 'object') { return key }
			return {
				'TBCache.user.Utils.noteCache': 1,
				'TBCache.user.Utils.nonExpiring': 2,
				'TBCache.other.Utils.noteCache': 3,
			}
		},)
		registerCacheHandlers()

		await handlerFor('toolbox-cache-force-timeout',)({}, sender(),)

		expect(storageLocal.remove,).toHaveBeenCalledWith(['TBCache.user.Utils.noteCache',],)
	})

	it('falls back when no reddit session cookie exists', async () => {
		cookies.get.mockResolvedValue(null,)
		registerCacheHandlers()

		await handlerFor('toolbox-cache',)(
			{method: 'set', storageKey: 'Utils.example', inputValue: 'value',},
			sender(),
		)

		expect(storageLocal.set,).toHaveBeenCalledWith({
			'TBCache.noSessionFallback.Utils.example': {
				value: 'value',
				timeStamp: Date.now(),
			},
		},)
	})

	it('returns a non-expired long-cache value without removing it', async () => {
		storageLocal.get.mockImplementation(async (key: unknown,) => {
			if (typeof key === 'object') { return key }
			if (key === 'TBCache.user.Utils.configCache') {
				return {'TBCache.user.Utils.configCache': {value: 'fresh', timeStamp: Date.now() - 10 * 60 * 1000,},}
			}
			if (key === 'tbsettings') {
				return {tbsettings: {'Toolbox.Utils.longLength': 45,},}
			}
			return {}
		},)
		registerCacheHandlers()

		await expect(
			handlerFor('toolbox-cache',)(
				{method: 'get', storageKey: 'Utils.configCache', inputValue: 'default',},
				sender(),
			),
		).resolves.toEqual({value: 'fresh',},)
		expect(storageLocal.remove,).not.toHaveBeenCalled()
	})

	it('expires known long-cache values using configured TTL', async () => {
		storageLocal.get.mockImplementation(async (key: unknown,) => {
			if (typeof key === 'object') { return key }
			if (key === 'TBCache.user.Utils.configCache') {
				return {'TBCache.user.Utils.configCache': {value: 'stale', timeStamp: Date.now() - 50 * 60 * 1000,},}
			}
			if (key === 'tbsettings') {
				return {tbsettings: {'Toolbox.Utils.longLength': 45,},}
			}
			return {}
		},)
		registerCacheHandlers()

		await expect(
			handlerFor('toolbox-cache',)(
				{method: 'get', storageKey: 'Utils.configCache', inputValue: 'default',},
				sender(),
			),
		).resolves.toEqual({value: 'default',},)
		expect(storageLocal.remove,).toHaveBeenCalledWith('TBCache.user.Utils.configCache',)
	})

	it('registers a storage change listener to reload TTL settings', () => {
		registerCacheHandlers()
		expect(storageOnChanged.addListener,).toHaveBeenCalled()
	})

	it('reloads TTLs when tbsettings are updated in storage', async () => {
		let shortLength = 15
		storageLocal.get.mockImplementation(async (key: unknown,) => {
			if (typeof key === 'object') { return key }
			if (key === 'tbsettings') { return {tbsettings: {'Toolbox.Utils.shortLength': shortLength,},} }
			if (key === 'TBCache.user.Utils.noteCache') {
				return {'TBCache.user.Utils.noteCache': {value: 'cached', timeStamp: Date.now() - 10 * 60 * 1000,},}
			}
			return {}
		},)
		registerCacheHandlers()

		// At 15-minute TTL, a 10-minute-old entry is still fresh
		await expect(
			handlerFor('toolbox-cache',)(
				{method: 'get', storageKey: 'Utils.noteCache', inputValue: 'default',},
				sender(),
			),
		).resolves.toEqual({value: 'cached',},)

		// Lower the TTL to 5 minutes and fire the storage change listener
		shortLength = 5
		const listener = storageOnChanged.addListener.mock.calls[0]![0]
		await listener({tbsettings: {},}, 'local',)

		// Now the 10-minute-old entry is stale
		await expect(
			handlerFor('toolbox-cache',)(
				{method: 'get', storageKey: 'Utils.noteCache', inputValue: 'default',},
				sender(),
			),
		).resolves.toEqual({value: 'default',},)
	})

	it('evicts stale users and records interaction timestamps during background cleanup', async () => {
		const expiredTime = Date.now() - 25 * 60 * 60 * 1000 // 25 h ago, beyond the 24 h window
		storageLocal.get.mockImplementation(async (key?: unknown,) => {
			if (key === undefined) {
				// Used by clearCache to enumerate all storage keys
				return {'TBCache.expired.Utils.example': {value: 'old',},}
			}
			if (typeof key === 'object' && key !== null && 'userCacheInteractionTimes' in (key as object)) {
				return {userCacheInteractionTimes: {expired: expiredTime,},}
			}
			return {}
		},)
		registerCacheHandlers()

		await handlerFor('toolbox-cache',)({method: 'set', storageKey: 'Utils.x', inputValue: 1,}, sender(),)
		// Flush the unawaited staleUserCacheCleanup promise chain
		for (let i = 0; i < 10; i++) { await Promise.resolve() }

		expect(storageLocal.remove,).toHaveBeenCalledWith(['TBCache.expired.Utils.example',],)
		expect(storageLocal.set,).toHaveBeenCalledWith(
			expect.objectContaining({userCacheInteractionTimes: {user: Date.now(),},},),
		)
	})
})
