/** Tests for the legacy↔NXG wiki migration operations. */

// @vitest-environment node
import {beforeEach, describe, expect, it, vi,} from 'vitest'

const readFromWiki = vi.hoisted(() => vi.fn())
const postToWiki = vi.hoisted(() => vi.fn())
const getWikiPages = vi.hoisted(() => vi.fn())
const isModSub = vi.hoisted(() => vi.fn())
const getCache = vi.hoisted(() => vi.fn())
const setCache = vi.hoisted(() => vi.fn())
const clearCache = vi.hoisted(() => vi.fn())
// Minimal stand-in for the real normalizeConfig: backfills the field shapes
// the reconcile-merge in step 1 relies on, without decoding or migrations.
const normalizeConfig = vi.hoisted(() =>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double mirrors normalizeConfig's in-place mutation of arbitrary parsed JSON
	vi.fn((config: any,) => {
		if (
			!config.removalReasons || typeof config.removalReasons !== 'object'
			|| Array.isArray(config.removalReasons,)
		) {
			config.removalReasons = {reasons: [],}
		}
		if (!Array.isArray(config.removalReasons.reasons,)) { config.removalReasons.reasons = [] }
		if (!Array.isArray(config.modMacros,)) { config.modMacros = [] }
		if (!Array.isArray(config.domainTags,)) { config.domainTags = [] }
		if (!Array.isArray(config.usernoteColors,)) { config.usernoteColors = [] }
		if (!config.banMacros || typeof config.banMacros !== 'object' || Array.isArray(config.banMacros,)) {
			config.banMacros = null
		}
	},)
)

const sendMessage = vi.hoisted(() =>
	vi.fn(async (msg: {action?: string; blob?: string},) => {
		if (msg?.action === 'toolbox-usernote-decompress') {
			return {users: JSON.parse(atob(msg.blob ?? '',),),}
		}
		return undefined
	},)
)

vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage,},},}),)
vi.mock('../../api/resources/wiki', () => ({readFromWiki, postToWiki, getWikiPages,}),)
vi.mock('../../api/resources/modSubs', () => ({isModSub,}),)
vi.mock('../../framework/moduleIds', () => ({utils: 'utils',}),)
vi.mock('../../store/feedback', () => ({negativeTextFeedback: vi.fn(),}),)
vi.mock('./schemas/config/schema', async (importOriginal,) => ({
	...await importOriginal<typeof import('./schemas/config/schema')>(),
	normalizeConfig,
}),)
vi.mock('../data/purify', () => ({purifyObject: vi.fn(),}),)
vi.mock('../persistence/cache', () => ({getCache, setCache, clearCache,}),)
vi.mock('../data/encoding', () => ({
	zlibDeflate: (text: string,) => btoa(text,),
	zlibInflate: (text: string,) => atob(text,),
	htmlDecode: (text: string,) => text,
	unescapeJSON: (text: string,) => text,
	byteLength: (text: string,) => new TextEncoder().encode(text,).length,
}),)
vi.mock('../infra/logging', () => ({
	default: () => ({debug: vi.fn(), warn: vi.fn(), error: vi.fn(),}),
}),)

import {encodeNotesShard,} from './schemas/usernotes/codec'
import type {UsernotesUser,} from './schemas/usernotes/schema'
import {clearSessionShardState,} from './schemas/usernotes/sharded'
import type {UsernotesManifest,} from './schemas/usernotes/sharding'
import {clearWikiLayoutCache,} from './wikiLayoutCache'
import {bootstrapFreshSub, copyNxgToLegacy, migrateSubredditToNxg, setCompatibilityMode,} from './wikiMigration'

/** Serializes a user→notes map into legacy v6 usernotes page text. */
function legacyNotesText (users: Record<string, unknown>,): string {
	return JSON.stringify({
		ver: 6,
		constants: {users: ['testmod',], warnings: ['ban',],},
		blob: btoa(JSON.stringify(users,),),
	},)
}

/** Serializes a user→record map into an nxg-usernotes shard page text. */
function nxgShardText (users: Record<string, UsernotesUser>,): string {
	return JSON.stringify(encodeNotesShard(users,),)
}

