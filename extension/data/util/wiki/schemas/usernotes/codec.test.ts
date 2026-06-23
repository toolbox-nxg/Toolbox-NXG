/** Tests for the usernotes wire-format codecs (nxg-usernotes shards and legacy v6). */

import {inflateSync,} from 'node:zlib'
import {beforeEach, describe, expect, it, vi,} from 'vitest'

const sendMessage = vi.hoisted(() => vi.fn())
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage,},},}),)

import {
	buildShardPayload,
	buildUsernotesV6Payload,
	decodeNotesShard,
	decodeUsernotesV6,
	encodeNotesShard,
	encodeUsernotesV6,
	isNxgUsernotesShardPage,
	noteIdentityKey,
	seedV6Types,
} from './codec'
import type {NxgUsernotesShardPage, UserNotesData, UsernotesUser,} from './schema'

/** Implements the background decompress message with real (node) zlib. */
function mockBackgroundCodecs () {
	sendMessage.mockImplementation(async (msg: {action?: string; blob?: string},) => {
		if (msg.action === 'toolbox-usernote-decompress') {
			const json = inflateSync(Buffer.from(msg.blob, 'base64',),).toString('latin1',)
			return {users: JSON.parse(json,),}
		}
		throw new Error(`unexpected message: ${msg.action}`,)
	},)
}

/** A user slice exercising indexes, archive attributions, and all link kinds. */
function makeUsers (): Record<string, UsernotesUser> {
	return {
		alice: {
			name: 'alice',
			nextIndex: 3,
			notes: [
				{
					index: 0,
					note: 'comment link',
					time: 1_600_000_000,
					mod: 'mod1',
					type: 'gooduser',
					link: '/r/testsub/comments/abc123/-/def456/',
				},
				{
					index: 1,
					note: 'archived note',
					time: 1_600_000_060,
					mod: 'mod2',
					type: 'shadowwatch',
					link: '',
					archived: {by: 'mod1', at: 1_700_000_000,},
				},
				{
					index: 2,
					note: 'second archived note',
					time: 1_600_000_120,
					mod: 'mod1',
					type: '',
					link: '',
					archived: {by: 'mod2', at: 1_700_000_100,},
				},
			],
		},
		bob: {
			name: 'bob',
			nextIndex: 1,
			notes: [
				{
					index: 0,
					note: 'modmail link',
					time: 1_600_086_400,
					mod: 'mod2',
					type: '',
					link: '/r/testsub/message/messages/qqq111',
					messageLink: 'https://www.reddit.com/mail/perma/abc999',
				},
			],
		},
	}
}

beforeEach(() => {
	sendMessage.mockReset()
	mockBackgroundCodecs()
},)

