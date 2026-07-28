// @vitest-environment node
/** Tests for the gating and write behavior of the native removal reason sync runner. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const getConfig = vi.hoisted(() => vi.fn())
const saveToolboxConfig = vi.hoisted(() => vi.fn())
const getNativeReasons = vi.hoisted(() => vi.fn())
const getCache = vi.hoisted(() => vi.fn())
const setCache = vi.hoisted(() => vi.fn())

vi.mock('../../../framework/moduleIds', () => ({utils: 'utils',}),)
vi.mock('../../../util/infra/logging', () => ({
	default: () => ({debug: vi.fn(), warn: vi.fn(), error: vi.fn(),}),
}),)
vi.mock('../../../util/persistence/cache', () => ({getCache, setCache,}),)
vi.mock('../../config/moduleapi', () => ({getConfig, saveToolboxConfig,}),)
vi.mock('../moduleapi', () => ({getNativeReasons,}),)

import {nativeReasonsFingerprint,} from '../nativeSync'
import {resetNativeSyncThrottle, syncNativeReasons,} from './syncNativeReasons'

const nativeReasons = [
	{id: 'n1', title: 'Rule 1', message: 'body 1',},
	{id: 'n2', title: 'Rule 2', message: 'body 2',},
]

/** Builds a config whose removal reasons block carries the given overrides. */
function makeConfig (removalReasons: Record<string, unknown> = {},) {
	return {
		ver: 2,
		modMacros: [],
		banMacros: null,
		removalReasons: {
			reasons: [],
			nativeSync: {enabled: true,},
			...removalReasons,
		},
	}
}

beforeEach(() => {
	resetNativeSyncThrottle()
	getConfig.mockReset().mockResolvedValue(makeConfig(),)
	saveToolboxConfig.mockReset().mockResolvedValue(undefined,)
	getNativeReasons.mockReset().mockResolvedValue(nativeReasons,)
	getCache.mockReset().mockImplementation((_moduleId: unknown, _key: unknown, fallback: unknown,) =>
		Promise.resolve(fallback,)
	)
	setCache.mockReset().mockResolvedValue(undefined,)
},)

describe('syncNativeReasons gates', () => {
	it('does nothing when the subreddit has no config', async () => {
		getConfig.mockResolvedValue(undefined,)

		await expect(syncNativeReasons('sub',),).resolves.toEqual({status: 'disabled',},)
		expect(getNativeReasons,).not.toHaveBeenCalled()
	})

	it('does nothing when the sync is not enabled, without a network call', async () => {
		getConfig.mockResolvedValue(makeConfig({nativeSync: undefined,},),)

		await expect(syncNativeReasons('sub',),).resolves.toEqual({status: 'disabled',},)
		expect(getNativeReasons,).not.toHaveBeenCalled()
		expect(saveToolboxConfig,).not.toHaveBeenCalled()
	})

	it('refuses to sync a subreddit that takes its reasons from elsewhere', async () => {
		getConfig.mockResolvedValue(makeConfig({getfrom: 'othersub',},),)

		await expect(syncNativeReasons('sub',),).resolves.toEqual({status: 'redirected',},)
		expect(getNativeReasons,).not.toHaveBeenCalled()
	})

	it('still syncs when getfrom points at the subreddit itself', async () => {
		getConfig.mockResolvedValue(makeConfig({getfrom: 'sub',},),)

		await expect(syncNativeReasons('sub',),).resolves.toMatchObject({status: 'synced',},)
	})

	it('skips a second attempt in the same session', async () => {
		await syncNativeReasons('sub',)
		getNativeReasons.mockClear()

		await expect(syncNativeReasons('sub',),).resolves.toEqual({status: 'throttled',},)
		expect(getNativeReasons,).not.toHaveBeenCalled()
	})

	it('skips a subreddit still inside its persisted cooldown', async () => {
		getCache.mockResolvedValue({sub: Date.now(),},)

		await expect(syncNativeReasons('sub',),).resolves.toEqual({status: 'throttled',},)
		expect(getNativeReasons,).not.toHaveBeenCalled()
	})

	it('retries once the persisted cooldown has elapsed', async () => {
		getCache.mockResolvedValue({sub: Date.now() - 60 * 60 * 1000,},)

		await expect(syncNativeReasons('sub',),).resolves.toMatchObject({status: 'synced',},)
	})

	it('bypasses both throttles when forced, and asks for a fresh read', async () => {
		await syncNativeReasons('sub',)
		getNativeReasons.mockClear()

		// Not throttled despite the session attempt above, and the cache is bypassed.
		await expect(syncNativeReasons('sub', {force: true,},),).resolves.toMatchObject({status: 'synced',},)
		expect(getNativeReasons,).toHaveBeenCalledWith('sub', {fresh: true,},)
	})

	it('reports a failed fetch without writing', async () => {
		getNativeReasons.mockRejectedValue(new Error('boom',),)

		await expect(syncNativeReasons('sub',),).resolves.toEqual({status: 'failed',},)
		expect(saveToolboxConfig,).not.toHaveBeenCalled()
	})

	it('skips the merge entirely when the fingerprint still matches', async () => {
		getConfig.mockResolvedValue(
			makeConfig({nativeSync: {enabled: true, fingerprint: nativeReasonsFingerprint(nativeReasons,),},},),
		)

		await expect(syncNativeReasons('sub',),).resolves.toEqual({status: 'unchanged',},)
		expect(saveToolboxConfig,).not.toHaveBeenCalled()
	})

	it('does not write when the fingerprint moved but the merge had nothing to do', async () => {
		// Only reachable if a stale fingerprint is stored; the merge is the authority.
		getConfig.mockResolvedValue(makeConfig({
			nativeSync: {enabled: true, fingerprint: 'stale',},
			reasons: nativeReasons.map((r,) => ({
				title: r.title,
				text: r.message,
				flairText: '',
				flairCSS: '',
				flairTemplateID: '',
				nativeReasonId: r.id,
			})),
		},),)

		await expect(syncNativeReasons('sub',),).resolves.toEqual({status: 'unchanged',},)
		expect(saveToolboxConfig,).not.toHaveBeenCalled()
	})
})