/** A single-shard manifest covering the whole hash space. */
function singleShardManifest (): UsernotesManifest {
	return {
		format: 'tbun-manifest',
		ver: 7,
		gen: 1,
		types: [{key: 'ban', text: 'Ban', color: 'red',},],
		shards: [{start: 0, page: 's1-00000000',},],
	}
}

/** Sets up readFromWiki to answer per-page, treating unlisted pages as missing. */
function mockWikiPages (pages: Record<string, unknown>,) {
	readFromWiki.mockImplementation((_sub: string, page: string,) =>
		Promise.resolve(
			page in pages
				? {ok: true, data: pages[page],}
				: {ok: false, reason: 'no_page',},
		)
	)
}

/** Returns the data written to a page, or undefined if it was never written. */
function writtenData (page: string,): unknown {
	return postToWiki.mock.calls.find((call,) => call[1] === page)?.[2]
}

/** Returns every page that was written, in order. */
function writtenPages (): string[] {
	return postToWiki.mock.calls.map((call,) => call[1])
}

beforeEach(async () => {
	vi.clearAllMocks()
	getCache.mockImplementation((_moduleId: unknown, _key: unknown, defaultVal: unknown,) =>
		Promise.resolve(defaultVal,)
	)
	setCache.mockResolvedValue(undefined,)
	clearCache.mockResolvedValue(undefined,)
	isModSub.mockResolvedValue(true,)
	postToWiki.mockResolvedValue(undefined,)
	getWikiPages.mockResolvedValue([],)
	clearSessionShardState()
	await clearWikiLayoutCache()
},)

