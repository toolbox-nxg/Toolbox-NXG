/** Tests for legacy-page reconciliation under NXG-canonical compat. */

// @vitest-environment node
import {afterEach, describe, expect, it, vi,} from 'vitest'

const sendMessage = vi.hoisted(() =>
	vi.fn(async (msg: {action?: string; blob?: string},) => {
		if (msg?.action === 'toolbox-usernote-decompress') {
			return {users: JSON.parse(atob(msg.blob ?? '',),),}
		}
	},)
)
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage,},},}),)
vi.mock('../../../../api/resources/wiki', () => ({readFromWiki: vi.fn(),}),)
vi.mock('../../../data/purify', () => ({purifyObject: vi.fn(),}),)
vi.mock('../../../data/encoding', () => ({
	zlibDeflate: (s: string,) => btoa(s,),
	zlibInflate: (s: string,) => atob(s,),
	htmlDecode: (s: string,) => s,
	unescapeJSON: (s: string,) => s,
}),)
vi.mock('../../wikiPaths', () => ({
	OLD_WIKI_PATHS: {
		settings: 'toolbox',
		usernotes: 'usernotes',
		notes: 'notes/index',
		userSettings: 'tbsettings',
	},
	NEW_WIKI_PATHS: {
		settings: 'toolbox-nxg',
		usernotes: 'toolbox-nxg/usernotes',
		notes: 'toolbox-nxg/notes',
		userSettings: 'toolbox-nxg/user-settings',
	},
}),)

import {readFromWiki,} from '../../../../api/resources/wiki'
import type {WikiReadResult,} from '../../../../api/resources/wiki'
import {encodeUsernotesV6,} from './codec'
import {applyLegacyDiff, computeLegacyDiff, diffLegacyNotes, reconcileFromLegacy,} from './reconcile'
import type {UserNoteEntry, UserNotesData, UsernotesUser,} from './schema'

/** An indexed user with the given notes. */
function makeUser (name: string, notes: Partial<UserNoteEntry>[],): UsernotesUser {
	return {
		name,
		nextIndex: notes.length,
		notes: notes.map((note, index,) => ({
			index,
			note: `note ${index}`,
			time: 1_700_000_000 + index * 60,
			mod: 'mod1',
			type: '',
			link: '',
			...note,
		})),
	}
}

afterEach(() => {
	vi.clearAllMocks()
},)

describe('diffLegacyNotes', () => {
	it('reports no change when the legacy page matches the active flatten', () => {
		const nxg = {
			alice: makeUser('alice', [{}, {archived: {by: 'mod2', at: 1,},},],),
		}
		// Legacy mirror holds only the active note.
		const legacy = {
			alice: makeUser('alice', [{},],),
		}

		const result = diffLegacyNotes(nxg, legacy,)

		expect(result.changed,).toBe(false,)
		expect(result.users,).toEqual(nxg,)
	})

	it('merges 6.x-added notes as active notes with fresh indexes', () => {
		const nxg = {alice: makeUser('alice', [{}, {},],),}
		const legacy = {
			alice: makeUser('alice', [{}, {}, {note: 'added in 6.x', time: 1_700_100_000, mod: 'mod6x',},],),
		}

		const result = diffLegacyNotes(nxg, legacy,)

		expect(result.changed,).toBe(true,)
		const added = result.users['alice']!.notes.find((note,) => note.note === 'added in 6.x')!
		expect(added.index,).toBe(2,)
		expect(added.archived,).toBeUndefined()
		expect(result.users['alice']!.nextIndex,).toBe(3,)
		// Newest-first: the merged note leads the array.
		expect(result.users['alice']!.notes[0],).toBe(added,)
	})

	it('creates a user record for notes on users NXG has never seen', () => {
		const legacy = {
			newuser: makeUser('newuser', [{note: 'first contact', mod: 'mod6x',},],),
		}

		const result = diffLegacyNotes({}, legacy,)

		expect(result.changed,).toBe(true,)
		expect(result.users['newuser']!.notes[0],).toMatchObject({index: 0, note: 'first contact',},)
		expect(result.users['newuser']!.nextIndex,).toBe(1,)
	})

	it('archives notes deleted on the legacy page with the 6.x sentinel', () => {
		const nxg = {alice: makeUser('alice', [{note: 'kept',}, {note: 'deleted in 6.x',},],),}
		const legacy = {alice: makeUser('alice', [{note: 'kept',},],),}

		const result = diffLegacyNotes(nxg, legacy,)

		expect(result.changed,).toBe(true,)
		const archived = result.users['alice']!.notes.find((note,) => note.note === 'deleted in 6.x')!
		expect(archived.archived?.by,).toBe('[6.x]',)
		expect(archived.index,).toBe(1,)
		// The note itself is fully retained.
		expect(archived.mod,).toBe('mod1',)
	})

	it('never resurrects archived notes from a matching legacy entry', () => {
		// An archived note whose key still appears on the legacy page (e.g. a
		// 6.x mod re-added identical content) must not be duplicated.
		const archivedNote = {note: 'old', archived: {by: 'mod2', at: 1,},}
		const nxg = {alice: makeUser('alice', [archivedNote,],),}
		const legacy = {alice: makeUser('alice', [{note: 'old',},],),}

		const result = diffLegacyNotes(nxg, legacy,)

		expect(result.users['alice']!.notes,).toHaveLength(1,)
		expect(result.users['alice']!.notes[0]!.archived,).toBeDefined()
		expect(result.changed,).toBe(false,)
	})

	it('treats a 6.x edit as archive-old plus add-new', () => {
		const nxg = {alice: makeUser('alice', [{note: 'original text',},],),}
		const legacy = {alice: makeUser('alice', [{note: 'edited text',},],),}

		const result = diffLegacyNotes(nxg, legacy,)

		const notes = result.users['alice']!.notes
		expect(notes,).toHaveLength(2,)
		expect(notes.find((note,) => note.note === 'original text')!.archived?.by,).toBe('[6.x]',)
		expect(notes.find((note,) => note.note === 'edited text')!.archived,).toBeUndefined()
	})

	it('matches identical notes across the legacy round-trip', () => {
		// Timestamps are epoch seconds on both the NXG and legacy sides, so a
		// note survives the round-trip with no diff.
		const nxg = {alice: makeUser('alice', [{time: 1_700_000_000,},],),}
		const legacy = {alice: makeUser('alice', [{time: 1_700_000_000,},],),}

		expect(diffLegacyNotes(nxg, legacy,).changed,).toBe(false,)
	})

	it('does not mutate its inputs', () => {
		const nxg = {alice: makeUser('alice', [{note: 'gone from legacy',},],),}
		const snapshot = structuredClone(nxg,)

		diffLegacyNotes(nxg, {},)

		expect(nxg,).toEqual(snapshot,)
	})
})