describe('nxg-usernotes shard codec', () => {
	it('round-trips users through encode and decode', async () => {
		const users = makeUsers()

		const page = encodeNotesShard(users,)
		expect(page.format,).toBe('nxg-usernotes',)
		expect(page.ver,).toBe(1,)
		expect(isNxgUsernotesShardPage(page,),).toBe(true,)

		const decoded = await decodeNotesShard(page, 'sub#s1',)
		expect(decoded.corrupted,).toBe(false,)
		expect(decoded.users,).toEqual(users,)
	})

	it('heals note times mistakenly stored in milliseconds back to seconds on decode', async () => {
		const users: Record<string, UsernotesUser> = {
			alice: {
				name: 'alice',
				nextIndex: 1,
				// Written by the old removal bug as Date.now() (milliseconds).
				notes: [{index: 0, note: 'bad time', time: 1_700_000_000_123, mod: 'm',},],
			},
		}

		const decoded = await decodeNotesShard(encodeNotesShard(users,), 'sub#s1',)

		expect(decoded.corrupted,).toBe(false,)
		expect(decoded.users['alice']!.notes[0]!.time,).toBe(1_700_000_000,)
	})

	it('heals an archived `at` stored in milliseconds back to seconds on decode', async () => {
		const users: Record<string, UsernotesUser> = {
			alice: {
				name: 'alice',
				nextIndex: 1,
				notes: [{
					index: 0,
					note: 'archived',
					time: 1_600_000_000,
					mod: 'm',
					archived: {by: 'mod2', at: 1_700_000_000_123,},
				},],
			},
		}

		const decoded = await decodeNotesShard(encodeNotesShard(users,), 'sub#s1',)

		expect(decoded.corrupted,).toBe(false,)
		expect(decoded.users['alice']!.notes[0]!.archived,).toEqual({by: 'mod2', at: 1_700_000_000,},)
	})

	it('serializes a human-readable payload with named keys and omitted empty fields', () => {
		const payload = buildShardPayload(makeUsers(),)

		// Sorted user order, persisted nextIndex.
		expect(Object.keys(payload,),).toEqual(['alice', 'bob',],)
		expect(payload['alice']!.nextIndex,).toBe(3,)

		const [active, archived, secondArchived,] = payload['alice']!.notes
		expect(active,).toEqual({
			index: 0,
			note: 'comment link',
			time: 1_600_000_000,
			mod: 'mod1',
			type: 'gooduser',
			link: '/r/testsub/comments/abc123/-/def456/',
		},)
		// Empty type/link are omitted, not serialized as ''.
		expect(secondArchived,).toEqual({
			index: 2,
			note: 'second archived note',
			time: 1_600_000_120,
			mod: 'mod1',
			archived: {by: 'mod2', at: 1_700_000_100,},
		},)
		expect(archived!.archived,).toEqual({by: 'mod1', at: 1_700_000_000,},)
		// The removal message link serializes under its named key; notes
		// without one omit the key entirely (checked via `active` above).
		expect(payload['bob']!.notes[0]!.messageLink,).toBe('https://www.reddit.com/mail/perma/abc999',)
	})

	it('round-trips a user emptied of notes, preserving nextIndex', async () => {
		// Deleting a user's last note retains the record so the index counter
		// survives; the shard format must carry it through a save/load cycle.
		const users: Record<string, UsernotesUser> = {
			emptied: {name: 'emptied', notes: [], nextIndex: 4,},
		}

		const decoded = await decodeNotesShard(encodeNotesShard(users,), 'sub#s1',)
		expect(decoded.corrupted,).toBe(false,)
		expect(decoded.users,).toEqual(users,)
	})

	it('is deterministic regardless of user key order', () => {
		const users = makeUsers()
		const reversed = Object.fromEntries(Object.entries(users,).reverse(),)

		expect(JSON.stringify(buildShardPayload(users,),),)
			.toBe(JSON.stringify(buildShardPayload(reversed,),),)
	})

	it('assigns missing indexes in array order, continuing past existing ones', () => {
		const users: Record<string, UsernotesUser> = {
			alice: {
				name: 'alice',
				notes: [
					{note: 'first', time: 1, mod: 'm',},
					{index: 5, note: 'indexed', time: 2, mod: 'm',},
					{note: 'second', time: 3, mod: 'm',},
				],
			},
		}

		const payload = buildShardPayload(users,)

		expect(payload['alice']!.notes.map((note,) => note.index),).toEqual([6, 5, 7,],)
		expect(payload['alice']!.nextIndex,).toBe(8,)
	})

	it('drops malformed note entries and repairs broken indexes, flagging corrupted', async () => {
		const payload = {
			alice: {
				nextIndex: 2,
				notes: [
					{index: 0, note: 'good', time: 1, mod: 'm',},
					'not a note',
					{index: 0, note: 'duplicate index', time: 2, mod: 'm',},
					{note: 'missing index', time: 3, mod: 'm',},
				],
			},
			broken: 'not a record',
		}
		const page: NxgUsernotesShardPage = {
			format: 'nxg-usernotes',
			ver: 1,
			blob: Buffer.from(
				(await import('node:zlib')).deflateSync(JSON.stringify(payload,),),
			).toString('base64',),
		}

		const decoded = await decodeNotesShard(page, 'sub#s1',)

		expect(decoded.corrupted,).toBe(true,)
		expect(decoded.users['broken'],).toBeUndefined()
		const notes = decoded.users['alice']!.notes
		expect(notes.map((note,) => [note.index, note.note,]),).toEqual([
			[0, 'good',],
			[2, 'duplicate index',],
			[3, 'missing index',],
		],)
		expect(decoded.users['alice']!.nextIndex,).toBe(4,)
	})

	it('ignores malformed archived objects, treating the note as active', async () => {
		const payload = {
			alice: {
				nextIndex: 1,
				notes: [{index: 0, note: 'n', time: 1, mod: 'm', archived: 'yes',},],
			},
		}
		const page: NxgUsernotesShardPage = {
			format: 'nxg-usernotes',
			ver: 1,
			blob: Buffer.from(
				(await import('node:zlib')).deflateSync(JSON.stringify(payload,),),
			).toString('base64',),
		}

		const decoded = await decodeNotesShard(page, 'sub#s1',)

		expect(decoded.users['alice']!.notes[0]!.archived,).toBeUndefined()
	})

	it('recognizes only well-formed shard envelopes', () => {
		expect(isNxgUsernotesShardPage({format: 'nxg-usernotes', ver: 1, blob: 'abc',},),).toBe(true,)
		expect(isNxgUsernotesShardPage({format: 'nxg-usernotes', ver: 2, blob: 'abc',},),).toBe(false,)
		expect(isNxgUsernotesShardPage({ver: 6, blob: 'abc', constants: {},},),).toBe(false,)
		expect(isNxgUsernotesShardPage(null,),).toBe(false,)
	})
})