describe('migrateSubredditToNxg', () => {
	it('copies all legacy pages to the NXG namespace and records the layout', async () => {
		mockWikiPages({
			'toolbox': {domainTags: [{name: 'example.com',},],},
			'usernotes': legacyNotesText({
				testuser: {ns: [{n: 'a note', t: 1234567890, m: 0, l: '', w: 0,},],},
			},),
			'notes/index': {version: 1, notes: [{slug: 'my-note',},],},
			'notes/my-note': 'note body',
			'tbsettings': '{"Utils.lastversion":700}',
		},)

		const result = await migrateSubredditToNxg('sub',)

		expect(result.failed,).toEqual([],)
		expect(result.copied,).toEqual([
			'toolbox-nxg',
			'toolbox-nxg/usernotes/s1-00000000',
			'toolbox-nxg/usernotes',
			'toolbox-nxg/notes',
			'toolbox-nxg/notes/my-note',
			'toolbox-nxg/user-settings',
		],)
		// The NXG config carries the config data plus the compat flag.
		expect(writtenData('toolbox-nxg',),).toMatchObject({
			'domainTags': [{name: 'example.com',},],
			'Toolbox.Utils.compatibilityWrites': true,
		},)
		// Usernotes land in the sharded layout: a shard page plus the manifest.
		const manifest = writtenData('toolbox-nxg/usernotes',) as UsernotesManifest
		expect(manifest.format,).toBe('tbun-manifest',)
		expect(manifest.shards,).toEqual([{start: 0, page: 's1-00000000',},],)
		const shard = writtenData('toolbox-nxg/usernotes/s1-00000000',) as {format: string; blob: string}
		expect(shard.format,).toBe('nxg-usernotes',)
		const payload = JSON.parse(atob(shard.blob,),)
		// Notes carry stable per-user indexes in the new format.
		expect(payload['testuser'].notes[0],).toMatchObject({index: 0, note: 'a note', mod: 'testmod',},)
		expect(payload['testuser'].nextIndex,).toBe(1,)
		expect(writtenData('toolbox-nxg/notes/my-note',),).toBe('note body',)
		// The legacy pages are never written.
		expect(writtenPages().every((page,) => page.startsWith('toolbox-nxg',)),).toBe(true,)
		// The layout cache records the migrated state.
		expect(setCache,).toHaveBeenCalledWith(
			'utils',
			'wikiLayoutCache',
			{sub: expect.objectContaining({state: 'nxg', compatibilityWrites: true,},),},
		)
	})

	it('skips optional pages that do not exist', async () => {
		mockWikiPages({toolbox: {domainTags: [],},},)

		const result = await migrateSubredditToNxg('sub',)

		expect(result.failed,).toEqual([],)
		expect(result.copied,).toEqual(['toolbox-nxg',],)
		expect(result.skipped,).toEqual(['usernotes', 'notes/index', 'tbsettings',],)
	})

	it('aborts without writes when the user does not moderate the sub', async () => {
		isModSub.mockResolvedValue(false,)
		mockWikiPages({toolbox: {},},)

		const result = await migrateSubredditToNxg('sub',)

		expect(result.failed,).toHaveLength(1,)
		expect(postToWiki,).not.toHaveBeenCalled()
	})

	it('aborts on a write failure for a page that exists and does not record the layout', async () => {
		mockWikiPages({
			toolbox: {domainTags: [],},
			usernotes: legacyNotesText({testuser: {ns: [],},},),
			tbsettings: 'settings',
		},)
		postToWiki.mockImplementation((_sub: string, page: string,) =>
			page.startsWith('toolbox-nxg/usernotes',)
				? Promise.reject(Object.assign(new Error('403',), {response: {status: 403,},},),)
				: Promise.resolve(undefined,)
		)

		const result = await migrateSubredditToNxg('sub',)

		expect(result.failed,).toEqual(
			[{page: 'toolbox-nxg/usernotes', reason: 'no wiki write permission',},],
		)
		// Aborted before later steps.
		expect(writtenData('toolbox-nxg/user-settings',),).toBeUndefined()
		expect(setCache,).not.toHaveBeenCalledWith(
			'utils',
			'wikiLayoutCache',
			expect.objectContaining({sub: expect.anything(),},),
		)
	})

	it('aborts when the legacy config cannot be read', async () => {
		readFromWiki.mockResolvedValue({ok: false, reason: 'unknown_error',},)

		const result = await migrateSubredditToNxg('sub',)

		expect(result.failed,).toEqual([{page: 'toolbox', reason: 'unknown_error',},],)
		expect(postToWiki,).not.toHaveBeenCalled()
	})

	it('writes a minimal NXG config for usernotes-only subs', async () => {
		mockWikiPages({usernotes: legacyNotesText({testuser: {ns: [{n: 'x', t: 1, m: 0, l: '', w: 0,},],},},),},)

		const result = await migrateSubredditToNxg('sub',)

		expect(result.failed,).toEqual([],)
		expect(writtenData('toolbox-nxg',),).toEqual({'Toolbox.Utils.compatibilityWrites': true,},)
		expect((writtenData('toolbox-nxg/usernotes',) as UsernotesManifest).format,).toBe('tbun-manifest',)
	})

	it('re-runs reconcile-merge instead of clobbering NXG-only state', async () => {
		// The shards hold an archived note that the legacy mirror (active
		// notes only) doesn't list; a 6.x mod also added a note on legacy.
		const {encodeNotesShard,} = await import('./schemas/usernotes/codec')
		const shardPage = encodeNotesShard({
			testuser: {
				name: 'testuser',
				nextIndex: 2,
				notes: [
					{index: 0, note: 'active note', time: 1234567890000, mod: 'mod', type: '', link: '',},
					{
						index: 1,
						note: 'archived note',
						time: 1234567990000,
						mod: 'mod',
						type: '',
						link: '',
						archived: {by: 'mod2', at: 1700000000000,},
					},
				],
			},
		},)
		mockWikiPages({
			'toolbox': {domainTags: [],},
			'usernotes': legacyNotesText({
				testuser: {
					ns: [
						{n: 'active note', t: 1234567890, m: 0, l: '', w: 0,},
						{n: 'added in 6.x', t: 1234568890, m: 0, l: '', w: 0,},
					],
				},
			},),
			'toolbox-nxg': {'Toolbox.Utils.compatibilityWrites': true,},
			'toolbox-nxg/usernotes': JSON.stringify(singleShardManifest(),),
			'toolbox-nxg/usernotes/s1-00000000': JSON.stringify(shardPage,),
		},)

		const result = await migrateSubredditToNxg('sub',)

		expect(result.failed,).toEqual([],)
		const written = writtenData('toolbox-nxg/usernotes/s1-00000000',) as {blob: string}
		const payload = JSON.parse(atob(written.blob,),)
		const notes = payload['testuser'].notes
		// The archived note survives the re-run; the 6.x addition merged in.
		expect(notes.some((n: {note?: string; archived?: boolean},) => n.note === 'archived note' && n.archived),).toBe(
			true,
		)
		expect(notes.some((n: {note?: string; archived?: boolean},) => n.note === 'added in 6.x' && !n.archived),).toBe(
			true,
		)
		expect(notes.some((n: {note?: string; archived?: boolean},) => n.note === 'active note' && !n.archived),).toBe(
			true,
		)
	})

	it('re-runs reuse existing shard page names instead of churning generations', async () => {
		mockWikiPages({
			'toolbox': {domainTags: [],},
			'usernotes': legacyNotesText({
				testuser: {ns: [{n: 'a note', t: 1234567890, m: 0, l: '', w: 0,},],},
			},),
			'toolbox-nxg': {'Toolbox.Utils.compatibilityWrites': true,},
			'toolbox-nxg/usernotes': JSON.stringify(singleShardManifest(),),
			'toolbox-nxg/usernotes/s1-00000000': nxgShardText({
				olduser: {
					name: 'olduser',
					nextIndex: 1,
					notes: [{index: 0, note: 'stale', time: 1000, mod: 'mod', type: '', link: '',},],
				},
			},),
		},)

		const result = await migrateSubredditToNxg('sub',)

		expect(result.failed,).toEqual([],)
		// The existing shard page is rewritten in place — no new generation.
		const shard = writtenData('toolbox-nxg/usernotes/s1-00000000',) as {blob: string}
		expect(JSON.parse(atob(shard.blob,),),).toHaveProperty('testuser',)
	})

	it('does not copy a tombstone as if it were config', async () => {
		mockWikiPages({toolbox: {'Toolbox.Utils.wikiLayout': 'nxg',},},)

		await migrateSubredditToNxg('sub',)

		expect(writtenData('toolbox-nxg',),).toEqual({'Toolbox.Utils.compatibilityWrites': true,},)
	})

	it('embeds compatibilityWrites: false when requested', async () => {
		mockWikiPages({toolbox: {domainTags: [],},},)

		await migrateSubredditToNxg('sub', {compatibilityWrites: false,},)

		expect(writtenData('toolbox-nxg',),).toMatchObject({'Toolbox.Utils.compatibilityWrites': false,},)
		expect(setCache,).toHaveBeenCalledWith(
			'utils',
			'wikiLayoutCache',
			{sub: expect.objectContaining({compatibilityWrites: false,},),},
		)
	})

	it('rebuilds the note index from the page listing when no index exists', async () => {
		mockWikiPages({
			'toolbox': {},
			'notes/alpha': 'alpha body',
			'notes/beta': 'beta body',
		},)
		getWikiPages.mockResolvedValue(['notes/alpha', 'notes/index', 'notes/beta', 'toolbox',],)

		const result = await migrateSubredditToNxg('sub',)

		expect(result.failed,).toEqual([],)
		// The NXG index page gets the v2 shape with aggregate fields.
		expect(writtenData('toolbox-nxg/notes',),).toMatchObject({
			version: 2,
			tags: [],
			authors: [],
			notes: [
				expect.objectContaining({slug: 'alpha',},),
				expect.objectContaining({slug: 'beta',},),
			],
		},)
		expect(writtenData('toolbox-nxg/notes/alpha',),).toBe('alpha body',)
		expect(writtenData('toolbox-nxg/notes/beta',),).toBe('beta body',)
	})

	it('overwrites existing NXG pages (idempotent re-run)', async () => {
		mockWikiPages({
			'toolbox': {domainTags: [],},
			'toolbox-nxg': {stale: true,},
		},)

		const result = await migrateSubredditToNxg('sub',)

		expect(result.failed,).toEqual([],)
		expect(writtenData('toolbox-nxg',),).toMatchObject({domainTags: [],},)
	})
})

