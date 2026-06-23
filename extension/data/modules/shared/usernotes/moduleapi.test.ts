/** Tests for getUserNotes and saveUserNotes. */

// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

const sendMessage = vi.hoisted(() =>
	vi.fn(async (msg: {action?: string; blob?: string},) => {
		if (msg?.action === 'toolbox-usernote-decompress') {
			return {users: JSON.parse(atob(msg.blob ?? '',),),}
		}
	},)
)
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage,},},}),)
vi.mock('../../../framework/moduleIds', () => ({utils: 'utils',}),)
vi.mock('../../../api/resources/modnotes', () => ({getRecentModNotes: vi.fn(),}),)
vi.mock('../../../api/resources/wiki', () => ({
	readFromWiki: vi.fn(),
	postToWiki: vi.fn().mockResolvedValue(undefined,),
}),)
vi.mock('../../../util/persistence/cache', () => ({
	getCache: vi.fn().mockImplementation((_moduleId: unknown, _key: unknown, defaultVal: unknown,) =>
		Promise.resolve(defaultVal,)
	),
	setCache: vi.fn().mockResolvedValue(undefined,),
}),)
vi.mock('../../../store', () => ({default: {dispatch: vi.fn(),},}),)
vi.mock('../../../store/textFeedbackSlice', () => ({
	showTextFeedback: vi.fn(),
	TextFeedbackKind: {Neutral: 'neutral', Positive: 'positive', Negative: 'negative',},
}),)
vi.mock('../../../util/data/purify', () => ({purifyObject: vi.fn(),}),)
vi.mock('../../config/moduleapi', () => ({getConfig: vi.fn().mockResolvedValue(null,),}),)
vi.mock('../../../util/data/encoding', () => ({
	zlibDeflate: (s: string,) => btoa(s,),
	zlibInflate: (s: string,) => atob(s,),
	htmlDecode: (s: string,) => s,
	unescapeJSON: (s: string,) => s,
	byteLength: (s: string,) => new TextEncoder().encode(s,).length,
}),)
const resolveWikiLayout = vi.hoisted(() =>
	vi.fn().mockResolvedValue({subreddit: 'sub', state: 'legacyFallback', compatibilityWrites: false,},)
)
vi.mock('../../../util/wiki/wikiPaths', () => ({
	resolveWikiLayout,
	compatMirrorEnabled: (layout: {state: string; compatibilityWrites: boolean; nxgMissing?: boolean},) =>
		layout.state === 'nxg' && layout.compatibilityWrites && !layout.nxgMissing,
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

import {postToWiki, readFromWiki,} from '../../../api/resources/wiki'
import type {WikiReadResult,} from '../../../api/resources/wiki'
import {nowInSeconds,} from '../../../util/data/time'
import {getCache, setCache,} from '../../../util/persistence/cache'
import {encodeNotesShard, encodeUsernotesV6,} from '../../../util/wiki/schemas/usernotes/codec'
import {AUTO_ARCHIVER, defaultUsernoteTypes,} from '../../../util/wiki/schemas/usernotes/schema'
import type {RawUsernotesBlob, UserNotesData, UsernotesUser,} from '../../../util/wiki/schemas/usernotes/schema'
import {clearSessionShardState,} from '../../../util/wiki/schemas/usernotes/sharded'
import type {UsernotesManifest,} from '../../../util/wiki/schemas/usernotes/sharding'
import {activeNotes, autoArchiveOldNotes, findSubredditColor, getUser, getUserNotes, saveUserNotes,} from './moduleapi'

const NXG_PAGE = 'toolbox-nxg/usernotes'

/** Marks the mocked layout for a sub. */
function mockLayout (state: 'legacyFallback' | 'nxg', compatibilityWrites = false,) {
	resolveWikiLayout.mockResolvedValue({subreddit: 'sub', state, compatibilityWrites,},)
}

function makeRawBlob (): RawUsernotesBlob {
	const users = {
		testuser: {ns: [{n: 'test note', t: 1234567890, m: 0, l: 'l,abc123', w: 0,},],},
	}
	return {
		ver: 6,
		constants: {users: ['testmod',], warnings: ['botban',],},
		blob: btoa(JSON.stringify(users,),),
	}
}

/** A single-shard manifest covering the whole hash space. */
function singleShardManifest (): UsernotesManifest {
	return {
		format: 'tbun-manifest',
		ver: 7,
		gen: 1,
		types: [{key: 'botban', text: 'Bot Ban', color: 'black',},],
		shards: [{start: 0, page: 's1-00000000',},],
	}
}

/** An indexed user record for shard fixtures. */
function makeUser (name: string, note = `note for ${name}`,): UsernotesUser {
	return {
		name,
		nextIndex: 1,
		notes: [{index: 0, note, time: 1700000000, mod: 'mod', type: '', link: '',},],
	}
}

/** Mocks `readFromWiki` to serve the given page texts, missing pages yielding `no_page`. */
function mockWikiPages (pages: Record<string, string>,) {
	vi.mocked(readFromWiki,).mockImplementation(async (_sub: string, page: string,) =>
		pages[page] !== undefined
			? {ok: true, data: pages[page],} as WikiReadResult
			: {ok: false, reason: 'no_page',} as WikiReadResult
	)
}

afterEach(() => {
	vi.clearAllMocks()
	clearSessionShardState()
	mockLayout('legacyFallback',)
},)

describe('getUserNotes', () => {
	beforeEach(() => {
		vi.mocked(getCache,).mockImplementation(
			(_moduleId: unknown, _key: unknown, defaultVal: unknown,) => Promise.resolve(defaultVal,),
		)
	},)

	it('inflates a valid v6 blob into UserNotesData on legacy subs', async () => {
		vi.mocked(readFromWiki,).mockResolvedValue({ok: true, data: JSON.stringify(makeRawBlob(),),},)

		const result = await getUserNotes('sub',)

		expect(result.ver,).toBe(6,)
		// Types are seeded for legacy data so the next NXG save can embed
		// them in the manifest.
		expect(result.types?.some((t,) => t.key === 'botban'),).toBe(true,)
		const note = result.users['testuser']!.notes[0]!
		expect(note.note,).toBe('test note',)
		expect(note.mod,).toBe('testmod',)
		expect(note.type,).toBe('botban',)
		// Ephemeral position index assigned by the v6 decode.
		expect(note.index,).toBe(0,)
		// v6 stores epoch seconds; decode passes the value through unchanged.
		expect(note.time,).toBe(1234567890,)
		// unsquashPermalink: 'l,abc123' → '/r/sub/comments/abc123/'
		expect(note.link,).toBe('/r/sub/comments/abc123/',)
	})

	it('reads the sharded layout for migrated compat-off subs', async () => {
		mockLayout('nxg', false,)
		mockWikiPages({
			[NXG_PAGE]: JSON.stringify(singleShardManifest(),),
			[`${NXG_PAGE}/s1-00000000`]: JSON.stringify(encodeNotesShard({testuser: makeUser('testuser',),},),),
		},)

		const result = await getUserNotes('sub',)

		expect(result.users['testuser']!.notes[0]!.note,).toBe('note for testuser',)
		// Types come from the manifest, not the config.
		expect(result.types,).toEqual(singleShardManifest().types,)
		// The legacy page is never consulted when compat is off.
		expect(vi.mocked(readFromWiki,).mock.calls.some((call,) => call[1] === 'usernotes'),).toBe(false,)
	})

	it('compat-on: merges 6.x edits from the legacy mirror into the view', async () => {
		mockLayout('nxg', true,)
		const storedUser = makeUser('testuser', 'stored note',)
		// The legacy mirror is missing the stored note (deleted via 6.x) and
		// carries one the shards don't have (added via 6.x).
		const legacyPage = encodeUsernotesV6({
			ver: 6,
			users: {
				other: {
					name: 'other',
					notes: [{note: 'added in 6.x', time: 1700100000, mod: 'mod6', type: '', link: '',},],
				},
			},
		},)
		mockWikiPages({
			[NXG_PAGE]: JSON.stringify(singleShardManifest(),),
			[`${NXG_PAGE}/s1-00000000`]: JSON.stringify(encodeNotesShard({testuser: storedUser,},),),
			usernotes: JSON.stringify(legacyPage,),
		},)

		const result = await getUserNotes('sub',)

		// The 6.x-deleted note is archived under the sentinel, not gone.
		expect(result.users['testuser']!.notes[0]!.archived?.by,).toBe('[6.x]',)
		// The 6.x-added note appears active with a fresh index.
		expect(result.users['other']!.notes[0],).toMatchObject({note: 'added in 6.x', index: 0,},)
		// Nothing is written back on read.
		expect(postToWiki,).not.toHaveBeenCalled()
	})

	it('compat-on: serves legacy-only notes even when no NXG usernotes exist', async () => {
		mockLayout('nxg', true,)
		const legacyPage = encodeUsernotesV6({
			ver: 6,
			users: {
				testuser: {
					name: 'testuser',
					notes: [{note: 'only on legacy', time: 1700100000, mod: 'mod6', type: '', link: '',},],
				},
			},
		},)
		mockWikiPages({usernotes: JSON.stringify(legacyPage,),},)

		const result = await getUserNotes('sub',)

		expect(result.users['testuser']!.notes[0]!.note,).toBe('only on legacy',)
	})

	it('throws when the wiki page does not exist', async () => {
		vi.mocked(readFromWiki,).mockResolvedValue({ok: false, reason: 'no_page',},)

		await expect(getUserNotes('sub',),).rejects.toThrow('no_page',)
	})

	it('throws no_page when neither NXG nor legacy notes exist', async () => {
		mockLayout('nxg', true,)
		mockWikiPages({},)

		await expect(getUserNotes('sub',),).rejects.toThrow('no_page',)
	})

	it('throws "usernotes schema too old" for v5 data', async () => {
		vi.mocked(readFromWiki,).mockResolvedValue(
			{ok: true, data: JSON.stringify({ver: 5, users: {}, constants: {},},),} as WikiReadResult,
		)

		await expect(getUserNotes('sub',),).rejects.toThrow('usernotes schema too old to be understood',)
	})

	it('throws invalid_json when the legacy page is not JSON', async () => {
		vi.mocked(readFromWiki,).mockResolvedValue({ok: true, data: 'definitely not json',},)

		await expect(getUserNotes('sub',),).rejects.toThrow('invalid_json',)
	})

	it('returns cached data without calling readFromWiki', async () => {
		const cached = {ver: 6, users: {}, corrupted: false,}
		vi.mocked(getCache,).mockImplementation(
			(_moduleId: unknown, key: unknown, defaultVal: unknown,) =>
				Promise.resolve(key === 'noteCache' ? {sub: cached,} : defaultVal,),
		)

		const result = await getUserNotes('sub',)

		expect(readFromWiki,).not.toHaveBeenCalled()
		expect(result,).toBe(cached,)
	})

	it('force-refreshes from the wiki and clears stale noNotes cache entries', async () => {
		const cached = {ver: 6, users: {}, corrupted: false,}
		vi.mocked(getCache,).mockImplementation(
			(_moduleId: unknown, key: unknown, defaultVal: unknown,) => {
				if (key === 'noteCache') { return Promise.resolve({sub: cached,},) }
				if (key === 'noNotes') { return Promise.resolve(['sub', 'other',],) }
				return Promise.resolve(defaultVal,)
			},
		)
		vi.mocked(readFromWiki,).mockResolvedValue({ok: true, data: JSON.stringify(makeRawBlob(),),},)

		const result = await getUserNotes('sub', true,)

		expect(readFromWiki,).toHaveBeenCalledWith('sub', 'usernotes', false,)
		expect(result,).not.toBe(cached,)
		expect(result.users['testuser']?.notes[0]?.note,).toBe('test note',)
		expect(setCache,).toHaveBeenCalledWith('utils', 'noteCache', {
			sub: result,
		},)
		expect(setCache,).toHaveBeenCalledWith('utils', 'noNotes', ['other',],)
	})

	it('throws when readFromWiki returns unknown_error', async () => {
		vi.mocked(readFromWiki,).mockResolvedValue({ok: false, reason: 'unknown_error',},)

		await expect(getUserNotes('sub',),).rejects.toThrow('unknown_error',)
	})
})

describe('saveUserNotes', () => {
	afterEach(() => {
		vi.clearAllMocks()
	},)

	it('posts a single blob-compressed v6 page on legacy subs', async () => {
		await saveUserNotes('sub', {
			ver: 6,
			users: {
				testuser: {
					name: 'testuser',
					notes: [{note: 'a note', time: 1234567890, mod: 'testmod', type: 'ban', link: '',},],
				},
			},
		}, 'test save',)

		expect(postToWiki,).toHaveBeenCalledOnce()
		const [, page, savedData,] = vi.mocked(postToWiki,).mock.calls[0]!
		expect(page,).toBe('usernotes',)
		const blob = savedData as RawUsernotesBlob
		expect(blob.ver,).toBe(6,)
		expect(blob.constants.users,).toContain('testmod',)
		expect(blob.constants.warnings,).toContain('ban',)
	})

	it('writes only the sharded layout for compat-off subs', async () => {
		mockLayout('nxg', false,)
		mockWikiPages({},)

		await saveUserNotes('sub', {
			ver: 6,
			users: {testuser: makeUser('testuser',),},
		}, 'test save',)

		const pages = vi.mocked(postToWiki,).mock.calls.map((call,) => call[1])
		// One shard page, then the manifest — never the legacy page.
		expect(pages,).toEqual([`${NXG_PAGE}/s1-00000000`, NXG_PAGE,],)
		const manifest = vi.mocked(postToWiki,).mock.calls[1]![2] as UsernotesManifest
		expect(manifest.format,).toBe('tbun-manifest',)
		expect(manifest.types,).toEqual(defaultUsernoteTypes,)
	})

	it('compat-on: writes the canonical shards first, then the legacy mirror with active notes only', async () => {
		mockLayout('nxg', true,)
		mockWikiPages({},)

		await saveUserNotes('sub', {
			ver: 6,
			users: {
				testuser: {
					name: 'testuser',
					nextIndex: 2,
					notes: [
						{index: 0, note: 'active', time: 1234567890, mod: 'testmod', type: '', link: '',},
						{
							index: 1,
							note: 'hidden',
							time: 1234567900,
							mod: 'testmod',
							type: '',
							link: '',
							archived: {by: 'testmod', at: 1700000000,},
						},
					],
				},
			},
		}, 'test save',)

		const pages = vi.mocked(postToWiki,).mock.calls.map((call,) => call[1])
		// Canonical NXG shards first, the legacy mirror last.
		expect(pages,).toEqual([`${NXG_PAGE}/s1-00000000`, NXG_PAGE, 'usernotes',],)

		// The legacy page holds only the active note, with no NXG fields.
		const legacyBlob = vi.mocked(postToWiki,).mock.calls[2]![2] as RawUsernotesBlob
		const legacyUsers = JSON.parse(atob(legacyBlob.blob,),)
		expect(legacyUsers['testuser'].ns,).toHaveLength(1,)
		expect(legacyUsers['testuser'].ns[0].n,).toBe('active',)
		expect(JSON.stringify(legacyBlob,),).not.toContain('archived',)
		expect(JSON.stringify(legacyBlob,),).not.toContain('index',)

		// The shard retains both notes.
		const shard = vi.mocked(postToWiki,).mock.calls[0]![2] as {blob: string}
		const shardUsers = JSON.parse(atob(shard.blob,),)
		expect(shardUsers['testuser'].notes,).toHaveLength(2,)
	})

	it('compat-on: folds concurrent 6.x edits into the save', async () => {
		mockLayout('nxg', true,)
		const storedUser = makeUser('testuser', 'stored note',)
		// 6.x added a note since our last sync.
		const legacyPage = encodeUsernotesV6({
			ver: 6,
			users: {
				testuser: {
					name: 'testuser',
					notes: [
						{note: 'stored note', time: 1700000000, mod: 'mod', type: '', link: '',},
						{note: 'added in 6.x', time: 1700200000, mod: 'mod6', type: '', link: '',},
					],
				},
			},
		},)
		mockWikiPages({
			[NXG_PAGE]: JSON.stringify(singleShardManifest(),),
			[`${NXG_PAGE}/s1-00000000`]: JSON.stringify(encodeNotesShard({testuser: storedUser,},),),
			usernotes: JSON.stringify(legacyPage,),
		},)

		// The outgoing dataset is the stored state plus the user's own change.
		const outgoing: UserNotesData = {
			ver: 6,
			users: {
				testuser: {
					...storedUser,
					nextIndex: 2,
					notes: [
						{index: 1, note: 'my new note', time: 1700300000, mod: 'me', type: '', link: '',},
						...storedUser.notes,
					],
				},
			},
		}
		await saveUserNotes('sub', outgoing, 'test save',)

		const legacyWrite = vi.mocked(postToWiki,).mock.calls.find((call,) => call[1] === 'usernotes')!
		const legacyUsers = JSON.parse(atob((legacyWrite[2] as RawUsernotesBlob).blob,),)
		const legacyTexts = legacyUsers['testuser'].ns.map((n: {n?: string},) => n.n)
		// Both the 6.x note and the user's new note survive, nothing archived.
		expect(legacyTexts.sort(),).toEqual(['added in 6.x', 'my new note', 'stored note',],)
	})

	it('compat-on: aborts before any write when the legacy page is unreadable', async () => {
		mockLayout('nxg', true,)
		vi.mocked(readFromWiki,).mockImplementation(async (_sub: string, page: string,) =>
			page === 'usernotes'
				? {ok: false, reason: 'unknown_error',} as WikiReadResult
				: {ok: false, reason: 'no_page',} as WikiReadResult
		)

		await expect(saveUserNotes('sub', {ver: 6, users: {testuser: makeUser('testuser',),},}, 'test',),)
			.rejects.toThrow(/could not read the legacy/,)
		expect(postToWiki,).not.toHaveBeenCalled()
	})

	it('compat-on: a 413 on the legacy mirror is non-fatal once the shards are saved', async () => {
		mockLayout('nxg', true,)
		mockWikiPages({},)
		vi.mocked(postToWiki,).mockImplementation(async (_sub, page,) => {
			if (page === 'usernotes') {
				throw Object.assign(new Error('too large',), {response: {status: 413,} as Response,},)
			}
		},)

		// The save resolves: the canonical NXG write succeeded, only the
		// mirror overflowed.
		await saveUserNotes('sub', {ver: 6, users: {testuser: makeUser('testuser',),},}, 'test',)

		const pages = vi.mocked(postToWiki,).mock.calls.map((call,) => call[1])
		expect(pages,).toEqual([`${NXG_PAGE}/s1-00000000`, NXG_PAGE, 'usernotes',],)
		// The cache still records the saved dataset despite the mirror failure.
		expect(vi.mocked(setCache,).mock.calls.some((call,) => call[1] === 'noteCache'),).toBe(true,)
	})

	it('serializes concurrent saves for the same subreddit', async () => {
		const order: string[] = []
		let releaseFirst!: () => void
		const firstGate = new Promise<void>((resolve,) => {
			releaseFirst = resolve
		},)
		vi.mocked(postToWiki,).mockImplementation(async (_sub, page,) => {
			order.push(String(page,),)
			if (order.length === 1) { await firstGate }
		},)

		const notes = {
			ver: 6,
			users: {testuser: makeUser('testuser',),},
		}
		const first = saveUserNotes('sub', notes, 'first',)
		const second = saveUserNotes('sub', notes, 'second',)

		// The second save must not start writing while the first is blocked.
		await new Promise((resolve,) => setTimeout(resolve, 10,))
		expect(order,).toHaveLength(1,)

		releaseFirst()
		await Promise.all([first, second,],)
		expect(order,).toHaveLength(2,)
	})

	it('round-trips: inflate(deflate(notes)) === notes', async () => {
		const original = {
			ver: 6,
			users: {
				alice: {
					name: 'alice',
					notes: [{note: 'hi', time: 1234567890, mod: 'mod1', type: 'spam', link: '',},],
				},
				bob: {name: 'bob', notes: [{note: 'bye', time: 1000000000, mod: 'mod2', type: 'ban', link: '',},],},
			},
		}

		let capturedBlob: RawUsernotesBlob | undefined
		vi.mocked(postToWiki,).mockImplementation(async (_sub, _page, data,) => {
			capturedBlob = data as RawUsernotesBlob
		},)
		vi.mocked(getCache,).mockResolvedValue({},)

		await saveUserNotes('sub', original, 'test',)
		expect(capturedBlob,).toBeDefined()

		vi.mocked(readFromWiki,).mockResolvedValue({ok: true, data: JSON.stringify(capturedBlob!,),},)
		const restored = await getUserNotes('sub',)

		expect(restored.users['alice']!.notes[0]!.note,).toBe('hi',)
		expect(restored.users['alice']!.notes[0]!.mod,).toBe('mod1',)
		expect(restored.users['bob']!.notes[0]!.note,).toBe('bye',)
		expect(restored.users['bob']!.notes[0]!.mod,).toBe('mod2',)
	})

	it('prunes users with no notes before saving', async () => {
		vi.mocked(getCache,).mockResolvedValue({},)

		await saveUserNotes('sub', {
			ver: 6,
			users: {
				empty: {name: 'empty', notes: [],},
				alice: {
					name: 'alice',
					notes: [{note: 'hi', time: 1234567890, mod: 'mod1', type: 'spam', link: '',},],
				},
			},
		}, 'test',)

		const [, , savedData,] = vi.mocked(postToWiki,).mock.calls[0]!
		const blob = savedData as RawUsernotesBlob
		expect(JSON.parse(atob(blob.blob,),),).toEqual({
			alice: {ns: [{n: 'hi', t: 1234567890, m: 0, l: '', w: 0,},],},
		},)
	})

	it('keeps emptied users with a nextIndex when cleaning, but never writes them to the v6 page', async () => {
		vi.mocked(getCache,).mockResolvedValue({},)

		await saveUserNotes('sub', {
			ver: 6,
			users: {
				emptied: {name: 'emptied', notes: [], nextIndex: 3,},
				pointless: {name: 'pointless', notes: [],},
				alice: {
					name: 'alice',
					notes: [{note: 'hi', time: 1234567890, mod: 'mod1', type: '', link: '',},],
				},
			},
		}, 'test',)

		// The legacy v6 page only ever carries users with active notes.
		const [, , savedData,] = vi.mocked(postToWiki,).mock.calls[0]!
		const blob = savedData as RawUsernotesBlob
		expect(Object.keys(JSON.parse(atob(blob.blob,),),),).toEqual(['alice',],)

		// The cleaned dataset (what gets cached and shard-written) keeps the
		// emptied record — its nextIndex is what keeps note indexes stable —
		// but drops empty records carrying no counter.
		await vi.waitFor(() => expect(setCache,).toHaveBeenCalled())
		const [, , cachedNotes,] = vi.mocked(setCache,).mock.calls[0]!
		const cached = (cachedNotes as Record<string, UserNotesData>)['sub']!
		expect(cached.users['emptied'],).toEqual({name: 'emptied', notes: [], nextIndex: 3,},)
		expect(cached.users['pointless'],).toBeUndefined()
	})

	it('removes duplicate notes for the same user before saving', async () => {
		vi.mocked(getCache,).mockResolvedValue({},)

		await saveUserNotes('sub', {
			ver: 6,
			users: {
				alice: {
					name: 'alice',
					notes: [
						{note: 'same', time: 1234567890, mod: 'mod1', type: 'spam', link: '',},
						{note: 'same', time: 1234567890, mod: 'mod1', type: 'ban', link: '/r/sub/comments/abc/',},
						{note: 'same', time: 1234567890, mod: 'mod2', type: 'spam', link: '',},
					],
				},
				bob: {
					name: 'bob',
					notes: [{note: 'same', time: 1234567890, mod: 'mod1', type: 'spam', link: '',},],
				},
			},
		}, 'test',)

		const [, , savedData,] = vi.mocked(postToWiki,).mock.calls[0]!
		const blob = savedData as RawUsernotesBlob
		expect(JSON.parse(atob(blob.blob,),),).toEqual({
			alice: {
				ns: [
					{n: 'same', t: 1234567890, m: 0, l: '', w: 0,},
					{n: 'same', t: 1234567890, m: 1, l: '', w: 0,},
				],
			},
			bob: {ns: [{n: 'same', t: 1234567890, m: 0, l: '', w: 0,},],},
		},)
	})

	it('caches cleaned notes when saving', async () => {
		vi.mocked(getCache,).mockResolvedValue({},)

		await saveUserNotes('sub', {
			ver: 6,
			users: {
				empty: {name: 'empty', notes: [],},
				alice: {
					name: 'alice',
					notes: [
						{note: 'same', time: 1234567890, mod: 'mod1', type: 'spam', link: '',},
						{note: 'same', time: 1234567890, mod: 'mod1', type: 'spam', link: '',},
					],
				},
			},
		}, 'test',)

		await vi.waitFor(() => expect(setCache,).toHaveBeenCalled())
		const [, , cachedNotes,] = vi.mocked(setCache,).mock.calls[0]!
		expect(cachedNotes,).toEqual({
			sub: {
				// Saving seeds type definitions for the NXG manifest, including
				// an entry for the out-of-config 'spam' type used by the notes.
				ver: 6,
				types: [...defaultUsernoteTypes, {key: 'spam', text: 'spam', color: '',},],
				users: {
					alice: {
						name: 'alice',
						notes: [{note: 'same', time: 1234567890, mod: 'mod1', type: 'spam', link: '',},],
					},
				},
			},
		},)
	})
})

describe('moduleapi helpers', () => {
	it('finds exact users and sorts their notes newest first', () => {
		const users: Record<string, UsernotesUser> = {
			Alice: {
				name: 'Alice',
				notes: [
					{note: 'older', time: 1, mod: 'mod', type: 'spam', link: '',},
					{note: 'newer', time: 2, mod: 'mod', type: 'spam', link: '',},
				],
			},
		}

		expect(getUser(users, 'Alice',)?.notes.map((note,) => note.note),).toEqual(['newer', 'older',],)
	})

	it('merges dual-key users with collision-free indexes for mixed-case lookups', () => {
		const users: Record<string, UsernotesUser> = {
			alice: {
				name: 'alice',
				nextIndex: 1,
				notes: [{index: 0, note: 'canonical', time: 3, mod: 'mod', type: 'spam', link: '',},],
			},
			Alice: {
				name: 'Alice',
				nextIndex: 1,
				notes: [{index: 0, note: 'exact', time: 1, mod: 'mod', type: 'spam', link: '',},],
			},
		}

		const user = getUser(users, 'Alice',)

		expect(user?.name,).toBe('Alice',)
		expect(user?.nonCanonicalName,).toBe('alice',)
		expect(user?.notes.map((note,) => note.note),).toEqual(['canonical', 'exact',],)
		// No duplicate indexes in the merged view.
		const indexes = user!.notes.map((note,) => note.index)
		expect(new Set(indexes,).size,).toBe(indexes.length,)
	})

	it('returns undefined when a user has no notes', () => {
		expect(getUser({}, 'missing',),).toBeUndefined()
	})

	it('filters archived notes out of activeNotes', () => {
		const notes = [
			{note: 'active', time: 3, mod: 'm',},
			{note: 'archived', time: 2, mod: 'm', archived: {by: 'x', at: 1,},},
		]

		expect(activeNotes(notes,).map((note,) => note.note),).toEqual(['active',],)
	})

	it('finds subreddit colors by key or returns an empty fallback', () => {
		const colors = [{key: 'spam', color: 'red', text: 'Spam',},]

		expect(findSubredditColor(colors, 'spam',),).toEqual(colors[0],)
		expect(findSubredditColor(colors, 'missing',),).toEqual({key: 'none', color: '', text: '',},)
	})
})

describe('autoArchiveOldNotes', () => {
	/** One day in seconds — note times are stored in epoch seconds. */
	const DAY = 86_400

	function makeData (notes: UserNotesData['users']['x']['notes'],): UserNotesData {
		return {ver: 6, users: {alice: {notes,},},}
	}

	it('archives only active notes older than their type window', () => {
		const now = nowInSeconds()
		const data = makeData([
			{note: 'old spam', type: 'spam', mod: 'm', time: now - 10 * DAY,},
			{note: 'fresh spam', type: 'spam', mod: 'm', time: now - 2 * DAY,},
		],)

		const count = autoArchiveOldNotes(data, [{key: 'spam', text: 'Spam', color: 'red', autoArchiveDays: 5,},],)

		expect(count,).toBe(1,)
		const [oldNote, freshNote,] = data.users.alice!.notes
		expect(oldNote!.archived,).toEqual({by: AUTO_ARCHIVER, at: expect.any(Number,),},)
		expect(freshNote!.archived,).toBeUndefined()
	})

	it('leaves already-archived notes and their attribution alone', () => {
		const now = nowInSeconds()
		const data = makeData([
			{note: 'archived', type: 'spam', mod: 'm', time: now - 10 * DAY, archived: {by: 'mod1', at: 1,},},
		],)

		const count = autoArchiveOldNotes(data, [{key: 'spam', text: 'Spam', color: 'red', autoArchiveDays: 5,},],)

		expect(count,).toBe(0,)
		expect(data.users.alice!.notes[0]!.archived,).toEqual({by: 'mod1', at: 1,},)
	})

	it('ignores notes with no type, unknown types, and types without a window', () => {
		const now = nowInSeconds()
		const data = makeData([
			{note: 'untyped', mod: 'm', time: now - 100 * DAY,},
			{note: 'unknown type', type: 'ghost', mod: 'm', time: now - 100 * DAY,},
			{note: 'no window', type: 'ban', mod: 'm', time: now - 100 * DAY,},
		],)

		const count = autoArchiveOldNotes(data, [
			{key: 'spam', text: 'Spam', color: 'red', autoArchiveDays: 5,},
			{key: 'ban', text: 'Ban', color: 'darkred',},
		],)

		expect(count,).toBe(0,)
		expect(data.users.alice!.notes.every((note,) => note.archived === undefined),).toBe(true,)
	})

	it('archives every active note of a type configured to archive immediately (0 days)', () => {
		const now = nowInSeconds()
		const data = makeData([
			{note: 'just made', type: 'log', mod: 'm', time: now,},
			{note: 'other type', type: 'spam', mod: 'm', time: now - 100 * DAY,},
		],)

		const count = autoArchiveOldNotes(data, [
			{key: 'log', text: 'Log', color: 'gray', autoArchiveDays: 0,},
			{key: 'spam', text: 'Spam', color: 'red',},
		],)

		expect(count,).toBe(1,)
		expect(data.users.alice!.notes[0]!.archived?.by,).toBe(AUTO_ARCHIVER,)
		expect(data.users.alice!.notes[1]!.archived,).toBeUndefined()
	})
})
