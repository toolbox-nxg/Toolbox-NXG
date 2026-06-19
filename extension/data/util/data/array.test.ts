/** Tests for array utilities. */

import {describe, expect, it,} from 'vitest'

import {saneSort, saneSortDescending, sortBy,} from './array'

describe('array utilities', () => {
	it('sorts objects descending by property value', () => {
		expect(sortBy([{score: 1,}, {score: 3,}, {score: 2,},], 'score',),).toEqual([
			{score: 3,},
			{score: 2,},
			{score: 1,},
		],)
	})

	it('sorts strings case-insensitively ascending and descending', () => {
		expect(saneSort(['beta', 'Alpha', 'gamma',],),).toEqual(['Alpha', 'beta', 'gamma',],)
		expect(saneSortDescending(['beta', 'Alpha', 'gamma',],),).toEqual(['gamma', 'beta', 'Alpha',],)
	})
})