describe('bootstrapFreshSub', () => {
	it('creates only the default config page with compat off and records the layout', async () => {
		mockWikiPages({},)

		const result = await bootstrapFreshSub('sub',)

		expect(result.failed,).toEqual([],)
		expect(result.copied,).toEqual(['toolbox-nxg',],)
		// Exactly one wiki write: the default v2 config plus the compat flag.
		expect(postToWiki,).toHaveBeenCalledTimes(1,)
		expect(writtenData('toolbox-nxg',),).toMatchObject({
			'ver': 2,
			'removalReasons': {reasons: [],},
			'modMacros': [],
			'Toolbox.Utils.compatibilityWrites': false,
		},)
		expect(setCache,).toHaveBeenCalledWith(
			'utils',
			'wikiLayoutCache',
			{sub: expect.objectContaining({state: 'nxg', compatibilityWrites: false,},),},
		)
	})

	it('clears a stale noConfig cache entry for the sub', async () => {
		mockWikiPages({},)
		getCache.mockImplementation((_moduleId: unknown, key: unknown, defaultVal: unknown,) =>
			Promise.resolve(key === 'noConfig' ? ['othersub', 'sub',] : defaultVal,)
		)

		await bootstrapFreshSub('sub',)

		expect(setCache,).toHaveBeenCalledWith('utils', 'noConfig', ['othersub',],)
	})

	it('aborts without writes when the user does not moderate the sub', async () => {
		isModSub.mockResolvedValue(false,)

		const result = await bootstrapFreshSub('sub',)

		expect(result.failed,).toHaveLength(1,)
		expect(postToWiki,).not.toHaveBeenCalled()
		expect(setCache,).not.toHaveBeenCalledWith(
			'utils',
			'wikiLayoutCache',
			expect.objectContaining({sub: expect.anything(),},),
		)
	})

	it('reports a write failure without recording the layout', async () => {
		mockWikiPages({},)
		postToWiki.mockRejectedValue(
			Object.assign(new Error('nope',), {response: {status: 403,} as Response,},),
		)

		const result = await bootstrapFreshSub('sub',)

		expect(result.failed,).toEqual([{page: 'toolbox-nxg', reason: 'no wiki write permission',},],)
		expect(setCache,).not.toHaveBeenCalledWith(
			'utils',
			'wikiLayoutCache',
			expect.objectContaining({sub: expect.anything(),},),
		)
	})
})

