/** Tests for the Mod Log Matrix date range's clamp to Reddit's mod log history. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

import {clampToLogHistory,} from './MatrixSettings'

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(new Date('2026-11-14T19:30:00Z',),)
},)

afterEach(() => {
	vi.useRealTimers()
},)

describe('clampToLogHistory', () => {
	it('moves a date before the 90 days of mod log history up to the first day of it', () => {
		// 90 days inclusive of today: Aug 17 through Nov 14.
		expect(clampToLogHistory('2022-01-01',),).toBe('2026-08-17',)
		expect(clampToLogHistory('2026-08-16',),).toBe('2026-08-17',)
	})

	it('leaves dates inside the history, and an empty input, unchanged', () => {
		expect(clampToLogHistory('2026-08-17',),).toBe('2026-08-17',)
		expect(clampToLogHistory('2026-11-01',),).toBe('2026-11-01',)
		expect(clampToLogHistory('',),).toBe('',)
	})
})
