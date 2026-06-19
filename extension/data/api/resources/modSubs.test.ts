/** Tests for modSubs API helpers. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const getModeratedSubreddits = vi.hoisted(() => vi.fn())
const getCache = vi.hoisted(() => vi.fn())
const setCache = vi.hoisted(() => vi.fn())

vi.mock('../../framework/moduleIds', () => ({utils: 'utils',}),)
vi.mock('../../util/infra/logging', () => ({default: () => ({debug: vi.fn(),}),}),)
vi.mock('../../util/persistence/cache', () => ({getCache, setCache,}),)
vi.mock('./me', () => ({getModeratedSubreddits,}),)

import {clearModSubsCache, getModSubs, isModSub, modSubCheck,} from './modSubs'

function subreddit (display_name: string, subscribers: number,) {
	return {
		data: {
			display_name,
			subscribers,
			over18: false,
			created_utc: 1,
			subreddit_type: 'public',
			submission_type: 'any',
		},
	}
}

beforeEach(() => {
	clearModSubsCache()
	getModeratedSubreddits.mockReset()
	getCache.mockReset().mockResolvedValue([],)
	setCache.mockReset().mockResolvedValue(undefined,)
},)

describe('modSubs API helpers', () => {
	it('returns cached subreddit names without fetching', async () => {
		getCache.mockResolvedValue(['alpha', 'beta',],)

		await expect(getModSubs(false,),).resolves.toEqual(['alpha', 'beta',],)

		expect(getModeratedSubreddits,).not.toHaveBeenCalled()
	})

	it('returns cached names after refreshing missing data cache', async () => {
		getCache
			.mockResolvedValueOnce(['alpha', 'beta',],) // moderatedSubs
			.mockResolvedValueOnce([],) // moderatedSubsData (empty/missing)
		getModeratedSubreddits.mockResolvedValue([subreddit('alpha', 10,), subreddit('beta', 5,),],)

		await expect(getModSubs(false,),).resolves.toEqual(['alpha', 'beta',],)
		// Should still fetch to populate the data cache for future data=true callers
		expect(getModeratedSubreddits,).toHaveBeenCalledTimes(1,)
	})

	it('returns cached names for data=false even when the data fetch fails', async () => {
		getCache
			.mockResolvedValueOnce(['alpha', 'beta',],)
			.mockResolvedValueOnce([],)
		getModeratedSubreddits.mockRejectedValue(new Error('network failure',),)

		await expect(getModSubs(false,),).resolves.toEqual(['alpha', 'beta',],)
	})

	it('rejects for data=true when the data fetch fails and no data cache exists', async () => {
		getCache
			.mockResolvedValueOnce(['alpha', 'beta',],)
			.mockResolvedValueOnce([],)
		getModeratedSubreddits.mockRejectedValue(new Error('network failure',),)

		await expect(getModSubs(true,),).rejects.toThrow('network failure',)
	})

	it('fetches, sorts, caches, and returns moderated subreddit names', async () => {
		getModeratedSubreddits.mockResolvedValue([
			subreddit('zeta', 5,),
			subreddit('Alpha', 20,),
			subreddit('beta', 10,),
		],)

		await expect(getModSubs(false,),).resolves.toEqual(['Alpha', 'beta', 'zeta',],)

		expect(setCache,).toHaveBeenCalledWith('utils', 'moderatedSubs', ['Alpha', 'beta', 'zeta',],)
		expect(setCache,).toHaveBeenCalledWith('utils', 'moderatedSubsData', [
			expect.objectContaining({subreddit: 'Alpha', subscribers: 20,},),
			expect.objectContaining({subreddit: 'beta', subscribers: 10,},),
			expect.objectContaining({subreddit: 'zeta', subscribers: 5,},),
		],)
	})

	it('returns sorted subreddit data when requested', async () => {
		getModeratedSubreddits.mockResolvedValue([
			subreddit('small', 5,),
			subreddit('large', 100,),
		],)

		await expect(getModSubs(true,),).resolves.toEqual([
			expect.objectContaining({subreddit: 'large', subscribers: 100,},),
			expect.objectContaining({subreddit: 'small', subscribers: 5,},),
		],)
	})

	it('checks whether a subreddit is moderated by the current user', async () => {
		getCache.mockResolvedValue(['alpha', 'beta',],)

		await expect(isModSub('beta',),).resolves.toBe(true,)
		await expect(isModSub('gamma',),).resolves.toBe(false,)
	})

	it('checks aggregate moderated subscriber count excluding one subscriber per subreddit', async () => {
		getCache.mockResolvedValue([
			{subscribers: 15,},
			{subscribers: 20,},
		],)

		await expect(modSubCheck(),).resolves.toBe(true,)
	})

	it('propagates fetch errors to all concurrent callers waiting on the same request', async () => {
		const fetchError = new Error('network failure',)
		getModeratedSubreddits.mockRejectedValue(fetchError,)

		// Launch two concurrent callers before either resolves
		const [first, second,] = await Promise.allSettled([
			getModSubs(false,),
			getModSubs(false,),
		],)

		expect(first.status,).toBe('rejected',)
		expect(second.status,).toBe('rejected',)
		expect((first as PromiseRejectedResult).reason,).toBe(fetchError,)
		expect((second as PromiseRejectedResult).reason,).toBe(fetchError,)
	})
})
