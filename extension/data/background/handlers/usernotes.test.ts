/** Tests for the usernotes decompression background handler. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const registerMessageHandler = vi.hoisted(() => vi.fn())
const zlibInflate = vi.hoisted(() => vi.fn())

vi.mock('../messageHandling', () => ({registerMessageHandler,}),)
vi.mock('../../util/data/encoding', () => ({zlibInflate,}),)

/** Re-imports the handler module and returns the registered handler for `action`. */
async function registerAndGetHandler (action = 'toolbox-usernote-decompress',) {
	vi.resetModules()
	registerMessageHandler.mockClear()
	const {registerUsernoteHandlers,} = await import('./usernotes')
	registerUsernoteHandlers()
	return registerMessageHandler.mock.calls.find((call,) => call[0] === action)![1]
}

beforeEach(() => {
	registerMessageHandler.mockClear()
	zlibInflate.mockReset()
},)

describe('usernote-decompress handler', () => {
	it('decompresses and returns users on a cache miss', async () => {
		const users = {u_testuser: {ns: [],},}
		zlibInflate.mockReturnValue(JSON.stringify(users,),)
		const handler = await registerAndGetHandler()

		const result = await handler({cacheKey: 'sub_miss', blob: 'blob1',},)

		expect(zlibInflate,).toHaveBeenCalledWith('blob1',)
		expect(result,).toEqual({users,},)
	})

	it('returns cached result without decompressing on a cache hit', async () => {
		const users = {u_cacheduser: {ns: [],},}
		zlibInflate.mockReturnValue(JSON.stringify(users,),)
		const handler = await registerAndGetHandler()

		await handler({cacheKey: 'sub_hit', blob: 'blob2',},)
		zlibInflate.mockClear()

		const result = await handler({cacheKey: 'sub_hit', blob: 'blob2',},)

		expect(zlibInflate,).not.toHaveBeenCalled()
		expect(result,).toEqual({users,},)
	})

	it('re-decompresses when the blob changes for a cached key', async () => {
		const oldUsers = {u_old: {ns: [],},}
		const newUsers = {u_new: {ns: [],},}
		zlibInflate
			.mockReturnValueOnce(JSON.stringify(oldUsers,),)
			.mockReturnValueOnce(JSON.stringify(newUsers,),)
		const handler = await registerAndGetHandler()

		await handler({cacheKey: 'sub_changed', blob: 'old_blob',},)
		const result = await handler({cacheKey: 'sub_changed', blob: 'new_blob',},)

		expect(zlibInflate,).toHaveBeenCalledTimes(2,)
		expect(result,).toEqual({users: newUsers,},)
	})

	it('caches per-shard keys for the same subreddit independently', async () => {
		const shard0Users = {u_alpha: {ns: [],},}
		const shard1Users = {u_bravo: {ns: [],},}
		zlibInflate
			.mockReturnValueOnce(JSON.stringify(shard0Users,),)
			.mockReturnValueOnce(JSON.stringify(shard1Users,),)
		const handler = await registerAndGetHandler()

		await handler({cacheKey: 'sub#s1-00000000', blob: 'blob_a',},)
		await handler({cacheKey: 'sub#s1-80000000', blob: 'blob_b',},)
		zlibInflate.mockClear()

		// Both shard entries stay cached side by side.
		expect(await handler({cacheKey: 'sub#s1-00000000', blob: 'blob_a',},),).toEqual({users: shard0Users,},)
		expect(await handler({cacheKey: 'sub#s1-80000000', blob: 'blob_b',},),).toEqual({users: shard1Users,},)
		expect(zlibInflate,).not.toHaveBeenCalled()
	})

	it('returns an error response when decompression fails', async () => {
		zlibInflate.mockImplementation(() => {
			throw new Error('bad zlib data',)
		},)
		const handler = await registerAndGetHandler()

		const result = await handler({cacheKey: 'sub_err', blob: 'bad_blob',},)

		expect(result,).toEqual({error: 'Error: bad zlib data',},)
	})

	it('shares in-flight decompression for concurrent requests', async () => {
		const users = {u_flight: {ns: [],},}
		zlibInflate.mockReturnValue(JSON.stringify(users,),)
		const handler = await registerAndGetHandler()

		const first = handler({cacheKey: 'sub_flight', blob: 'blob_flight',},)
		const second = handler({cacheKey: 'sub_flight', blob: 'blob_flight',},)

		await expect(Promise.all([first, second,],),).resolves.toEqual([{users,}, {users,},],)
		expect(zlibInflate,).toHaveBeenCalledOnce()
	})
})