describe('syncNativeReasons writing', () => {
	it('writes a silent save with the merged reasons and a refreshed fingerprint', async () => {
		const result = await syncNativeReasons('sub',)

		expect(result,).toEqual({status: 'synced', added: 2, updated: 0, removed: 0,},)
		expect(saveToolboxConfig,).toHaveBeenCalledOnce()
		const [subreddit, saved, reason, options,] = saveToolboxConfig.mock.calls[0]!
		expect(subreddit,).toBe('sub',)
		expect(reason,).toBe('sync removal reasons from Reddit',)
		expect(options,).toEqual({silent: true,},)
		expect(saved.removalReasons.reasons.map((r: {nativeReasonId?: string},) => r.nativeReasonId),)
			.toEqual(['n1', 'n2',],)
		expect(saved.removalReasons.nativeSync.fingerprint,).toBe(nativeReasonsFingerprint(nativeReasons,),)
		expect(saved.removalReasons.nativeSync.enabled,).toBe(true,)
		expect(typeof saved.removalReasons.nativeSync.lastSyncedAt,).toBe('number',)
	})

	it('does not mutate the cached config object', async () => {
		const config = makeConfig()
		getConfig.mockResolvedValue(config,)

		await syncNativeReasons('sub',)

		const [, saved,] = saveToolboxConfig.mock.calls[0]!
		expect(saved,).not.toBe(config,)
		expect(saved.removalReasons,).not.toBe(config.removalReasons,)
		expect(config.removalReasons.reasons,).toEqual([],)
		expect(config.removalReasons.nativeSync,).toEqual({enabled: true,},)
	})

	it('shows feedback for a forced run', async () => {
		await syncNativeReasons('sub', {force: true,},)

		expect(saveToolboxConfig.mock.calls[0]![3],).toEqual({silent: false,},)
	})

	it('carries the ignored list through to the merge and keeps it on the saved config', async () => {
		getConfig.mockResolvedValue(makeConfig({nativeSync: {enabled: true, ignored: ['n1',],},},),)

		const result = await syncNativeReasons('sub',)

		expect(result,).toMatchObject({added: 1,},)
		const [, saved,] = saveToolboxConfig.mock.calls[0]!
		expect(saved.removalReasons.reasons.map((r: {nativeReasonId?: string},) => r.nativeReasonId),).toEqual(['n2',],)
		expect(saved.removalReasons.nativeSync.ignored,).toEqual(['n1',],)
	})

	it('deletes toolbox copies when every native reason is gone', async () => {
		getNativeReasons.mockResolvedValue([],)
		getConfig.mockResolvedValue(makeConfig({
			reasons: [
				{title: 'Linked', text: 'x', flairText: '', flairCSS: '', flairTemplateID: '', nativeReasonId: 'n1',},
				{title: 'Hand written', text: 'y', flairText: '', flairCSS: '', flairTemplateID: '',},
			],
		},),)

		const result = await syncNativeReasons('sub',)

		expect(result,).toMatchObject({status: 'synced', removed: 1,},)
		const [, saved,] = saveToolboxConfig.mock.calls[0]!
		expect(saved.removalReasons.reasons.map((r: {title: string},) => r.title),).toEqual(['Hand written',],)
	})

	it('swallows a save failure and keeps the subreddit marked attempted', async () => {
		saveToolboxConfig.mockRejectedValue(new Error('no wiki access',),)

		await expect(syncNativeReasons('sub',),).resolves.toEqual({status: 'failed',},)
		getNativeReasons.mockClear()
		await expect(syncNativeReasons('sub',),).resolves.toEqual({status: 'throttled',},)
		expect(getNativeReasons,).not.toHaveBeenCalled()
	})
})
