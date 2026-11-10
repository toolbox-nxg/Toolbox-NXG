/** Tests for the pure UserOverviewTab helpers. */

import {describe, expect, it,} from 'vitest'

import type {ModNote,} from '../../shared/modnotes/schema'
import {classifyCommentBody, formatBanDate, processModNotes, truncateText,} from './UserOverviewTab.helpers'

function makeModNote (overrides: Partial<ModNote> = {},): ModNote {
	return {
		id: 'note_1',
		created_at: 1000000,
		type: 'MOD_ACTION',
		operator: 'mod1',
		subreddit: 'testsub',
		user: 'testuser',
		label: null,
		description: null,
		details: null,
		user_note_data: null,
		mod_action_data: null,
		...overrides,
	}
}

describe('processModNotes', () => {
	it('returns empty result for no notes', () => {
		const result = processModNotes([],)
		expect(result.bans,).toEqual([],)
		expect(result.currentlyBanned,).toBe(false,)
		expect(result.totalRemovalCount,).toBe(0,)
		expect(result.recentRemovals,).toEqual([],)
	})

	it('collects a ban entry with correct fields', () => {
		const note = makeModNote({
			id: 'ban_1',
			created_at: 1700000000,
			operator: 'mod_alice',
			mod_action_data: {action: 'banuser', details: '30 days', description: 'rule violation', reddit_id: null,},
		},)
		const result = processModNotes([note,],)
		expect(result.bans.length,).toBe(1,)
		expect(result.bans[0]!.id,).toBe('ban_1',)
		expect(result.bans[0]!.duration,).toBe('30 days',)
		expect(result.bans[0]!.moderator,).toBe('mod_alice',)
		expect(result.bans[0]!.reason,).toBe('rule violation',)
		expect(result.currentlyBanned,).toBe(true,)
	})

	it('sets currentlyBanned=false when newest action is unban', () => {
		const unban = makeModNote({
			id: 'unban_1',
			created_at: 1700000100,
			mod_action_data: {action: 'unbanuser', details: null, description: null, reddit_id: null,},
		},)
		const ban = makeModNote({
			id: 'ban_1',
			created_at: 1700000000,
			mod_action_data: {action: 'banuser', details: 'permanent', description: null, reddit_id: null,},
		},)
		// Notes are newest-first from the API
		const result = processModNotes([unban, ban,],)
		expect(result.currentlyBanned,).toBe(false,)
		expect(result.bans.length,).toBe(1,)
	})

	it('counts all removals regardless of date', () => {
		const notes = [1700000500, 1699999999, 1000000000,].map((ts,) =>
			makeModNote({
				created_at: ts,
				mod_action_data: {action: 'removecomment', details: null, description: null, reddit_id: `t1_${ts}`,},
			},)
		)
		const result = processModNotes(notes,)
		expect(result.totalRemovalCount,).toBe(3,)
		expect(result.recentRemovals.length,).toBe(3,)
	})

	it('does not double-count the same reddit_id removed twice', () => {
		const remove1 = makeModNote({
			id: 'remove_1',
			created_at: 1700000100,
			mod_action_data: {action: 'removecomment', details: null, description: null, reddit_id: 't1_abc',},
		},)
		const remove2 = makeModNote({
			id: 'remove_2',
			created_at: 1700000000,
			mod_action_data: {action: 'removecomment', details: null, description: null, reddit_id: 't1_abc',},
		},)
		const result = processModNotes([remove1, remove2,],)
		expect(result.totalRemovalCount,).toBe(1,)
		expect(result.recentRemovals.length,).toBe(1,)
	})

	it('collects at most 3 recent removals even with more notes', () => {
		const notes = [1, 2, 3, 4, 5,].map((i,) =>
			makeModNote({
				id: `removal_${i}`,
				created_at: 1700000000 + i,
				mod_action_data: {action: 'removecomment', details: null, description: null, reddit_id: `t1_${i}`,},
			},)
		)
		const result = processModNotes(notes,)
		expect(result.recentRemovals.length,).toBe(3,)
		expect(result.totalRemovalCount,).toBe(5,)
	})

	it('defaults ban duration to permanent when details is null', () => {
		const note = makeModNote({
			mod_action_data: {action: 'banuser', details: null, description: null, reddit_id: null,},
		},)
		const result = processModNotes([note,],)
		expect(result.bans[0]!.duration,).toBe('permanent',)
	})

	it('skips notes where mod_action_data is null', () => {
		const note = makeModNote({mod_action_data: null,},)
		const result = processModNotes([note,],)
		expect(result.bans,).toEqual([],)
		expect(result.currentlyBanned,).toBe(false,)
	})
})

describe('classifyCommentBody', () => {
	it('classifies as deleted when author is [deleted]', () => {
		expect(classifyCommentBody({body: 'some text', author: '[deleted]', spam: undefined, bannedBy: null,},),).toBe(
			'deleted',
		)
	})

	it('classifies as deleted when body is [deleted]', () => {
		expect(classifyCommentBody({body: '[deleted]', author: 'alice', spam: undefined, bannedBy: null,},),).toBe(
			'deleted',
		)
	})

	it('classifies as removed-by-reddit when spam is true', () => {
		expect(classifyCommentBody({body: 'text', author: 'alice', spam: true, bannedBy: null,},),).toBe(
			'removed-by-reddit',
		)
	})

	it('classifies as removed-by-reddit when bannedBy is true', () => {
		expect(classifyCommentBody({body: 'text', author: 'alice', spam: undefined, bannedBy: true,},),).toBe(
			'removed-by-reddit',
		)
	})

	it('classifies as removed-by-reddit when bannedBy is "reddit"', () => {
		expect(classifyCommentBody({body: 'text', author: 'alice', spam: undefined, bannedBy: 'reddit',},),).toBe(
			'removed-by-reddit',
		)
	})

	it('classifies as available when no removal signals are present', () => {
		expect(classifyCommentBody({body: 'hello world', author: 'alice', spam: undefined, bannedBy: null,},),).toBe(
			'available',
		)
	})
})

describe('formatBanDate', () => {
	it('formats a date as DD Mon YY', () => {
		expect(formatBanDate(new Date(2025, 5, 14,),),).toBe('14 Jun 25',)
	})

	it('formats a date with zero-padded day', () => {
		expect(formatBanDate(new Date(2024, 0, 3,),),).toBe('03 Jan 24',)
	})
})

describe('truncateText', () => {
	it('returns text unchanged when shorter than maxLength', () => {
		expect(truncateText('hello', 10,),).toBe('hello',)
	})

	it('truncates with ellipsis when longer than maxLength', () => {
		expect(truncateText('hello world', 5,),).toBe('hello…',)
	})

	it('returns text unchanged at exact boundary', () => {
		expect(truncateText('hello', 5,),).toBe('hello',)
	})
})
