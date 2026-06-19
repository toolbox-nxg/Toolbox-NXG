/** Tests for getUserDetails. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const apiOauthGetJSON = vi.hoisted(() => vi.fn())
const getCache = vi.hoisted(() => vi.fn())
const setCache = vi.hoisted(() => vi.fn())

vi.mock('../../framework/moduleIds', () => ({utils: 'utils',}),)
vi.mock('../../util/persistence/cache', () => ({getCache, setCache,}),)
vi.mock('../transport/http', () => ({apiOauthGetJSON,}),)

// Static import works for getModeratedSubreddits (plain async function, not tied to the IIFE)
import {getModeratedSubreddits,} from './me'

beforeEach(() => {
	apiOauthGetJSON.mockReset()
	getCache.mockReset().mockResolvedValue(undefined,)
	setCache.mockReset().mockResolvedValue(undefined,)
},)

// userDetailsPromise is a module-level IIFE, so each test must vi.resetModules() + dynamically
// import ./me to get a fresh evaluation with the desired mock behavior.
describe('getUserDetails', () => {
	it('fetches user details, caches them, and returns them', async () => {
		apiOauthGetJSON.mockResolvedValue({name: 'testuser',},)
		vi.resetModules()
		const {getUserDetails,} = await import('./me')
		await expect(getUserDetails(),).resolves.toEqual({name: 'testuser',},)
		expect(apiOauthGetJSON,).toHaveBeenCalledWith('/api/v1/me',)
		expect(setCache,).toHaveBeenCalledWith('utils', 'userDetails', {name: 'testuser',},)
	})

	it('retries up to 3 times on 504 errors', async () => {
		const timeoutError = Object.assign(new Error('timeout',), {response: {status: 504,},},)
		apiOauthGetJSON
			.mockRejectedValueOnce(timeoutError,)
			.mockRejectedValueOnce(timeoutError,)
			.mockResolvedValue({name: 'testuser',},)
		vi.resetModules()
		const {getUserDetails,} = await import('./me')
		await expect(getUserDetails(),).resolves.toEqual({name: 'testuser',},)
		expect(apiOauthGetJSON,).toHaveBeenCalledTimes(3,)
	})

	it('falls back to cache after exhausting 504 retries', async () => {
		const timeoutError = Object.assign(new Error('timeout',), {response: {status: 504,},},)
		apiOauthGetJSON.mockRejectedValue(timeoutError,)
		getCache.mockResolvedValue({name: 'cacheduser',},)
		vi.resetModules()
		const {getUserDetails,} = await import('./me')
		await expect(getUserDetails(),).resolves.toEqual({name: 'cacheduser',},)
		expect(getCache,).toHaveBeenCalledWith('utils', 'userDetails',)
	})

	it('falls back to cache immediately on non-504 errors without retrying', async () => {
		apiOauthGetJSON.mockRejectedValue(new Error('forbidden',),)
		getCache.mockResolvedValue({name: 'cacheduser',},)
		vi.resetModules()
		const {getUserDetails,} = await import('./me')
		await expect(getUserDetails(),).resolves.toEqual({name: 'cacheduser',},)
		expect(apiOauthGetJSON,).toHaveBeenCalledTimes(1,)
	})
})

describe('getCurrentUser', () => {
	it('returns the username from user details', async () => {
		apiOauthGetJSON.mockResolvedValue({name: 'alice',},)
		vi.resetModules()
		const {getCurrentUser,} = await import('./me')
		await expect(getCurrentUser(),).resolves.toBe('alice',)
	})

	it('throws when user details are unavailable and cache is empty', async () => {
		apiOauthGetJSON.mockRejectedValue(new Error('network error',),)
		getCache.mockResolvedValue(undefined,)
		vi.resetModules()
		const {getCurrentUser,} = await import('./me')
		await expect(getCurrentUser(),).rejects.toThrow('Could not retrieve user details',)
	})
})

describe('getModeratedSubreddits', () => {
	it('fetches all pages until there is no after cursor', async () => {
		apiOauthGetJSON
			.mockResolvedValueOnce({data: {children: [{id: 'a',}, {id: 'b',},], after: 'cursor1',},},)
			.mockResolvedValueOnce({data: {children: [{id: 'c',},], after: null,},},)

		await expect(getModeratedSubreddits(),).resolves.toEqual([{id: 'a',}, {id: 'b',}, {id: 'c',},],)
		expect(apiOauthGetJSON.mock.calls,).toEqual([
			['/subreddits/mine/moderator.json', {after: undefined, limit: '100',},],
			['/subreddits/mine/moderator.json', {after: 'cursor1', limit: '100',},],
		],)
	})

	it('returns an empty array when the user moderates no subreddits', async () => {
		apiOauthGetJSON.mockResolvedValue({data: {children: [], after: null,},},)

		await expect(getModeratedSubreddits(),).resolves.toEqual([],)
	})

	it('retries up to 5 times on 504 errors per page then succeeds', async () => {
		const timeoutError = {response: {status: 504,},}
		apiOauthGetJSON
			.mockRejectedValueOnce(timeoutError,)
			.mockRejectedValueOnce(timeoutError,)
			.mockRejectedValueOnce(timeoutError,)
			.mockRejectedValueOnce(timeoutError,)
			.mockResolvedValueOnce({data: {children: [{id: 'a',},], after: null,},},)

		await expect(getModeratedSubreddits(),).resolves.toEqual([{id: 'a',},],)
		expect(apiOauthGetJSON,).toHaveBeenCalledTimes(5,)
	})

	it('throws after exhausting all 504 retries', async () => {
		const timeoutError = {response: {status: 504,},}
		apiOauthGetJSON.mockRejectedValue(timeoutError,)

		await expect(getModeratedSubreddits(),).rejects.toEqual(timeoutError,)
		expect(apiOauthGetJSON,).toHaveBeenCalledTimes(5,)
	})

	it('throws immediately on non-504 errors', async () => {
		const error = {response: {status: 403,},}
		apiOauthGetJSON.mockRejectedValue(error,)

		await expect(getModeratedSubreddits(),).rejects.toEqual(error,)
		expect(apiOauthGetJSON,).toHaveBeenCalledTimes(1,)
	})

	it('resets the retry counter on a successful page fetch', async () => {
		const timeoutError = {response: {status: 504,},}
		apiOauthGetJSON
			// page 1: success
			.mockResolvedValueOnce({data: {children: [{id: 'a',},], after: 'cursor1',},},)
			// page 2: 4 retries then success
			.mockRejectedValueOnce(timeoutError,)
			.mockRejectedValueOnce(timeoutError,)
			.mockRejectedValueOnce(timeoutError,)
			.mockRejectedValueOnce(timeoutError,)
			.mockResolvedValueOnce({data: {children: [{id: 'b',},], after: null,},},)

		await expect(getModeratedSubreddits(),).resolves.toEqual([{id: 'a',}, {id: 'b',},],)
		expect(apiOauthGetJSON,).toHaveBeenCalledTimes(6,)
	})
})
