/** Tests for the sharded NXG usernotes read/write core. */

// @vitest-environment node
import {afterEach, describe, expect, it, vi,} from 'vitest'

const sendMessage = vi.hoisted(() =>
	vi.fn(async (msg: any,) => {
		if (msg?.action === 'toolbox-usernote-decompress') {
			return {users: JSON.parse(atob(msg.blob,),),}
		}
	},)
)
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage,},},}),)
vi.mock('../../../../api/resources/wiki', () => ({
	readFromWiki: vi.fn(),
	postToWiki: vi.fn().mockResolvedValue(undefined,),
	getWikiPages: vi.fn().mockResolvedValue([],),
}),)
vi.mock('../../../data/encoding', () => ({
	zlibDeflate: (s: string,) => btoa(s,),
	zlibInflate: (s: string,) => atob(s,),
	htmlDecode: (s: string,) => s,
	unescapeJSON: (s: string,) => s,
	byteLength: (s: string,) => new TextEncoder().encode(s,).length,
}),)
import {getWikiPages, postToWiki, readFromWiki,} from '../../../../api/resources/wiki'
import {encodeNotesShard,} from './codec'
import type {UserNotesData, UsernotesUser,} from './schema'
import {
	clearSessionShardState,
	getSessionStorageInfo,
	listRetiredUsernoteShardPages,
	listUsernoteShardPages,
	readShardedUsernotes,
	writeShardedUsernotes,
} from './sharded'
import {hashUsername, UsernotesManifest,} from './sharding'

const MANIFEST_PAGE = 'toolbox-nxg/usernotes'

/** Builds a user with one note of the given text. */
function makeUser (name: string, note = `note for ${name}`,): UsernotesUser {
	return {name, notes: [{note, time: 1700000000000, mod: 'mod', type: '', link: '',},],}
}

/** A valid two-shard manifest splitting the hash space at 0x80000000. */
function twoShardManifest (): UsernotesManifest {
	return {
		format: 'tbun-manifest',
		ver: 7,
		gen: 2,
		types: [{key: 'ban', text: 'Ban', color: 'red',},],
		shards: [
			{start: 0, page: 's1-00000000',},
			{start: 0x80000000, page: 's2-80000000',},
		],
	}
}

/** Splits users between the two halves of {@link twoShardManifest} by hash. */
function splitUsersByHalf (users: UsernotesUser[],) {
	const lower: Record<string, UsernotesUser> = {}
	const upper: Record<string, UsernotesUser> = {}
	for (const user of users) {
		;(hashUsername(user.name,) < 0x80000000 ? lower : upper)[user.name] = user
	}
	return {lower, upper,}
}

/** Serializes a slice of users into shard page text via the real shard codec. */
function shardPageText (users: Record<string, UsernotesUser>,): string {
	return JSON.stringify(encodeNotesShard(users,),)
}

/** Mocks `readFromWiki` to serve the given page texts, missing pages yielding `no_page`. */
function mockWikiPages (pages: Record<string, string>,) {
	vi.mocked(readFromWiki,).mockImplementation(async (_sub: string, page: string,) =>
		pages[page] !== undefined
			? {ok: true, data: pages[page],} as any
			: {ok: false, reason: 'no_page',} as any
	)
}

afterEach(() => {
	vi.clearAllMocks()
	clearSessionShardState()
},)

