/** Tests for the pure HistoryPopup helpers. */

import {describe, expect, it,} from 'vitest'

import {sortByCountWithPinned,} from './HistoryPopup.helpers'

const entries: [string, number,][] = [['a', 2,], ['b', 9,], ['c', 5,],]
const count = (value: number,) => value

describe('sortByCountWithPinned', () => {
	it('sorts by count, highest first, when nothing is pinned', () => {
		expect(sortByCountWithPinned(entries, count, null,).map(([key,],) => key),).toEqual(['b', 'c', 'a',],)
	})

	it('moves the pinned key to the front and keeps the rest in count order', () => {
		expect(sortByCountWithPinned(entries, count, 'a',).map(([key,],) => key),).toEqual(['a', 'b', 'c',],)
	})

	it('leaves the order alone when the pinned key is absent', () => {
		expect(sortByCountWithPinned(entries, count, 'z',).map(([key,],) => key),).toEqual(['b', 'c', 'a',],)
	})

	it('does not modify the input', () => {
		sortByCountWithPinned(entries, count, 'a',)
		expect(entries.map(([key,],) => key),).toEqual(['a', 'b', 'c',],)
	})
})