describe('copyNxgToLegacy', () => {
	it('copies NXG pages back to legacy paths as the classic schema', async () => {
		mockWikiPages({
			'toolbox-nxg': {
				'domainTags': [],
				'Toolbox.Utils.compatibilityWrites': false,
			},
			'toolbox-nxg/usernotes': JSON.stringify(singleShardManifest(),),
			'toolbox-nxg/usernotes/s1-00000000': nxgShardText({
				testuser: {
					name: 'testuser',
					nextIndex: 1,
					notes: [{index: 0, note: 'a note', time: 1234567890000, mod: 'mod', type: '', link: '',},],
				},
			},),
			'toolbox-nxg/notes': {version: 1, notes: [{slug: 'my-note',},],},
			'toolbox-nxg/notes/my-note': 'note body',
		},)

		const result = await copyNxgToLegacy('sub',)

		expect(result.failed,).toEqual([],)
		// The legacy copy is the classic v1 schema with NXG metadata stripped.
		expect(writtenData('toolbox',),).toMatchObject({domainTags: [], ver: 1,},)
		// The sharded notes are merged into one legacy v6 blob.
		const legacyNotes = writtenData('usernotes',) as {ver: number; blob: string}
		expect(legacyNotes.ver,).toBe(6,)
		expect(JSON.parse(atob(legacyNotes.blob,),),).toHaveProperty('testuser',)
		expect(writtenData('notes/my-note',),).toBe('note body',)
		// The legacy index gets the v1 wire shape (no aggregate fields).
		const legacyIndex = writtenData('notes/index',)
		expect(legacyIndex.version,).toBe(1,)
		expect(legacyIndex,).not.toHaveProperty('tags',)
		expect(legacyIndex,).not.toHaveProperty('authors',)
		// The NXG pages are never written.
		expect(writtenPages().some((page,) => page.startsWith('toolbox-nxg',)),).toBe(false,)
	})

	it('aborts when the NXG config is missing', async () => {
		mockWikiPages({},)

		const result = await copyNxgToLegacy('sub',)

		expect(result.failed,).toEqual([{page: 'toolbox-nxg', reason: 'no_page',},],)
		expect(postToWiki,).not.toHaveBeenCalled()
	})

	it('fails when the NXG usernotes page is not a shard manifest', async () => {
		mockWikiPages({
			'toolbox-nxg': {'domainTags': [], 'Toolbox.Utils.compatibilityWrites': false,},
			'toolbox-nxg/usernotes': legacyNotesText({
				testuser: {ns: [{n: 'a note', t: 1234567890, m: 0, l: '', w: 0,},],},
			},),
		},)

		const result = await copyNxgToLegacy('sub',)

		expect(result.failed,).toEqual([
			{page: 'toolbox-nxg/usernotes', reason: expect.stringContaining('not a shard manifest',),},
		],)
		expect(writtenData('usernotes',),).toBeUndefined()
	})

	it('fails with the 1MB-limit reason when the merged legacy write 413s', async () => {
		mockWikiPages({
			'toolbox-nxg': {domainTags: [],},
			'toolbox-nxg/usernotes': JSON.stringify(singleShardManifest(),),
			'toolbox-nxg/usernotes/s1-00000000': nxgShardText({
				testuser: {
					name: 'testuser',
					nextIndex: 1,
					notes: [{index: 0, note: 'a note', time: 1234567890000, mod: 'mod', type: '', link: '',},],
				},
			},),
		},)
		postToWiki.mockImplementation((_sub: string, page: string,) =>
			page === 'usernotes'
				? Promise.reject(Object.assign(new Error('413',), {response: {status: 413,},},),)
				: Promise.resolve(undefined,)
		)

		const result = await copyNxgToLegacy('sub',)

		expect(result.failed,).toEqual([
			{page: 'usernotes', reason: expect.stringContaining('1MB limit',),},
		],)
	})
})

