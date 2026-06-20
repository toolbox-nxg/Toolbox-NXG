/** Tests for report-reason extraction and suggested-reason matching. */

import {describe, expect, it,} from 'vitest'

import type {SuggestedReasonMapping,} from './schema'
import {extractReportReasons, matchSuggestedReasons,} from './suggested'

/** Builds an old-Reddit `.thing` with the given mod-report and user-report texts. */
function oldRedditThing (modReports: string[], userReports: string[],): Element {
	const wrapper = document.createElement('div',)
	wrapper.innerHTML = `
		<div class="thing">
			<div class="report-reasons">
				${modReports.map((t,) => `<div class="mod-report">${t}</div>`).join('',)}
				${userReports.map((t,) => `<div class="user-report">${t}</div>`).join('',)}
			</div>
		</div>
	`
	return wrapper.querySelector('.thing',)!
}

/** Builds a Shreddit queue item carrying the given `mod-queue-reasons` JSON. */
function shredditItem (reasons: unknown[],): Element {
	const wrapper = document.createElement('div',)
	const json = JSON.stringify(reasons,).replace(/"/g, '&quot;',)
	wrapper.innerHTML = `
		<shreddit-post view-context="ModQueue">
			<modqueue-smart-truncate-text mod-queue-reasons="${json}"></modqueue-smart-truncate-text>
		</shreddit-post>
	`
	return wrapper.querySelector('shreddit-post',)!
}

describe('extractReportReasons', () => {
	it('returns [] for a missing element', () => {
		expect(extractReportReasons(null,),).toEqual([],)
	})

	it('splits old-Reddit mod reports into reporter + text and strips the user-report count', () => {
		const thing = oldRedditThing(['AutoModerator: low effort post',], ['spam (3)',],)

		expect(extractReportReasons(thing,),).toEqual([
			{source: 'mod', reporter: 'AutoModerator', text: 'low effort post',},
			// The trailing aggregate count "(3)" is stripped so it doesn't block substring matches.
			{source: 'user', reporter: '', text: 'spam',},
		],)
	})

	it('strips only a trailing numeric count, leaving other trailing parentheses intact', () => {
		const thing = oldRedditThing([], ['off-topic (meta) (12)',],)

		expect(extractReportReasons(thing,),).toEqual([
			{source: 'user', reporter: '', text: 'off-topic (meta)',},
		],)
	})

	it('lets a mapping match a user report after the trailing count is stripped', () => {
		const thing = oldRedditThing([], ['spam (3)',],)
		const mapping: SuggestedReasonMapping = {
			pattern: 'spam',
			includeUserReports: true,
			reasonIds: ['r1',],
		}

		expect(matchSuggestedReasons(extractReportReasons(thing,), [mapping,],),).toEqual(['r1',],)
	})

	it('parses Shreddit reasons, deriving AutoMod reporter from the AUTOMOD icon', () => {
		const item = shredditItem([
			{__typename: 'AutoModFilterReason', title: 'low effort', icon: 'AUTOMOD',},
			{__typename: 'ModReportReason', title: 'rule 3', icon: '', actor: {displayName: 'SomeMod',},},
			{__typename: 'UserReportReason', title: 'spam', icon: '',},
		],)

		expect(extractReportReasons(item,),).toEqual([
			{source: 'mod', reporter: 'AutoModerator', text: 'low effort',},
			{source: 'mod', reporter: 'SomeMod', text: 'rule 3',},
			{source: 'user', reporter: '', text: 'spam',},
		],)
	})
})

describe('matchSuggestedReasons', () => {
	const reports = [
		{source: 'mod' as const, reporter: 'AutoModerator', text: 'Low Effort post',},
		{source: 'user' as const, reporter: '', text: 'this is spam',},
	]

	function mapping (overrides: Partial<SuggestedReasonMapping>,): SuggestedReasonMapping {
		return {pattern: 'low effort', reasonIds: ['r1',], ...overrides,}
	}

	it('returns [] when there are no mappings or no reports', () => {
		expect(matchSuggestedReasons(reports, undefined,),).toEqual([],)
		expect(matchSuggestedReasons([], [mapping({},),],),).toEqual([],)
	})

	it('matches case-insensitive substrings', () => {
		expect(matchSuggestedReasons(reports, [mapping({},),],),).toEqual(['r1',],)
	})

	it('only matches user reports when includeUserReports is set', () => {
		const spam = mapping({pattern: 'spam', reasonIds: ['r2',],},)
		expect(matchSuggestedReasons(reports, [spam,],),).toEqual([],)
		expect(matchSuggestedReasons(reports, [{...spam, includeUserReports: true,},],),).toEqual(['r2',],)
	})

	it('de-duplicates reason ids across mappings, preserving order', () => {
		const result = matchSuggestedReasons(reports, [
			mapping({reasonIds: ['r1', 'r2',],},),
			mapping({pattern: 'effort', reasonIds: ['r2', 'r3',],},),
		],)
		expect(result,).toEqual(['r1', 'r2', 'r3',],)
	})
})
