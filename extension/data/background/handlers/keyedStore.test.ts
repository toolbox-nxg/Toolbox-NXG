/** Tests for KeyedStore. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const storageLocal = vi.hoisted(() => ({get: vi.fn(), set: vi.fn(), remove: vi.fn(),}))
const storageSession = vi.hoisted(() => ({get: vi.fn(), set: vi.fn(), remove: vi.fn(),}))

vi.mock('webextension-polyfill', () => ({
	default: {storage: {local: storageLocal, session: storageSession,},},
}),)

import {KeyedStore,} from './keyedStore'

beforeEach(() => {
	storageLocal.get.mockReset().mockResolvedValue({},)
	storageLocal.set.mockReset().mockResolvedValue(undefined,)
	storageLocal.remove.mockReset().mockResolvedValue(undefined,)
	storageSession.get.mockReset().mockResolvedValue({},)
	storageSession.set.mockReset().mockResolvedValue(undefined,)
	storageSession.remove.mockReset().mockResolvedValue(undefined,)
},)

describe('KeyedStore', () => {
	it('writes to the correct namespaced key in local storage', async () => {
		const store = new KeyedStore<string>('local', 'myprefix',)
		await store.set('abc', 'hello',)
		expect(storageLocal.set,).toHaveBeenCalledWith({'myprefix-abc': 'hello',},)
	})

	it('reads from the correct namespaced key and returns the value', async () => {
		storageLocal.get.mockResolvedValue({'myprefix-abc': 'hello',},)
		const store = new KeyedStore<string>('local', 'myprefix',)
		await expect(store.get('abc',),).resolves.toBe('hello',)
		expect(storageLocal.get,).toHaveBeenCalledWith({'myprefix-abc': null,},)
	})

	it('returns null for a missing key', async () => {
		storageLocal.get.mockResolvedValue({'myprefix-missing': null,},)
		const store = new KeyedStore<string>('local', 'myprefix',)
		await expect(store.get('missing',),).resolves.toBeNull()
	})

	it('deletes the correct namespaced key', async () => {
		const store = new KeyedStore<string>('local', 'myprefix',)
		await store.delete('abc',)
		expect(storageLocal.remove,).toHaveBeenCalledWith('myprefix-abc',)
	})

	it('operates on session storage when constructed with session area', async () => {
		storageSession.get.mockResolvedValue({'ns-key': {x: 1,},},)
		const store = new KeyedStore<{x: number}>('session', 'ns',)

		await store.set('key', {x: 1,},)
		expect(storageSession.set,).toHaveBeenCalledWith({'ns-key': {x: 1,},},)

		await expect(store.get('key',),).resolves.toEqual({x: 1,},)
		expect(storageSession.get,).toHaveBeenCalledWith({'ns-key': null,},)

		await store.delete('key',)
		expect(storageSession.remove,).toHaveBeenCalledWith('ns-key',)
	})

	it('isolates keys across different prefixes in the same area', async () => {
		storageLocal.get.mockImplementation(async (defaults: Record<string, unknown>,) => defaults)
		const storeA = new KeyedStore<number>('local', 'alpha',)
		const storeB = new KeyedStore<number>('local', 'beta',)

		await storeA.set('x', 1,)
		await storeB.set('x', 2,)

		expect(storageLocal.set,).toHaveBeenCalledWith({'alpha-x': 1,},)
		expect(storageLocal.set,).toHaveBeenCalledWith({'beta-x': 2,},)

		await expect(storeA.get('x',),).resolves.toBeNull()
		await expect(storeB.get('x',),).resolves.toBeNull()
	})
})