describe('readShardedUsernotes', () => {
	it('reads the manifest and all shards, merging users and attaching manifest types', async () => {
		const manifest = twoShardManifest()
		const {lower, upper,} = splitUsersByHalf(['alpha', 'bravo', 'charlie', 'delta',].map((n,) => makeUser(n,)),)
		mockWikiPages({
			[MANIFEST_PAGE]: JSON.stringify(manifest,),
			[`${MANIFEST_PAGE}/s1-00000000`]: shardPageText(lower,),
			[`${MANIFEST_PAGE}/s2-80000000`]: shardPageText(upper,),
		},)

		const result = await readShardedUsernotes('sub',)

		expect(result.kind,).toBe('sharded',)
		if (result.kind !== 'sharded') { return }
		expect(Object.keys(result.notes.users,).sort(),).toEqual(['alpha', 'bravo', 'charlie', 'delta',],)
		expect(result.notes.types,).toEqual(manifest.types,)
		expect(result.notes.corrupted,).toBeUndefined()
	})

	it('returns no_page when the manifest page does not exist', async () => {
		mockWikiPages({},)
		expect(await readShardedUsernotes('sub',),).toEqual({kind: 'no_page',},)
	})

	it('throws naming the shard page when a shard is missing', async () => {
		const manifest = twoShardManifest()
		mockWikiPages({
			[MANIFEST_PAGE]: JSON.stringify(manifest,),
			[`${MANIFEST_PAGE}/s1-00000000`]: shardPageText({},),
			// s2-80000000 missing
		},)

		await expect(readShardedUsernotes('sub',),).rejects.toThrow(/s2-80000000 is missing or unreadable/,)
	})

	it('throws for a corrupt manifest', async () => {
		mockWikiPages({[MANIFEST_PAGE]: JSON.stringify({format: 'tbun-manifest', ver: 7, gen: 1, shards: [],},),},)
		await expect(readShardedUsernotes('sub',),).rejects.toThrow(/not a shard manifest/,)
	})

	it('records session storage info', async () => {
		const manifest = twoShardManifest()
		const {lower, upper,} = splitUsersByHalf(['alpha', 'bravo', 'charlie',].map((n,) => makeUser(n,)),)
		const pages = {
			[MANIFEST_PAGE]: JSON.stringify(manifest,),
			[`${MANIFEST_PAGE}/s1-00000000`]: shardPageText(lower,),
			[`${MANIFEST_PAGE}/s2-80000000`]: shardPageText(upper,),
		}
		mockWikiPages(pages,)

		await readShardedUsernotes('sub',)

		const info = getSessionStorageInfo('sub',)!
		expect(info.shardCount,).toBe(2,)
		expect(info.totalBytes,).toBe(
			pages[`${MANIFEST_PAGE}/s1-00000000`]!.length + pages[`${MANIFEST_PAGE}/s2-80000000`]!.length,
		)
		expect(info.largestShardBytes,).toBeLessThanOrEqual(info.totalBytes,)
	})
})

describe('listUsernoteShardPages', () => {
	it('lists the shard suffixes from the manifest page', async () => {
		mockWikiPages({[MANIFEST_PAGE]: JSON.stringify(twoShardManifest(),),},)
		expect(await listUsernoteShardPages('sub',),).toEqual(['s1-00000000', 's2-80000000',],)
	})

	it('returns [] when the manifest page does not exist', async () => {
		mockWikiPages({},)
		expect(await listUsernoteShardPages('sub',),).toEqual([],)
	})

	it('returns [] for unrecognized page content', async () => {
		mockWikiPages({[MANIFEST_PAGE]: '{"ver":6,"blob":"abc"}',},)
		expect(await listUsernoteShardPages('sub',),).toEqual([],)
		mockWikiPages({[MANIFEST_PAGE]: 'not json',},)
		expect(await listUsernoteShardPages('sub',),).toEqual([],)
	})

	it('prefers the session state from a previous sharded read over a wiki read', async () => {
		const manifest = twoShardManifest()
		const {lower, upper,} = splitUsersByHalf(['alpha', 'bravo',].map((n,) => makeUser(n,)),)
		mockWikiPages({
			[MANIFEST_PAGE]: JSON.stringify(manifest,),
			[`${MANIFEST_PAGE}/s1-00000000`]: shardPageText(lower,),
			[`${MANIFEST_PAGE}/s2-80000000`]: shardPageText(upper,),
		},)
		await readShardedUsernotes('sub',)
		vi.mocked(readFromWiki,).mockClear()

		expect(await listUsernoteShardPages('sub',),).toEqual(['s1-00000000', 's2-80000000',],)
		expect(readFromWiki,).not.toHaveBeenCalled()
	})
})

describe('listRetiredUsernoteShardPages', () => {
	it('lists pages under the usernotes prefix that are not active shards', async () => {
		vi.mocked(getWikiPages,).mockResolvedValueOnce([
			'index',
			'toolbox-nxg',
			'toolbox-nxg/usernotes',
			'toolbox-nxg/usernotes/s1-00000000',
			'toolbox-nxg/usernotes/s2-80000000',
			'toolbox-nxg/usernotes/s1-80000000',
			'toolbox-nxg/notes/some-note',
		],)

		const retired = await listRetiredUsernoteShardPages('sub', ['s2-80000000', 's1-00000000',],)

		expect(retired,).toEqual(['s1-80000000',],)
	})

	it('ignores nested pages under a shard suffix', async () => {
		vi.mocked(getWikiPages,).mockResolvedValueOnce([
			'toolbox-nxg/usernotes/s1-00000000/extra',
		],)
		expect(await listRetiredUsernoteShardPages('sub', [],),).toEqual([],)
	})

	it('returns [] when the page listing fails', async () => {
		vi.mocked(getWikiPages,).mockRejectedValueOnce(new Error('nope',),)
		expect(await listRetiredUsernoteShardPages('sub', [],),).toEqual([],)
	})
})

