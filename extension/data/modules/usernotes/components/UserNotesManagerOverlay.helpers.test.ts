/** Tests for usernotes manager helpers. */

import {describe, expect, it,} from 'vitest'

import type {UserNoteColor, UsernotesUser,} from '../../../util/wiki/schemas/usernotes/schema'
import {
	createPrunePreview,
	filterUsers,
	getNoteStats,
	getUserNotesStatistics,
	sortUsers,
} from './UserNotesManagerOverlay.helpers'

const colors: UserNoteColor[] = [
	{key: 'ban', text: 'Ban', color: 'red',},
	{key: 'gooduser', text: 'Good Contributor', color: 'green',},
	{key: 'spam', text: 'Spam', color: 'purple',},
]

const users: UsernotesUser[] = [
	{
		name: 'charlie',
		notes: [
			{index: 0, note: 'new spam', type: 'spam', mod: 'zmod', time: 3000, link: '',},
			{index: 1, note: 'old ban', type: 'ban', mod: 'amod', time: 1000, link: '',},
		],
	},
	{
		name: 'alice',
		notes: [
			{index: 0, note: 'good note', type: 'gooduser', mod: 'bmod', time: 2000, link: '',},
		],
	},
	{
		name: 'bob',
		notes: [
			{index: 0, note: 'plain note', mod: 'cmod', time: 4000, link: '',},
			{index: 1, note: 'another plain note', mod: 'cmod', time: 3500, link: '',},
		],
	},
]