describe('save-path ops (computeLegacyDiff against stored, applied to outgoing)', () => {
	it('does not archive the user\'s own brand-new note', () => {
		const stored = {alice: makeUser('alice', [{note: 'existing',},],),}
		const legacy = {alice: makeUser('alice', [{note: 'existing',},],),}
		// The outgoing dataset carries a mutation: a new note not yet anywhere.
		const outgoing = {
			alice: makeUser('alice', [{note: 'existing',}, {note: 'just added', time: 1_700_900_000,},],),
		}

		const ops = computeLegacyDiff(stored, legacy,)
		const changed = applyLegacyDiff(outgoing, ops,)

		expect(changed,).toBe(false,)
		expect(outgoing['alice']!.notes.every((note,) => note.archived === undefined),).toBe(true,)
	})

	it('does not resurrect notes a delete or prune just removed from the outgoing dataset', () => {
		const pruned = {note: 'ancient', time: 1_500_000_000,}
		const stored = {alice: makeUser('alice', [{note: 'recent',}, pruned,],),}
		// The legacy mirror still lists the old note (mirror not yet rewritten).
		const legacy = {alice: makeUser('alice', [{note: 'recent',}, pruned,],),}
		// The outgoing dataset had the old note hard-purged by a prune.
		const outgoing = {alice: makeUser('alice', [{note: 'recent',},],),}

		const ops = computeLegacyDiff(stored, legacy,)
		const changed = applyLegacyDiff(outgoing, ops,)

		expect(changed,).toBe(false,)
		expect(outgoing['alice']!.notes,).toHaveLength(1,)
	})

	it('folds concurrent 6.x edits into the outgoing dataset', () => {
		const stored = {alice: makeUser('alice', [{note: 'kept',}, {note: 'removed in 6.x',},],),}
		const legacy = {
			alice: makeUser('alice', [{note: 'kept',}, {note: 'added in 6.x', time: 1_700_500_000,},],),
		}
		const outgoing = structuredClone(stored,)

		const changed = applyLegacyDiff(outgoing, computeLegacyDiff(stored, legacy,),)

		expect(changed,).toBe(true,)
		const notes = outgoing['alice']!.notes
		expect(notes.find((note,) => note.note === 'removed in 6.x')!.archived?.by,).toBe('[6.x]',)
		expect(notes.find((note,) => note.note === 'added in 6.x'),).toBeDefined()
	})
})

describe('reconcileFromLegacy', () => {
	const baseNotes: UserNotesData = {
		ver: 6,
		users: {alice: makeUser('alice', [{note: 'kept',},],),},
	}

	it('is a no-op when the legacy page does not exist', async () => {
		vi.mocked(readFromWiki,).mockResolvedValue({ok: false, reason: 'no_page',} as WikiReadResult,)

		const result = await reconcileFromLegacy('sub', baseNotes,)

		expect(result.changed,).toBe(false,)
		expect(result.notes,).toBe(baseNotes,)
	})

	it('folds legacy edits into a copy of the dataset', async () => {
		const legacyPage = encodeUsernotesV6({
			ver: 6,
			users: {
				alice: makeUser('alice', [{note: 'kept',}, {note: 'added in 6.x', time: 1_700_200_000,},],),
			},
		},)
		vi.mocked(readFromWiki,).mockResolvedValue({ok: true, data: JSON.stringify(legacyPage,),} as WikiReadResult,)

		const result = await reconcileFromLegacy('sub', baseNotes,)

		expect(result.changed,).toBe(true,)
		expect(result.notes,).not.toBe(baseNotes,)
		expect(result.notes.users['alice']!.notes.some((note,) => note.note === 'added in 6.x'),).toBe(true,)
		// The input dataset was not mutated.
		expect(baseNotes.users['alice']!.notes,).toHaveLength(1,)
	})

	it('throws when the legacy page exists but cannot be read', async () => {
		vi.mocked(readFromWiki,).mockResolvedValue({ok: false, reason: 'unknown_error',} as WikiReadResult,)

		await expect(reconcileFromLegacy('sub', baseNotes,),).rejects.toThrow(/could not read the legacy/,)
	})

	it('throws when the legacy page is not valid usernotes', async () => {
		vi.mocked(readFromWiki,).mockResolvedValue({ok: true, data: 'not json',} as WikiReadResult,)
		await expect(reconcileFromLegacy('sub', baseNotes,),).rejects.toThrow(/not valid JSON/,)

		vi.mocked(readFromWiki,).mockResolvedValue({ok: true, data: '{"ver":5}',} as WikiReadResult,)
		await expect(reconcileFromLegacy('sub', baseNotes,),).rejects.toThrow(/unrecognized schema/,)
	})
})
