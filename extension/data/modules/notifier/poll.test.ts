/** Tests for the Notifier poll throttle and manual-refresh behavior. */

// @vitest-environment node
import {beforeEach, describe, expect, it, vi,} from 'vitest'

import type {ModbarCounterOptions, NotifierStorage,} from './poll'

const getTime = vi.hoisted(() => vi.fn())
const getModerationQueueListing = vi.hoisted(() => vi.fn())
const getModmailUnreadCount = vi.hoisted(() => vi.fn())
const getInfo = vi.hoisted(() => vi.fn())
const notification = vi.hoisted(() => vi.fn())
const updateCounters = vi.hoisted(() => vi.fn())
const sendMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined,))

vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage,},},}),)
vi.mock('../../api/resources/modmail', () => ({getModmailUnreadCount,}),)
vi.mock('../../api/resources/subreddits', () => ({getModerationQueueListing,}),)
vi.mock('../../api/resources/things', () => ({getInfo,}),)
vi.mock('../../util/data/time', () => ({getTime,}),)
vi.mock('../../util/infra/logging', () => ({default: () => ({debug: vi.fn(), error: vi.fn(), warn: vi.fn(),}),}),)
vi.mock('../../util/reddit/events', () => ({events: {TB_UPDATE_COUNTERS: 'TB_UPDATE_COUNTERS',},}),)
vi.mock('../../util/ui/notifications', () => ({notification,}),)
vi.mock('./store', () => ({updateCounters,}),)

import {createNotifierHandlers,} from './poll'

const NOW = 1_000_000
const INTERVAL = 60_000

/** A fake NotifierStorage backed by a Map, with get/set spies. */
function makeModule (initial: Record<string, unknown> = {},): NotifierStorage & {
	store: Map<string, unknown>
	get: ReturnType<typeof vi.fn>
	set: ReturnType<typeof vi.fn>
} {
	const store = new Map<string, unknown>(Object.entries(initial,),)
	const get = vi.fn((key: string,) => Promise.resolve(store.get(key,),))
	const set = vi.fn((key: string, value: unknown,) => {
		store.set(key, value,)
		return Promise.resolve()
	},)
	// The real NotifierStorage methods are generic over the settings keys; this
	// Map-backed stub satisfies them structurally for the poll logic under test.
	return {store, get, set,} as unknown as NotifierStorage & {
		store: Map<string, unknown>
		get: ReturnType<typeof vi.fn>
		set: ReturnType<typeof vi.fn>
	}
}

function makeOptions (overrides: Partial<ModbarCounterOptions> = {},): ModbarCounterOptions {
	return {
		modNotifications: false,
		unmoderatedNotifications: false,
		consolidatedMessages: false,
		modSubreddits: 'mod',
		unmoderatedSubreddits: 'mod',
		unmoderatedOn: false,
		checkIntervalMillis: INTERVAL,
		modqueueCount: 0,
		unmoderatedCount: 0,
		modmailCount: 0,
		modmailCategoryCount: {},
		...overrides,
	}
}

/** Lets the getmessages fetch chain (`set(lastChecked)` then the API `.then`s) run to the call sites. */
const flush = () => new Promise((resolve,) => setTimeout(resolve, 0,))

beforeEach(() => {
	vi.clearAllMocks()
	getTime.mockReturnValue(NOW,)
	getModerationQueueListing.mockResolvedValue({data: {children: [],},},)
	getModmailUnreadCount.mockResolvedValue({},)
},)

describe('notifier poll throttle', () => {
	it('renders stored counts and skips the fetch when within the check interval', async () => {
		const module = makeModule({
			lastChecked: NOW - 1000,
			modqueueCount: 5,
			unmoderatedCount: 0,
			modmailCount: 2,
			modmailCategoryCount: {},
		},)
		const {getmessages,} = createNotifierHandlers(makeOptions(), module,)

		await getmessages()

		expect(getModerationQueueListing,).not.toHaveBeenCalled()
		expect(getModmailUnreadCount,).not.toHaveBeenCalled()
		expect(updateCounters,).toHaveBeenCalledWith({
			modqueueCount: 5,
			unmoderatedCount: 0,
			modmailCount: 2,
			modmailCategoryCount: {},
		},)
	})

	it('fetches on a genuine first load (lastChecked default -1)', async () => {
		const module = makeModule({lastChecked: -1,},)
		const {getmessages,} = createNotifierHandlers(makeOptions(), module,)

		await getmessages()

		expect(getModerationQueueListing,).toHaveBeenCalledTimes(1,)
		expect(getModmailUnreadCount,).toHaveBeenCalledTimes(1,)
	})

	it('fetches again once the interval has elapsed', async () => {
		const module = makeModule({lastChecked: NOW - (INTERVAL + 1),},)
		const {getmessages,} = createNotifierHandlers(makeOptions(), module,)

		await getmessages()

		expect(getModerationQueueListing,).toHaveBeenCalledTimes(1,)
	})

	it('forces a fetch on manual refresh even within the interval', async () => {
		const module = makeModule({lastChecked: NOW - 1000,},)
		const {handleCounterUpdate,} = createNotifierHandlers(makeOptions(), module,)

		// A no-detail counter update is the manual refresh signal: it zeroes
		// lastChecked and re-polls regardless of the throttle window.
		handleCounterUpdate({detail: null,} as CustomEvent,)
		await flush()

		expect(module.set,).toHaveBeenCalledWith('lastChecked', 0,)
		expect(getModerationQueueListing,).toHaveBeenCalledTimes(1,)
	})
})

describe('notifier new-item detection', () => {
	it('notifies for a new modqueue item even when the count is unchanged (churn)', async () => {
		const module = makeModule({
			lastChecked: NOW - (INTERVAL + 1), // stale -> fetch
			modqueueCount: 1, // same as the new count: a one-in-one-out churn
			modqueuePushed: ['t3_old',], // the item that rotated out was already notified
		},)
		getModerationQueueListing.mockResolvedValue({
			data: {
				children: [
					{
						kind: 't3',
						data: {name: 't3_new', permalink: '/r/s/x', title: 'New', author: 'a', subreddit: 's',},
					},
				],
			},
		},)
		const {getmessages,} = createNotifierHandlers(makeOptions({modNotifications: true,},), module,)

		await getmessages()
		await flush()

		// The count didn't grow, but the unseen item still fires a notification...
		expect(notification,).toHaveBeenCalledTimes(1,)
		// ...and is recorded so it won't be notified again.
		expect(module.set,).toHaveBeenCalledWith('modqueuePushed', expect.arrayContaining(['t3_new',],),)
	})

	it('does not renotify an item already in modqueuePushed', async () => {
		const module = makeModule({
			lastChecked: NOW - (INTERVAL + 1),
			modqueueCount: 0,
			modqueuePushed: ['t3_seen',],
		},)
		getModerationQueueListing.mockResolvedValue({
			data: {
				children: [
					{
						kind: 't3',
						data: {name: 't3_seen', permalink: '/r/s/x', title: 'Seen', author: 'a', subreddit: 's',},
					},
				],
			},
		},)
		const {getmessages,} = createNotifierHandlers(makeOptions({modNotifications: true,},), module,)

		await getmessages()
		await flush()

		expect(notification,).not.toHaveBeenCalled()
	})
})