describe('usernotes manager helpers', () => {
	it('filters by user, note contents, and kind', () => {
		expect(filterUsers(users, {userText: 'ali', contentText: '', kind: [],},).map((u,) => u.name),).toEqual([
			'alice',
		],)
		expect(filterUsers(users, {userText: '', contentText: 'plain', kind: [],},).map((u,) => u.name),).toEqual([
			'bob',
		],)
		expect(filterUsers(users, {userText: '', contentText: '', kind: ['ban',],},).map((u,) => u.name),).toEqual([
			'charlie',
		],)
		expect(filterUsers(users, {userText: '', contentText: '', kind: ['__none',],},).map((u,) => u.name),).toEqual([
			'bob',
		],)
	})

	it('sorts users by username, date, kind, note count, and moderator', () => {
		expect(
			sortUsers(filterUsers(users, {userText: '', contentText: '', kind: [],},), 'username', 'asc', colors,)
				.map(
					(u,) => u.name,
				),
		)
			.toEqual(['alice', 'bob', 'charlie',],)
		expect(
			sortUsers(filterUsers(users, {userText: '', contentText: '', kind: [],},), 'date', 'desc', colors,).map(
				(u,) => u.name,
			),
		)
			.toEqual(['bob', 'charlie', 'alice',],)
		expect(
			sortUsers(filterUsers(users, {userText: '', contentText: '', kind: [],},), 'kind', 'asc', colors,).map(
				(u,) => u.name,
			),
		)
			.toEqual(['charlie', 'alice', 'bob',],)
		expect(
			sortUsers(filterUsers(users, {userText: '', contentText: '', kind: [],},), 'noteCount', 'desc', colors,)
				.map((u,) => u.name),
		)
			.toEqual(['bob', 'charlie', 'alice',],)
		expect(
			sortUsers(filterUsers(users, {userText: '', contentText: '', kind: [],},), 'moderator', 'asc', colors,)
				.map(
					(u,) => u.name,
				),
		)
			.toEqual(['charlie', 'alice', 'bob',],)
	})

	it('computes stats and type distribution', () => {
		const stats = getNoteStats([...users, {name: 'empty', notes: [],},], colors,)

		expect(stats.userCount,).toBe(3,)
		expect(stats.emptyUserCount,).toBe(1,)
		expect(stats.noteCount,).toBe(5,)
		expect(stats.oldestNoteTime,).toBe(1000,)
		expect(stats.newestNoteTime,).toBe(4000,)
		expect(stats.typeCounts.map((type,) => type.key),).toEqual(['ban', 'gooduser', 'spam', '__none',],)
		expect(stats.typeCounts.map((type,) => [type.key, type.count,]),).toContainEqual(['__none', 2,],)
	})

	it('computes statistics for the statistics tab', () => {
		const stats = getUserNotesStatistics([...users, {name: 'empty', notes: [],},], colors, 40 * 86400000 + 4000,)

		expect(stats.totalUsers,).toBe(4,)
		expect(stats.usersWithNotes,).toBe(3,)
		expect(stats.emptyUsers,).toBe(1,)
		expect(stats.totalNotes,).toBe(5,)
		expect(stats.averageNotesPerUser,).toBe(5 / 3,)
		expect(stats.maxNotesOnUser,).toBe(2,)
		expect(stats.notesWithLinks,).toBe(0,)
		expect(stats.notesWithoutTypes,).toBe(2,)
		expect(stats.uniqueModerators,).toBe(4,)
		expect(stats.storageBytesUsed,).toBeGreaterThan(0,)
		expect(stats.storageBytesRemaining,).toBeLessThan(1048576,)
		expect(stats.storagePercentUsed,).toBeGreaterThan(0,)
		expect(stats.topUsers.map((user,) => user.name),).toEqual(['bob', 'charlie', 'alice',],)
		expect(stats.moderatorCounts[0],).toEqual({name: 'cmod', count: 2,},)
		expect(stats.ageBuckets.map((bucket,) => [bucket.label, bucket.count,]),).toContainEqual(['30-90 days', 5,],)
	})

	it('hides archived notes unless the toggle is on', () => {
		const statusUsers: UsernotesUser[] = [
			{
				name: 'dave',
				notes: [
					{index: 0, note: 'active note', mod: 'amod', time: 1000, link: '',},
					{
						index: 1,
						note: 'archived note',
						mod: 'amod',
						time: 2000,
						link: '',
						archived: {by: 'bmod', at: 1,},
					},
				],
			},
		]
		const base = {userText: '', contentText: '', kind: [], moderator: 'all',}

		const hidden = filterUsers(statusUsers, base,)
		expect(hidden[0]!.notes.map((note,) => note.note),).toEqual(['active note',],)

		const withArchived = filterUsers(statusUsers, {...base, archived: 'include',},)
		expect(withArchived[0]!.notes.map((note,) => note.note),).toEqual(['active note', 'archived note',],)
	})

	it('counts archived notes in the statistics', () => {
		const statusUsers: UsernotesUser[] = [
			{
				name: 'dave',
				notes: [
					{index: 0, note: 'active note', mod: 'amod', time: 1000, link: '',},
					{
						index: 1,
						note: 'archived note',
						mod: 'amod',
						time: 2000,
						link: '',
						archived: {by: 'bmod', at: 1,},
					},
				],
			},
		]

		const stats = getUserNotesStatistics(statusUsers, colors, 10_000,)

		expect(stats.totalNotes,).toBe(2,)
		expect(stats.archivedNotes,).toBe(1,)
	})

	// Note `time` is epoch seconds; `createPrunePreview`'s `now` and
	// `pruneByNoteAgeLimit` are milliseconds (the prune compares `time * 1000`
	// against the ms threshold), so the limits/now below are scaled up by 1000.
	it('prunes archived notes like any others, preserving nextIndex', () => {
		const statusUsers: Record<string, UsernotesUser> = {
			dave: {
				name: 'dave',
				nextIndex: 3,
				notes: [
					{index: 0, note: 'recent', mod: 'amod', time: 9_000, link: '',},
					{
						index: 1,
						note: 'old archived',
						mod: 'amod',
						time: 1_000,
						link: '',
						archived: {by: 'bmod', at: 2,},
					},
				],
			},
		}

		const preview = createPrunePreview(
			statusUsers,
			{
				pruneByNoteAge: true,
				pruneByNoteAgeLimit: 5_000_000,
				pruneNoteTypeMode: 'all',
				pruneByUserDeleted: false,
				pruneByUserSuspended: false,
				pruneByUserInactivity: false,
				pruneByUserInactivityLimit: 0,
			},
			colors,
			10_000_000,
		)

		expect(preview.prunedNotes,).toBe(1,)
		expect(preview.users['dave']!.notes.map((note,) => note.note),).toEqual(['recent',],)
		// The purged note's index is never reissued: the counter survives.
		expect(preview.users['dave']!.nextIndex,).toBe(3,)
		// The match set records the pruned note's stable index — the real prune
		// drives delete/archive from this rather than re-deriving it.
		expect(preview.matched.get('dave',),).toEqual(new Set([1,],),)
	})

	it('does not report index-less notes as pruned, keeping preview and execution in lockstep', () => {
		// The codec always assigns an index on load, so this never happens for
		// real data — but if a note has no index, the real prune can't address
		// it, so the preview must not count, sample, or remove it either.
		const indexlessUsers: Record<string, UsernotesUser> = {
			dave: {
				name: 'dave',
				nextIndex: 2,
				notes: [
					{index: 0, note: 'old indexed', mod: 'amod', time: 1_000, link: '',},
					{note: 'old indexless', mod: 'amod', time: 1_000, link: '',},
				],
			},
		}

		const preview = createPrunePreview(
			indexlessUsers,
			{
				pruneByNoteAge: true,
				pruneByNoteAgeLimit: 5_000_000,
				pruneNoteTypeMode: 'all',
				pruneByUserDeleted: false,
				pruneByUserSuspended: false,
				pruneByUserInactivity: false,
				pruneByUserInactivityLimit: 0,
			},
			colors,
			10_000_000,
		)

		// Only the indexed note is pruned; the index-less note is kept.
		expect(preview.prunedNotes,).toBe(1,)
		expect(preview.sampleRows.map((row,) => row.note.note),).toEqual(['old indexed',],)
		expect(preview.matched.get('dave',),).toEqual(new Set([0,],),)
		expect(preview.users['dave']!.notes.map((note,) => note.note),).toEqual(['old indexless',],)
	})

	it('previews pruning notes older than a configurable day count', () => {
		const preview = createPrunePreview(
			Object.fromEntries(users.map((user,) => [user.name, user,]),),
			{
				pruneByNoteAge: true,
				pruneByNoteAgeLimit: 2_000_000,
				pruneByUserDeleted: false,
				pruneByUserSuspended: false,
				pruneByUserInactivity: false,
				pruneByUserInactivityLimit: 0,
			},
			colors,
			4_500_000,
		)

		expect(preview.prunedNotes,).toBe(2,)
		expect(preview.prunedUsers,).toBe(1,)
		// An emptied user keeps their record so note indexes stay stable.
		expect(preview.users.alice?.notes,).toEqual([],)
		expect(preview.users.charlie?.notes.map((note,) => note.note),).toEqual(['new spam',],)
	})

	it('supports include and exclude note kind pruning', () => {
		const source = Object.fromEntries(users.map((user,) => [user.name, user,]),)
		const emptyIncludePreview = createPrunePreview(
			source,
			{
				pruneByNoteAge: true,
				pruneByNoteAgeLimit: 10_000_000,
				pruneNoteTypeMode: 'include',
				pruneNoteTypes: [],
				pruneByUserDeleted: false,
				pruneByUserSuspended: false,
				pruneByUserInactivity: false,
				pruneByUserInactivityLimit: 0,
			},
			colors,
			20_000_000,
		)
		const includePreview = createPrunePreview(
			source,
			{
				pruneByNoteAge: true,
				pruneByNoteAgeLimit: 10_000_000,
				pruneNoteTypeMode: 'include',
				pruneNoteTypes: ['ban',],
				pruneByUserDeleted: false,
				pruneByUserSuspended: false,
				pruneByUserInactivity: false,
				pruneByUserInactivityLimit: 0,
			},
			colors,
			20_000_000,
		)
		const excludePreview = createPrunePreview(
			source,
			{
				pruneByNoteAge: true,
				pruneByNoteAgeLimit: 10_000_000,
				pruneNoteTypeMode: 'exclude',
				pruneNoteTypes: ['ban',],
				pruneByUserDeleted: false,
				pruneByUserSuspended: false,
				pruneByUserInactivity: false,
				pruneByUserInactivityLimit: 0,
			},
			colors,
			20_000_000,
		)

		expect(emptyIncludePreview.prunedNotes,).toBe(0,)
		expect(includePreview.prunedNotes,).toBe(1,)
		expect(includePreview.users.charlie?.notes.map((note,) => note.type),).toEqual(['spam',],)
		expect(excludePreview.prunedNotes,).toBe(4,)
		expect(excludePreview.users.charlie?.notes.map((note,) => note.type),).toEqual(['ban',],)
	})
})
