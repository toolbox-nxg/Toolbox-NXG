/** Tests for the Native Mod Log visibility rules, tab helpers, and ban duration parsing. */

import {describe, expect, it,} from 'vitest'

import type {ModNote,} from '../shared/modnotes/schema'
import {
	banDaysFromNote,
	compileBanDurationPattern,
	defaultTabIndex,
	isEntryVisible,
	isValidBanDays,
	tabLayout,
	visibleTabs,
	writeBanDaysToNote,
} from './schema'

function makeEntry (overrides: Partial<ModNote> = {},): ModNote {
	return {
		id: 'ModNote_1',
		created_at: 1,
		type: 'NOTE',
		operator: 'mod',
		subreddit: 'testsub',
		user: 'alice',
		label: null,
		description: null,
		details: null,
		user_note_data: {note: 'hello', label: null, reddit_id: null,},
		mod_action_data: null,
		...overrides,
	}
}

const summary = makeEntry({user_note_data: {note: 'A summary', label: 'USER_SUMMARY', reddit_id: null,},},)
const action = makeEntry({
	type: 'REMOVAL',
	user_note_data: null,
	mod_action_data: {action: 'removelink', details: null, description: null, reddit_id: null,},
},)

describe('isEntryVisible', () => {
	it('always shows ordinary notes', () => {
		expect(isEntryVisible(makeEntry(), {showAiSummaries: false, showModActions: false,},),).toBe(true,)
	})

	it('hides AI summaries unless they are turned on', () => {
		expect(isEntryVisible(summary, {showAiSummaries: false, showModActions: true,},),).toBe(false,)
		expect(isEntryVisible(summary, {showAiSummaries: true, showModActions: true,},),).toBe(true,)
	})

	it('hides mod actions when they are turned off', () => {
		expect(isEntryVisible(action, {showAiSummaries: false, showModActions: false,},),).toBe(false,)
		expect(isEntryVisible(action, {showAiSummaries: false, showModActions: true,},),).toBe(true,)
	})
})

describe('visibleTabs', () => {
	it('offers all three tabs when mod actions are shown', () => {
		expect(visibleTabs(true,).map((tab,) => tab.key),).toEqual(['all_activity', 'notes', 'mod_actions',],)
	})

	it('offers only the Notes tab when mod actions are hidden', () => {
		expect(visibleTabs(false,).map((tab,) => tab.key),).toEqual(['notes',],)
	})
})

describe('defaultTabIndex', () => {
	it('opens the preferred tab', () => {
		expect(defaultTabIndex(visibleTabs(true,), 'mod_actions',),).toBe(2,)
	})

	it('falls back to the first tab when the preferred one is hidden', () => {
		expect(defaultTabIndex(visibleTabs(false,), 'mod_actions',),).toBe(0,)
	})
})

describe('tabLayout', () => {
	const [allActivity, notes,] = visibleTabs(true,)

	it('switches the Notes tab to a table when the setting asks for one', () => {
		expect(tabLayout(notes!, 'table',),).toBe('table',)
	})

	it('leaves the Notes tab on its default cards otherwise', () => {
		expect(tabLayout(notes!, 'cards',),).toBeUndefined()
	})

	it('never changes the other tabs', () => {
		expect(tabLayout(allActivity!, 'table',),).toBeUndefined()
	})
})

describe('isValidBanDays', () => {
	it.each([1, 7, 999,],)('accepts %d', (days,) => {
		expect(isValidBanDays(days,),).toBe(true,)
	},)
	it.each([0, -1, 1000, 1.5, NaN,],)('rejects %d', (days,) => {
		expect(isValidBanDays(days,),).toBe(false,)
	},)
})

describe('compileBanDurationPattern', () => {
	it('is undefined when no pattern is set', () => {
		expect(compileBanDurationPattern('',),).toBeUndefined()
		expect(compileBanDurationPattern('   ',),).toBeUndefined()
		expect(compileBanDurationPattern(null,),).toBeUndefined()
	})
	it('reports a pattern that does not compile instead of throwing', () => {
		expect(compileBanDurationPattern(String.raw`(\d+`,),).toBe('invalid',)
	})
	it('matches without case', () => {
		const pattern = compileBanDurationPattern(String.raw`(\d+)D`,)
		expect(pattern instanceof RegExp && pattern.test('5d',),).toBe(true,)
	})
	it('records match positions, so the days can be rewritten in place', () => {
		const pattern = compileBanDurationPattern(String.raw`(\d+)d`,)
		expect(pattern instanceof RegExp && pattern.hasIndices,).toBe(true,)
	})
})

describe('banDaysFromNote', () => {
	const pattern = /^\s*(\d+)d\b/i

	it('reads the days from the first capture group', () => {
		expect(banDaysFromNote('5d toxicity', pattern,),).toEqual({kind: 'days', days: 5,},)
	})
	it('says nothing when the note does not match', () => {
		expect(banDaysFromNote('toxicity', pattern,),).toEqual({kind: 'none',},)
	})
	it('uses the whole match when the pattern has no group', () => {
		expect(banDaysFromNote('ban 12 days', /\d+/,),).toEqual({kind: 'days', days: 12,},)
	})
	it('says nothing when an optional group took no part in the match', () => {
		expect(banDaysFromNote('ban', /ban(?: (\d+))?/,),).toEqual({kind: 'none',},)
	})
	it('flags 0d as no ban length', () => {
		expect(banDaysFromNote('0d', pattern,),).toEqual({kind: 'invalid', text: '0',},)
	})
	it.each([1000, 1500, 36500,],)('reports %d days as longer than Reddit allows', (days,) => {
		expect(banDaysFromNote(`${days}d`, pattern,),).toEqual({kind: 'overMax', days,},)
	},)
	it('flags a number too large to read back exactly', () => {
		const digits = '99999999999999999999'
		expect(banDaysFromNote(`${digits}d`, pattern,),).toEqual({kind: 'invalid', text: digits,},)
	})
	it('flags a match that is not plain digits', () => {
		expect(banDaysFromNote('ban 5d', /ban (\S+)/,),).toEqual({kind: 'invalid', text: '5d',},)
	})
})

describe('writeBanDaysToNote', () => {
	const documented = /^\s*([\d.,]+)\s*d\b/i

	it('replaces only the length the pattern reads', () => {
		expect(writeBanDaysToNote('5d spam', documented, 57, 250,),).toBe('57d spam',)
		expect(writeBanDaysToNote('  5 d spam', documented, 7, 250,),).toBe('  7 d spam',)
	})
	it('fixes an invalid length', () => {
		expect(writeBanDaysToNote('1.5d test', documented, 2, 250,),).toBe('2d test',)
	})
	it('keeps whitespace the capture group took', () => {
		expect(writeBanDaysToNote('ban 5 days', /ban(\s*\d+\s*)days/, 30, 250,),).toBe('ban 30 days',)
	})
	it('uses the whole match when the pattern has no group', () => {
		expect(writeBanDaysToNote('spam 5', /\d+$/, 12, 250,),).toBe('spam 12',)
	})
	it('leaves a note with no length alone', () => {
		expect(writeBanDaysToNote('spam', documented, 7, 250,),).toBeUndefined()
	})
	it('does not make a rewrite that would be too long', () => {
		expect(writeBanDaysToNote('5d spam', documented, 500, 8,),).toBeUndefined()
	})
	it('does not make a rewrite the pattern would not read back', () => {
		// A pattern for a single digit can't hold 57.
		expect(writeBanDaysToNote('5d spam', /^(\d)d/, 57, 250,),).toBeUndefined()
	})
})