describe('noteIdentityKey', () => {
	it('matches identical notes across a wire round-trip', () => {
		// Timestamps are epoch seconds on every format, so a note compares equal
		// to itself with no normalization needed.
		const fresh = {note: 'hello', time: 1_600_000_000, mod: 'mod1',}
		const roundTripped = {note: 'hello', time: 1_600_000_000, mod: 'mod1',}
		expect(noteIdentityKey('alice', fresh,),).toBe(noteIdentityKey('alice', roundTripped,),)
	})

	it('differs by user, text, time, and mod', () => {
		const note = {note: 'hello', time: 1_600_000_000, mod: 'mod1',}
		expect(noteIdentityKey('alice', note,),).not.toBe(noteIdentityKey('bob', note,),)
		expect(noteIdentityKey('alice', note,),).not.toBe(noteIdentityKey('alice', {...note, note: 'bye',},),)
		expect(noteIdentityKey('alice', note,),).not.toBe(noteIdentityKey('alice', {...note, mod: 'mod2',},),)
		expect(noteIdentityKey('alice', note,),).not.toBe(
			noteIdentityKey('alice', {...note, time: note.time + 1000,},),
		)
	})
})

describe('v6 codec', () => {
	it('round-trips active notes and assigns ephemeral indexes on decode', async () => {
		const data: UserNotesData = {ver: 6, users: makeUsers(),}

		const blob = encodeUsernotesV6(data,)
		expect(blob.ver,).toBe(6,)
		expect(blob.constants.users,).toContain('mod1',)

		const decoded = await decodeUsernotesV6(blob, 'testsub',)
		expect(decoded,).not.toBeNull()
		expect(decoded!.users['alice']!.notes[0],).toEqual({
			index: 0,
			note: 'comment link',
			time: 1_600_000_000,
			mod: 'mod1',
			type: 'gooduser',
			link: '/r/testsub/comments/abc123/-/def456/',
		},)
		expect(decoded!.users['alice']!.nextIndex,).toBe(1,)
		// The legacy page has no slot for the removal message link; the
		// derived v6 mirror simply drops it (NXG stays canonical).
		expect(decoded!.users['bob']!.notes[0]!.messageLink,).toBeUndefined()
	})

	it('heals note times mistakenly stored in milliseconds back to seconds on decode', async () => {
		const data: UserNotesData = {
			ver: 6,
			users: {
				alice: {
					name: 'alice',
					nextIndex: 1,
					// Written by the old removal bug as Date.now() (milliseconds).
					notes: [{index: 0, note: 'bad time', time: 1_700_000_000_123, mod: 'm', type: '', link: '',},],
				},
			},
		}

		const decoded = await decodeUsernotesV6(encodeUsernotesV6(data,), 'testsub',)

		expect(decoded!.users['alice']!.notes[0]!.time,).toBe(1_700_000_000,)
	})

	it('excludes archived notes from the v6 page entirely', () => {
		const payload = buildUsernotesV6Payload({ver: 6, users: makeUsers(),},)

		// alice has 3 notes but only 1 active; bob's single note is active.
		expect(payload.users['alice']!.ns,).toHaveLength(1,)
		expect(payload.users['alice']!.ns[0]!.n,).toBe('comment link',)
		expect(payload.users['bob']!.ns,).toHaveLength(1,)
	})

	it('omits users left with no active notes', () => {
		const users = makeUsers()
		users['alice']!.notes = users['alice']!.notes.filter((note,) => note.archived)

		const payload = buildUsernotesV6Payload({ver: 6, users,},)

		expect(payload.users['alice'],).toBeUndefined()
		expect(payload.users['bob'],).toBeDefined()
	})

	it('returns null for unknown schema versions', async () => {
		expect(await decodeUsernotesV6({ver: 5,} as unknown as Parameters<typeof decodeUsernotesV6>[0], 'testsub',),)
			.toBeNull()
	})

	it('passes the cache key through to the background decompressor', async () => {
		const blob = encodeUsernotesV6({ver: 6, users: makeUsers(),},)

		await decodeUsernotesV6(blob, 'testsub', 'testsub#s1-00000000',)

		expect(sendMessage,).toHaveBeenCalledWith(expect.objectContaining({
			action: 'toolbox-usernote-decompress',
			cacheKey: 'testsub#s1-00000000',
		},),)
	})
})

describe('seedV6Types', () => {
	const data: UserNotesData = {
		ver: 6,
		users: {
			u: {name: 'u', notes: [{note: 'x', time: 1, mod: 'm', type: 'customkey', link: '',},],},
		},
	}

	it('uses configured colors and appends unknown note type keys', () => {
		const types = seedV6Types(data, [{key: 'mytype', text: 'My Type', color: 'blue',},],)

		expect(types[0],).toEqual({key: 'mytype', text: 'My Type', color: 'blue',},)
		expect(types,).toContainEqual({key: 'customkey', text: 'customkey', color: '',},)
	})

	it('falls back to built-in defaults when config has no types', () => {
		const types = seedV6Types(data, undefined,)

		expect(types.some((t,) => t.key === 'gooduser'),).toBe(true,)
		expect(types,).toContainEqual({key: 'customkey', text: 'customkey', color: '',},)
	})
})
