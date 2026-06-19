/** Tests for the recent-actions store's caching, failure backoff, and retry behavior. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

import type {ModLogEntry,} from './modLog'

const getModLogEntries = vi.hoisted(() => vi.fn())
vi.mock('../../api/resources/subreddits', () => ({getModLogEntries,}),)

import {ensureRecentActionsLoaded, getRecentActions, itemHasRecentActions,} from './recentActionsStore'

/** Builds a mod-log entry targeting `fullname`. */
function entry (fullname: string,): ModLogEntry {
	return {action: 'removelink', created_utc: 1, mod: 'm', details: null, target_fullname: fullname,}
}

/** Drains the `getModLogEntries().then().catch().finally()` microtask chain via a macrotask boundary. */
async function flush () {
	await new Promise((resolve,) => setTimeout(resolve, 0,))
}

// Each test uses a distinct subreddit so the store's module-level maps don't collide between tests.
let now = 1_000_000

beforeEach(() => {
	now = 1_000_000
	vi.spyOn(Date, 'now',).mockImplementation(() => now)
	getModLogEntries.mockReset()
},)

afterEach(() => {
	vi.restoreAllMocks()
},)

describe('ensureRecentActionsLoaded', () => {
	it('caches a successful fetch and indexes the touched items', async () => {
		getModLogEntries.mockResolvedValueOnce([entry('t3_ok',),],)
		ensureRecentActionsLoaded('okSub',)
		await flush()
		expect(itemHasRecentActions('okSub', 't3_ok',),).toBe(true,)
		expect(itemHasRecentActions('okSub', 't3_other',),).toBe(false,)
		expect(getRecentActions('okSub', 't3_ok',),).toHaveLength(1,)
	})

	it('de-duplicates concurrent and repeat calls for a cached sub', async () => {
		getModLogEntries.mockResolvedValueOnce([],)
		ensureRecentActionsLoaded('dedupSub',)
		ensureRecentActionsLoaded('dedupSub',) // in flight → skipped
		await flush()
		ensureRecentActionsLoaded('dedupSub',) // already cached → skipped
		await flush()
		expect(getModLogEntries,).toHaveBeenCalledTimes(1,)
	})

	it('does not cache an empty window on failure, and retries only after the cooldown', async () => {
		getModLogEntries.mockRejectedValueOnce(new Error('boom',),)
		ensureRecentActionsLoaded('flakySub',)
		await flush()
		// Failed: nothing cached, so the button stays hidden and the popup index has nothing.
		expect(itemHasRecentActions('flakySub', 't3_x',),).toBe(false,)
		expect(getRecentActions('flakySub', 't3_x',),).toBeUndefined()

		// Within the cooldown: no retry (don't hammer a failing endpoint).
		ensureRecentActionsLoaded('flakySub',)
		await flush()
		expect(getModLogEntries,).toHaveBeenCalledTimes(1,)

		// After the cooldown: retry, and a now-succeeding fetch populates the window.
		now += 61_000
		getModLogEntries.mockResolvedValueOnce([entry('t3_x',),],)
		ensureRecentActionsLoaded('flakySub',)
		await flush()
		expect(getModLogEntries,).toHaveBeenCalledTimes(2,)
		expect(itemHasRecentActions('flakySub', 't3_x',),).toBe(true,)
	})
})
