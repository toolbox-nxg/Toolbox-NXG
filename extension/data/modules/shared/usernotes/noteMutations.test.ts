/** Tests for index-addressed usernote mutations. */

// @vitest-environment node
import {describe, expect, it,} from 'vitest'

import {nowInSeconds,} from '../../../util/data/time'
import type {UserNoteEntry, UserNotesData,} from '../../../util/wiki/schemas/usernotes/schema'
import {applyUserNoteMutation, makeUserNoteEntry, mergeDualKeyNotes,} from './noteMutations'

/** A dataset with one user holding two indexed notes (newest first). */
function makeData (): UserNotesData {
	return {
		ver: 6,
		users: {
			alice: {
				name: 'alice',
				nextIndex: 2,
				notes: [
					{index: 1, note: 'newer', time: 2_000_000_000_000, mod: 'mod1', type: '', link: '',},
					{index: 0, note: 'older', time: 1_000_000_000_000, mod: 'mod1', type: 'ban', link: '',},
				],
			},
		},
	}
}

const newNote: UserNoteEntry = {note: 'fresh', time: 3_000_000_000_000, mod: 'mod2', type: '', link: '',}

describe('makeUserNoteEntry', () => {
	it('trims the note text', () => {
		const entry = makeUserNoteEntry({note: '  spaced  ', mod: 'm', time: 1,},)
		expect(entry.note,).toBe('spaced',)
	})

	it('defaults time to the current time in epoch seconds, not milliseconds', () => {
		const before = nowInSeconds()
		const entry = makeUserNoteEntry({note: 'n', mod: 'm',},)
		const after = nowInSeconds()
		expect(entry.time,).toBeGreaterThanOrEqual(before,)
		expect(entry.time,).toBeLessThanOrEqual(after,)
	})

	it('uses an explicit time when given', () => {
		expect(makeUserNoteEntry({note: 'n', mod: 'm', time: 42,},).time,).toBe(42,)
	})

	it('omits type, link, and messageLink when unset or empty', () => {
		const entry = makeUserNoteEntry({note: 'n', mod: 'm', time: 1, link: '',},)
		expect(entry,).toEqual({note: 'n', mod: 'm', time: 1,},)
		expect('type' in entry,).toBe(false,)
		expect('link' in entry,).toBe(false,)
		expect('messageLink' in entry,).toBe(false,)
	})

	it('keeps an empty type (type-only notes) but drops an empty link', () => {
		const entry = makeUserNoteEntry({note: 'n', mod: 'm', time: 1, type: '', link: '',},)
		expect(entry.type,).toBe('',)
		expect('link' in entry,).toBe(false,)
	})

	it('includes type, link, and messageLink when provided', () => {
		const entry = makeUserNoteEntry({
			note: 'n',
			mod: 'm',
			time: 1,
			type: 'ban',
			link: '/r/sub/comments/abc/',
			messageLink: '/r/sub/message/messages/xyz',
		},)
		expect(entry,).toEqual({
			note: 'n',
			mod: 'm',
			time: 1,
			type: 'ban',
			link: '/r/sub/comments/abc/',
			messageLink: '/r/sub/message/messages/xyz',
		},)
	})
})