describe('setCompatibilityMode', () => {
	it('turning off refreshes the mirror, tombstones the legacy page, and clears caches', async () => {
		mockWikiPages({toolbox: {domainTags: [],},},)

		const result = await setCompatibilityMode('sub', false,)

		expect(result.failed,).toEqual([],)
		// Mirror refreshed with the new flag value.
		expect(writtenData('toolbox-nxg',),).toMatchObject({'Toolbox.Utils.compatibilityWrites': false,},)
		// Legacy toolbox page replaced by the tombstone.
		expect(writtenData('toolbox',),).toEqual({'Toolbox.Utils.wikiLayout': 'nxg',},)
		expect(clearCache,).toHaveBeenCalled()
	})

	it('turning on copies NXG data back to legacy first and records the flag', async () => {
		mockWikiPages({
			'toolbox-nxg': {
				'domainTags': [],
				'Toolbox.Utils.compatibilityWrites': false,
			},
		},)

		const result = await setCompatibilityMode('sub', true,)

		expect(result.failed,).toEqual([],)
		expect(writtenData('toolbox',),).toMatchObject({domainTags: [], ver: 1,},)
		expect(writtenData('toolbox-nxg',),).toMatchObject({'Toolbox.Utils.compatibilityWrites': true,},)
		expect(clearCache,).toHaveBeenCalled()
		expect(setCache,).toHaveBeenCalledWith(
			'utils',
			'wikiLayoutCache',
			{sub: expect.objectContaining({state: 'nxg', compatibilityWrites: true,},),},
		)
	})

	it('does not tombstone the legacy page when the refresh fails', async () => {
		mockWikiPages({toolbox: {domainTags: [],},},)
		postToWiki.mockRejectedValue(Object.assign(new Error('413',), {response: {status: 413,},},),)

		const result = await setCompatibilityMode('sub', false,)

		expect(result.failed,).toEqual([{page: 'toolbox-nxg', reason: 'page too large',},],)
		expect(writtenData('toolbox',),).toBeUndefined()
	})
})
