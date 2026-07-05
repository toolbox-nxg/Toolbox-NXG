/** Tests for wikiLayoutCache write serialization. */

// @vitest-environment node
import {beforeEach, describe, expect, it, vi,} from 'vitest'

const getCache = vi.hoisted(() => vi.fn())
const setCache = vi.hoisted(() => vi.fn())

vi.mock('../../framework/moduleIds', () => ({utils: 'utils',}),)
vi.mock('../persistence/cache', () => ({getCache, setCache,}),)

import {LAYOUT_CACHE_KEY, sessionLayouts, setCachedWikiLayout, type WikiLayout,} from './wikiLayoutCache'

const tick = () => new Promise((resolve,) => setTimeout(resolve, 0,))

function layout (subreddit: string,): WikiLayout {
	return {subreddit, state: 'nxg', compatibilityWrites: false,}
}

describe('wikiLayoutCache write serialization', () => {
	let store: Record<string, unknown>

	beforeEach(() => {
		store = {}
		sessionLayouts.clear()
		// Async read/write with a delay, so two overlapping read-modify-write
		// cycles would clobber each other if they were not serialized.
		getCache.mockImplementation(async (_module: unknown, key: string, def: unknown,) => {
			await tick()
			return key in store ? structuredClone(store[key],) : def
		},)
		setCache.mockImplementation(async (_module: unknown, key: string, value: unknown,) => {
			await tick()
			store[key] = structuredClone(value,)
		},)
	},)

	it('does not drop an entry when two layouts are cached concurrently', async () => {
		await Promise.all([
			setCachedWikiLayout(layout('a',), true,),
			setCachedWikiLayout(layout('b',), true,),
		],)

		const persisted = store[LAYOUT_CACHE_KEY] as Record<string, unknown>
		// Without serialization both writers read the empty blob and one entry is lost.
		expect(Object.keys(persisted,).sort(),).toEqual(['a', 'b',],)
	})
})