describe('applyUserNoteMutation', () => {
	it('adds a note with the next index and bumps nextIndex', () => {
		const data = makeData()

		const message = applyUserNoteMutation(data, 'alice', {change: 'add', note: newNote,},)

		expect(message,).toBe('create new note on user alice',)
		const user = data.users['alice']!
		expect(user.notes[0],).toMatchObject({index: 2, note: 'fresh',},)
		expect(user.nextIndex,).toBe(3,)
	})

	it('creates a new user starting at index 0', () => {
		const data: UserNotesData = {ver: 6, users: {},}

		const message = applyUserNoteMutation(data, 'bob', {change: 'add', note: newNote,},)

		expect(message,).toBe('create new note on new user bob',)
		expect(data.users['bob']!.notes[0]!.index,).toBe(0,)
		expect(data.users['bob']!.nextIndex,).toBe(1,)
	})

	it('continues from the persisted nextIndex after tombstones are purged', () => {
		const data = makeData()
		// Simulate a prune that hard-removed the index-1 note; nextIndex stays.
		data.users['alice']!.notes.splice(0, 1,)

		applyUserNoteMutation(data, 'alice', {change: 'add', note: newNote,},)

		// Index 1 is never reissued.
		expect(data.users['alice']!.notes[0]!.index,).toBe(2,)
	})

	it('deletes a note by index, keeping the remaining indexes intact', () => {
		const data = makeData()

		const message = applyUserNoteMutation(data, 'alice', {change: 'delete', index: 0,},)

		expect(message,).toBe('delete note 0 on user alice',)
		expect(data.users['alice']!.notes,).toHaveLength(1,)
		expect(data.users['alice']!.notes[0]!.index,).toBe(1,)
		// The counter survives so the deleted index is never reissued.
		expect(data.users['alice']!.nextIndex,).toBe(2,)
	})

	it('retains the user record when the last note is deleted', () => {
		const data = makeData()
		applyUserNoteMutation(data, 'alice', {change: 'delete', index: 0,},)
		applyUserNoteMutation(data, 'alice', {change: 'delete', index: 1,},)

		// The emptied record survives, carrying the index counter.
		expect(data.users['alice'],).toMatchObject({notes: [], nextIndex: 2,},)

		// A later note continues the sequence instead of restarting at 0.
		const message = applyUserNoteMutation(data, 'alice', {change: 'add', note: newNote,},)
		expect(message,).toBe('create new note on user alice',)
		expect(data.users['alice']!.notes[0]!.index,).toBe(2,)
		expect(data.users['alice']!.nextIndex,).toBe(3,)
	})

	it('archives and unarchives a note with attribution', () => {
		const data = makeData()

		const message = applyUserNoteMutation(data, 'alice', {change: 'archive', index: 1, by: 'mod2',},)

		expect(message,).toBe('archive note 1 on user alice',)
		const note = data.users['alice']!.notes.find((n,) => n.index === 1)!
		expect(note.archived?.by,).toBe('mod2',)
		// The note itself is untouched.
		expect(note.note,).toBe('newer',)

		applyUserNoteMutation(data, 'alice', {change: 'unarchive', index: 1,},)
		expect(data.users['alice']!.notes.find((n,) => n.index === 1)!.archived,).toBeUndefined()
	})

	it('edits note text and type while preserving metadata', () => {
		const data = makeData()

		const message = applyUserNoteMutation(data, 'alice', {
			change: 'edit',
			index: 0,
			note: {note: 'corrected note', type: 'spam',},
		},)

		expect(message,).toBe('edit note 0 on user alice',)
		const note = data.users['alice']!.notes.find((n,) => n.index === 0)!
		expect(note,).toMatchObject({
			note: 'corrected note',
			type: 'spam',
			time: 1_000_000_000_000,
			mod: 'mod1',
		},)
	})

	it('returns undefined for mutations on unknown indexes or users', () => {
		const data = makeData()
		expect(applyUserNoteMutation(data, 'alice', {change: 'delete', index: 99,},),).toBeUndefined()
		expect(applyUserNoteMutation(data, 'ghost', {change: 'archive', index: 0, by: 'm',},),).toBeUndefined()
		expect(data.users['alice']!.notes,).toHaveLength(2,)
	})

	it('finds a user stored under a lowercase key when looked up with mixed case', () => {
		const data = makeData() // stored as 'alice'

		applyUserNoteMutation(data, 'Alice', {change: 'add', note: newNote,},)

		// Old lowercase key removed; new key matches the caller's casing.
		expect(data.users['alice'],).toBeUndefined()
		expect(data.users['Alice']!.notes.map((n,) => n.note),).toEqual(['fresh', 'newer', 'older',],)
	})

	it('consolidates dual-key users without index collisions', () => {
		const data: UserNotesData = {
			ver: 6,
			users: {
				alice: {
					name: 'alice',
					nextIndex: 1,
					notes: [{index: 0, note: 'lowercase note', time: 1_000_000_000_000, mod: 'mod1',},],
				},
				Alice: {
					name: 'Alice',
					nextIndex: 1,
					notes: [{index: 0, note: 'canonical note', time: 2_000_000_000_000, mod: 'mod1',},],
				},
			},
		}

		applyUserNoteMutation(data, 'Alice', {change: 'add', note: newNote,},)

		expect(data.users['alice'],).toBeUndefined()
		const merged = data.users['Alice']!
		const indexes = merged.notes.map((note,) => note.index)
		expect(new Set(indexes,).size,).toBe(merged.notes.length,)
		// Canonical keeps index 0; the lowercase note is offset past it.
		expect(merged.notes.find((note,) => note.note === 'canonical note')!.index,).toBe(0,)
		expect(merged.notes.find((note,) => note.note === 'lowercase note')!.index,).toBe(1,)
		expect(merged.notes[0],).toMatchObject({note: 'fresh', index: 2,},)
		expect(merged.nextIndex,).toBe(3,)
	})

	it('exact-case match does not migrate the storage key', () => {
		const data = makeData()

		applyUserNoteMutation(data, 'alice', {change: 'add', note: newNote,},)

		expect(data.users['alice'],).toBeDefined()
		expect(data.users['alice']!.notes.map((n,) => n.note),).toEqual(['fresh', 'newer', 'older',],)
	})
})

describe('mergeDualKeyNotes', () => {
	it('offsets lowercase indexes past the canonical index space, newest first', () => {
		const merged = mergeDualKeyNotes(
			[
				{index: 0, note: 'a', time: 1_000, mod: 'm',},
				{index: 1, note: 'b', time: 2_000, mod: 'm',},
			],
			{name: 'User', nextIndex: 2, notes: [{index: 1, note: 'c', time: 3_000, mod: 'm',},],},
		)

		expect(merged.notes.map((note,) => [note.note, note.index,]),).toEqual([
			['c', 1,],
			['b', 3,],
			['a', 2,],
		],)
		expect(merged.nextIndex,).toBe(4,)
	})
})