describe('writeShardedUsernotes', () => {
	it('writes one shard and the manifest for a fresh subreddit, shard first', async () => {
		mockWikiPages({},)
		const notes: UserNotesData = {
			ver: 6,
			users: {alpha: makeUser('alpha',),},
			types: [{key: 'ban', text: 'Ban', color: 'red',},],
		}

		const {written,} = await writeShardedUsernotes('sub', notes, 'test',)

		expect(written,).toEqual([`${MANIFEST_PAGE}/s1-00000000`, MANIFEST_PAGE,],)
		const calls = vi.mocked(postToWiki,).mock.calls
		expect(calls.map((call,) => call[1]),).toEqual([`${MANIFEST_PAGE}/s1-00000000`, MANIFEST_PAGE,],)
		const manifest = calls[1]![2] as UsernotesManifest
		expect(manifest.format,).toBe('tbun-manifest',)
		expect(manifest.gen,).toBe(1,)
		expect(manifest.types,).toEqual(notes.types,)
		expect(manifest.shards,).toEqual([{start: 0, page: 's1-00000000',},],)
	})

	it('skips clean shards and the unchanged manifest entirely', async () => {
		const manifest = twoShardManifest()
		const {lower, upper,} = splitUsersByHalf(['alpha', 'bravo', 'charlie', 'delta',].map((n,) => makeUser(n,)),)
		mockWikiPages({
			[MANIFEST_PAGE]: JSON.stringify(manifest,),
			[`${MANIFEST_PAGE}/s1-00000000`]: shardPageText(lower,),
			[`${MANIFEST_PAGE}/s2-80000000`]: shardPageText(upper,),
		},)
		const read = await readShardedUsernotes('sub',)
		if (read.kind !== 'sharded') { throw new Error('expected sharded read',) }

		const {written,} = await writeShardedUsernotes('sub', read.notes, 'test',)

		expect(written,).toEqual([],)
		expect(postToWiki,).not.toHaveBeenCalled()
	})

	it('rewrites only the shard whose users changed', async () => {
		const manifest = twoShardManifest()
		const users = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',].map((n,) => makeUser(n,))
		const {lower, upper,} = splitUsersByHalf(users,)
		expect(Object.keys(lower,).length,).toBeGreaterThan(0,)
		expect(Object.keys(upper,).length,).toBeGreaterThan(0,)
		mockWikiPages({
			[MANIFEST_PAGE]: JSON.stringify(manifest,),
			[`${MANIFEST_PAGE}/s1-00000000`]: shardPageText(lower,),
			[`${MANIFEST_PAGE}/s2-80000000`]: shardPageText(upper,),
		},)
		const read = await readShardedUsernotes('sub',)
		if (read.kind !== 'sharded') { throw new Error('expected sharded read',) }

		// Modify one user from the lower half only.
		const changedName = Object.keys(lower,)[0]!
		const notes = structuredClone(read.notes,)
		notes.users[changedName]!.notes.push({note: 'new note', time: 1700000001000, mod: 'mod2', type: '', link: '',},)

		const {written,} = await writeShardedUsernotes('sub', notes, 'test',)

		expect(written,).toEqual([`${MANIFEST_PAGE}/s1-00000000`,],)
		expect(postToWiki,).toHaveBeenCalledOnce()
	})

	it('splits an overflowing shard into new-generation pages, manifest last, tombstone after', async () => {
		mockWikiPages({},)
		// Two users whose combined notes exceed the soft limit but who fit
		// individually (the mocked "zlib" is identity/btoa, so envelope size
		// tracks note size).
		const big = 'x'.repeat(300_000,)
		const notes: UserNotesData = {
			ver: 6,
			users: {
				alpha: makeUser('alpha', big,),
				bravo: makeUser('bravo', big,),
			},
			types: [],
		}

		// First save creates the single-shard layout... which immediately
		// overflows and splits into two gen-2 pages.
		const {written,} = await writeShardedUsernotes('sub', notes, 'test',)

		const calls = vi.mocked(postToWiki,).mock.calls
		const pagesWritten = calls.map((call,) => call[1])
		// Two split shard pages, then the manifest. No tombstone: the
		// replaced page never existed on the wiki.
		expect(pagesWritten,).toHaveLength(3,)
		expect(pagesWritten[2],).toBe(MANIFEST_PAGE,)
		expect(written,).toEqual(pagesWritten,)

		const manifest = calls[2]![2] as UsernotesManifest
		expect(manifest.shards,).toHaveLength(2,)
		expect(manifest.gen,).toBe(2,)
		expect(manifest.shards[0]!.start,).toBe(0,)
		expect(manifest.shards[0]!.page,).toBe(`s2-00000000`,)
		expect(manifest.shards[1]!.page,).toBe(`s2-${manifest.shards[1]!.start.toString(16,).padStart(8, '0',)}`,)
		expect(manifest.retired,).toBeUndefined()

		// Each user landed in the shard covering their hash.
		const boundary = manifest.shards[1]!.start
		for (const [index, call,] of [0, 1,].map((i,) => [i, calls[i]!,] as const)) {
			const envelope = call[2] as {blob: string}
			const sliceUsers = Object.keys(JSON.parse(atob(envelope.blob,),),)
			for (const name of sliceUsers) {
				expect(hashUsername(name,) >= boundary,).toBe(index === 1,)
			}
		}
	})

	it('tombstones the replaced page when splitting a shard that exists on the wiki', async () => {
		const manifest: UsernotesManifest = {
			format: 'tbun-manifest',
			ver: 7,
			gen: 1,
			types: [],
			shards: [{start: 0, page: 's1-00000000',},],
		}
		mockWikiPages({
			[MANIFEST_PAGE]: JSON.stringify(manifest,),
			[`${MANIFEST_PAGE}/s1-00000000`]: shardPageText({alpha: makeUser('alpha',),},),
		},)
		const read = await readShardedUsernotes('sub',)
		if (read.kind !== 'sharded') { throw new Error('expected sharded read',) }

		// Snapshot post contents at call time — the writer may mutate the
		// manifest object after a successful write (e.g. clearing `retired`
		// once the tombstone lands), which is fine because postToWiki
		// stringifies synchronously.
		const posts: Array<{page: string; content: unknown}> = []
		vi.mocked(postToWiki,).mockImplementation(async (_sub, page, data,) => {
			posts.push({page, content: JSON.parse(JSON.stringify(data,),),},)
		},)

		const big = 'x'.repeat(300_000,)
		const notes = structuredClone(read.notes,)
		notes.users['bravo'] = makeUser('bravo', big,)
		notes.users['alpha']!.notes[0]!.note = big

		await writeShardedUsernotes('sub', notes, 'test',)

		// Two new shard pages, manifest, then the tombstone for the old page.
		expect(posts.map((post,) => post.page),).toHaveLength(4,)
		expect(posts[2]!.page,).toBe(MANIFEST_PAGE,)
		expect(posts[3],).toEqual({page: `${MANIFEST_PAGE}/s1-00000000`, content: 'TBUN-RETIRED',},)

		// The written manifest drops the retired page from its shard list but
		// records it under `retired` for tombstoning.
		const writtenManifest = posts[2]!.content as UsernotesManifest
		expect(writtenManifest.shards.some((ref,) => ref.page === 's1-00000000'),).toBe(false,)
		expect(writtenManifest.retired,).toEqual(['s1-00000000',],)
	})

	it('does not write the manifest when a shard write fails', async () => {
		mockWikiPages({},)
		vi.mocked(postToWiki,).mockRejectedValueOnce(new Error('write failed',),)

		await expect(
			writeShardedUsernotes('sub', {ver: 6, users: {alpha: makeUser('alpha',),}, types: [],}, 'test',),
		).rejects.toThrow('write failed',)

		const pagesWritten = vi.mocked(postToWiki,).mock.calls.map((call,) => call[1])
		expect(pagesWritten,).toEqual([`${MANIFEST_PAGE}/s1-00000000`,],)
	})

	it('fails naming the user when a single user exceeds the hard limit', async () => {
		mockWikiPages({},)
		const notes: UserNotesData = {
			ver: 6,
			users: {hugeuser: makeUser('hugeuser', 'x'.repeat(600_000,),),},
			types: [],
		}

		await expect(writeShardedUsernotes('sub', notes, 'test',),)
			.rejects.toThrow(/notes for u\/hugeuser are too large/,)
		expect(postToWiki,).not.toHaveBeenCalled()
	})

	it('rewrites everything when shards cannot be re-read (repair path)', async () => {
		const manifest = twoShardManifest()
		// Manifest exists but its shard pages were deleted externally.
		mockWikiPages({[MANIFEST_PAGE]: JSON.stringify(manifest,),},)

		const users = ['alpha', 'bravo', 'charlie',].map((n,) => makeUser(n,))
		const notes: UserNotesData = {
			ver: 6,
			users: Object.fromEntries(users.map((u,) => [u.name, u,]),),
			types: [],
		}

		const {written,} = await writeShardedUsernotes('sub', notes, 'test',)

		// Both shard pages rewritten; the manifest itself is unchanged so it
		// is not rewritten.
		expect(written.sort(),).toEqual([
			`${MANIFEST_PAGE}/s1-00000000`,
			`${MANIFEST_PAGE}/s2-80000000`,
		],)
	})

	it('replaces an unrecognized NXG usernotes page with a fresh sharded layout on save', async () => {
		mockWikiPages({[MANIFEST_PAGE]: JSON.stringify({some: 'unrelated json',},),},)

		const {written,} = await writeShardedUsernotes(
			'sub',
			{ver: 6, users: {alpha: makeUser('alpha',),}, types: [],},
			'test',
		)

		expect(written,).toEqual([`${MANIFEST_PAGE}/s1-00000000`, MANIFEST_PAGE,],)
	})
})
