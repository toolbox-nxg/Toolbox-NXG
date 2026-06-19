/** Tests for counterStore. */

import {afterEach, describe, expect, it, vi,} from 'vitest'

import {getCounterState, requestCounterRefresh, subscribeCounters, updateCounters,} from './store'

function resetCounters () {
	updateCounters({
		modqueueCount: 0,
		modqueueBySubreddit: {},
		unmoderatedCount: 0,
		modmailCount: 0,
		modmailCategoryCount: {},
	},)
}

afterEach(() => {
	resetCounters()
	// Tests that subscribe must call the returned unsubscribe — listeners are module-level and persist.
},)

describe('counterStore', () => {
	it('starts with zero counts', () => {
		resetCounters()

		expect(getCounterState(),).toEqual({
			modqueueCount: 0,
			modqueueBySubreddit: {},
			unmoderatedCount: 0,
			modmailCount: 0,
			modmailCategoryCount: {},
		},)
	})

	it('merges partial updates into the current state', () => {
		updateCounters({modqueueCount: 3,},)
		updateCounters({modmailCategoryCount: {archived: 2,},},)

		expect(getCounterState(),).toMatchObject({
			modqueueCount: 3,
			unmoderatedCount: 0,
			modmailCategoryCount: {archived: 2,},
		},)
	})

	it('notifies subscribers with the updated state', () => {
		const listener = vi.fn()
		const unsubscribe = subscribeCounters(listener,)

		updateCounters({unmoderatedCount: 4,},)

		expect(listener,).toHaveBeenCalledOnce()
		expect(listener,).toHaveBeenCalledWith(expect.objectContaining({unmoderatedCount: 4,},),)

		unsubscribe()
	})

	it('stops notifying after unsubscribe', () => {
		const listener = vi.fn()
		const unsubscribe = subscribeCounters(listener,)

		unsubscribe()
		updateCounters({modqueueCount: 1,},)

		expect(listener,).not.toHaveBeenCalled()
	})
})

describe('requestCounterRefresh', () => {
	it('dispatches TB_UPDATE_COUNTERS on window with no detail', () => {
		const spy = vi.spyOn(window, 'dispatchEvent',)
		requestCounterRefresh()
		expect(spy,).toHaveBeenCalledOnce()
		const event = spy.mock.calls[0][0] as CustomEvent
		expect(event.type,).toBe('TB_UPDATE_COUNTERS',)
		expect(event.detail,).toBeNull()
		spy.mockRestore()
	})
})
