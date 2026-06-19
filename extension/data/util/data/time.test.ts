/** Tests for time utilities. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

import {
	coerceEpochSeconds,
	daysToMilliseconds,
	formatRelativeTime,
	getTime,
	millisecondsToDays,
	minutesToMilliseconds,
	niceDateDiff,
	timeConverterRead,
} from './time'

describe('time utilities', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-01-15T12:00:00Z',),)
	},)

	afterEach(() => {
		vi.useRealTimers()
	},)

	it('formats relative time across common units', () => {
		expect(formatRelativeTime(new Date('2024-01-15T11:59:30Z',),),).toBe('30 seconds ago',)
		expect(formatRelativeTime(new Date('2024-01-15T10:00:00Z',),),).toBe('2 hours ago',)
		expect(formatRelativeTime(new Date('2024-01-18T12:00:00Z',),),).toBe('in 3 days',)
	})

	it('returns current time in milliseconds', () => {
		expect(getTime(),).toBe(new Date('2024-01-15T12:00:00Z',).getTime(),)
	})

	it('converts minutes and days to milliseconds', () => {
		expect(minutesToMilliseconds(10,),).toBe(600000,)
		expect(minutesToMilliseconds(0,),).toBe(60000,)
		expect(daysToMilliseconds(2,),).toBe(172800000,)
		expect(millisecondsToDays(172800000,),).toBe(2,)
	})

	it('formats date differences', () => {
		expect(niceDateDiff(new Date('2022-01-10T00:00:00Z',), new Date('2024-03-12T00:00:00Z',),),).toBe(
			'2 years, 2 months and 2 days',
		)
		expect(niceDateDiff(new Date('2024-01-15T00:00:00Z',), new Date('2024-01-15T00:00:00Z',),),).toBe('0 days',)
	})

	it('converts unix timestamps to UTC readable strings', () => {
		expect(timeConverterRead(0,),).toBe('01-01-1970 00:00:00 UTC',)
		expect(timeConverterRead(1705320000,),).toBe('15-01-2024 12:00:00 UTC',)
	})
})

describe('coerceEpochSeconds', () => {
	it('passes through a plausible epoch-seconds timestamp unchanged', () => {
		expect(coerceEpochSeconds(1_700_000_000,),).toBe(1_700_000_000,)
	})

	it('rescales a millisecond timestamp back to seconds', () => {
		// Date.now()-style ms value (~2023) → the matching second value.
		expect(coerceEpochSeconds(1_700_000_000_123,),).toBe(1_700_000_000,)
	})

	it('is idempotent: re-coercing an already-healed value is a no-op', () => {
		expect(coerceEpochSeconds(coerceEpochSeconds(1_700_000_000_123,),),).toBe(1_700_000_000,)
	})

	it('leaves 0 and other small values alone', () => {
		expect(coerceEpochSeconds(0,),).toBe(0,)
		expect(coerceEpochSeconds(1,),).toBe(1,)
	})
})
