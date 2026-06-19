import {describe, expect, it,} from 'vitest'

import {UserNotesData, UsernotesUser,} from './schema'
import {
	hashUsername,
	initialManifest,
	isUsernotesManifest,
	mergeShardData,
	partitionUsers,
	pickSplitBoundary,
	shardIndexForHash,
	shardPageName,
	UsernotesManifest,
} from './sharding'

/** Builds a user with a single note. */
function makeUser (name: string,): UsernotesUser {
	return {name, notes: [{note: `note for ${name}`, time: 1700000000000, mod: 'mod',},],}
}

/** A two-shard manifest splitting the hash space at 0x80000000. */
function twoShardManifest (): UsernotesManifest {
	return {
		format: 'tbun-manifest',
		ver: 7,
		gen: 2,
		types: [],
		shards: [
			{start: 0, page: 's1-00000000',},
			{start: 0x80000000, page: 's2-80000000',},
		],
	}
}

describe('hashUsername', () => {
	it('matches the 32-bit FNV-1a reference vectors', () => {
		// These pin the storage format: changing the hash function strands
		// existing users in the wrong shards.
		expect(hashUsername('',),).toBe(0x811c9dc5,)
		expect(hashUsername('a',),).toBe(0xe40c292c,)
		expect(hashUsername('foobar',),).toBe(0xbf9cf968,)
	})

	it('hashes all casings of a username identically', () => {
		expect(hashUsername('SomeUser',),).toBe(hashUsername('someuser',),)
		expect(hashUsername('SOMEUSER',),).toBe(hashUsername('someuser',),)
	})
})

describe('isUsernotesManifest', () => {
	it('accepts a valid manifest', () => {
		expect(isUsernotesManifest(twoShardManifest(),),).toBe(true,)
		expect(isUsernotesManifest(initialManifest([],),),).toBe(true,)
	})

	it('rejects non-manifest pages', () => {
		expect(isUsernotesManifest(null,),).toBe(false,)
		expect(isUsernotesManifest({ver: 6, blob: 'x', constants: {},},),).toBe(false,)
		expect(isUsernotesManifest({format: 'tbun-manifest', ver: 2, gen: 1, types: [], shards: [],},),).toBe(false,)
	})

	it('rejects an empty shard list', () => {
		expect(isUsernotesManifest({...twoShardManifest(), shards: [],},),).toBe(false,)
	})

	it('rejects a first shard not starting at 0', () => {
		const manifest = twoShardManifest()
		manifest.shards[0]!.start = 1
		expect(isUsernotesManifest(manifest,),).toBe(false,)
	})

	it('rejects unsorted or duplicate starts', () => {
		const manifest = twoShardManifest()
		manifest.shards[1]!.start = 0
		expect(isUsernotesManifest(manifest,),).toBe(false,)

		const reversed = twoShardManifest()
		reversed.shards.reverse()
		expect(isUsernotesManifest(reversed,),).toBe(false,)
	})

	it('rejects duplicate page names and out-of-range starts', () => {
		const manifest = twoShardManifest()
		manifest.shards[1]!.page = manifest.shards[0]!.page
		expect(isUsernotesManifest(manifest,),).toBe(false,)

		const outOfRange = twoShardManifest()
		outOfRange.shards[1]!.start = 0x1_0000_0000
		expect(isUsernotesManifest(outOfRange,),).toBe(false,)
	})
})

describe('shardPageName / initialManifest', () => {
	it('encodes generation and zero-padded hex start', () => {
		expect(shardPageName(1, 0,),).toBe('s1-00000000',)
		expect(shardPageName(3, 0x80000000,),).toBe('s3-80000000',)
	})

	it('starts with one full-range shard at generation 1', () => {
		const manifest = initialManifest([{key: 'k', text: 't', color: 'red',},],)
		expect(manifest.gen,).toBe(1,)
		expect(manifest.shards,).toEqual([{start: 0, page: 's1-00000000',},],)
		expect(manifest.types,).toEqual([{key: 'k', text: 't', color: 'red',},],)
	})

	it('falls back to the default types when none are given', () => {
		expect(initialManifest([],).types.length,).toBeGreaterThan(0,)
	})
})

describe('shardIndexForHash / partitionUsers', () => {
	it('maps boundary hashes to the right shards', () => {
		const manifest = twoShardManifest()
		expect(shardIndexForHash(manifest, 0,),).toBe(0,)
		expect(shardIndexForHash(manifest, 0x7fffffff,),).toBe(0,)
		expect(shardIndexForHash(manifest, 0x80000000,),).toBe(1,)
		expect(shardIndexForHash(manifest, 0xffffffff,),).toBe(1,)
	})

	it('partitions users by hash and keeps empty shards present', () => {
		const manifest = twoShardManifest()
		const users: Record<string, UsernotesUser> = {}
		for (const name of ['alpha', 'bravo', 'charlie', 'delta', 'echo',]) {
			users[name] = makeUser(name,)
		}
		const slices = partitionUsers(users, manifest,)

		expect([...slices.keys(),],).toEqual(['s1-00000000', 's2-80000000',],)
		const all = Object.keys({...slices.get('s1-00000000',), ...slices.get('s2-80000000',),},)
		expect(all.sort(),).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo',],)
		for (const [page, slice,] of slices) {
			const rangeStart = page === 's1-00000000' ? 0 : 0x80000000
			const rangeEnd = page === 's1-00000000' ? 0x80000000 : 0x1_0000_0000
			for (const name of Object.keys(slice,)) {
				const hash = hashUsername(name,)
				expect(hash >= rangeStart && hash < rangeEnd,).toBe(true,)
			}
		}
	})

	it('partitions an emptied manifest into all-empty slices', () => {
		const slices = partitionUsers({}, twoShardManifest(),)
		expect(slices.get('s1-00000000',),).toEqual({},)
		expect(slices.get('s2-80000000',),).toEqual({},)
	})
})

describe('pickSplitBoundary', () => {
	it('splits a set of users near the median hash', () => {
		const users = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',].map(makeUser,)
		const boundary = pickSplitBoundary(users, 0,)
		expect(boundary,).not.toBeNull()

		const lower = users.filter((u,) => hashUsername(u.name,) < boundary!)
		const upper = users.filter((u,) => hashUsername(u.name,) >= boundary!)
		expect(lower.length,).toBeGreaterThan(0,)
		expect(upper.length,).toBeGreaterThan(0,)
		expect(lower.length + upper.length,).toBe(users.length,)
		// Roughly balanced: neither half holds everything.
		expect(Math.abs(lower.length - upper.length,),).toBeLessThanOrEqual(2,)
	})

	it('returns a boundary strictly greater than the range start', () => {
		const users = ['alpha', 'bravo', 'charlie',].map(makeUser,)
		const minHash = Math.min(...users.map((u,) => hashUsername(u.name,)),)
		const boundary = pickSplitBoundary(users, minHash,)
		expect(boundary,).not.toBeNull()
		expect(boundary!,).toBeGreaterThan(minHash,)
	})

	it('returns null for a single user', () => {
		expect(pickSplitBoundary([makeUser('alpha',),], 0,),).toBeNull()
	})

	it('returns null when all users share one hash (same name, different casing)', () => {
		const users = [makeUser('alpha',), makeUser('Alpha',), makeUser('ALPHA',),]
		expect(pickSplitBoundary(users, 0,),).toBeNull()
	})
})

describe('mergeShardData', () => {
	it('merges disjoint shards and attaches the manifest types', () => {
		const types = [{key: 'k', text: 't', color: 'red',},]
		const a: UserNotesData = {ver: 6, users: {alpha: makeUser('alpha',),},}
		const b: UserNotesData = {ver: 6, users: {bravo: makeUser('bravo',),},}
		const merged = mergeShardData([a, b,], types,)

		expect(Object.keys(merged.users,).sort(),).toEqual(['alpha', 'bravo',],)
		expect(merged.types,).toEqual(types,)
		expect(merged.corrupted,).toBeUndefined()
	})

	it('flags cross-shard user collisions as corrupted, last shard winning', () => {
		const a: UserNotesData = {ver: 6, users: {alpha: makeUser('alpha',),},}
		const b: UserNotesData = {
			ver: 6,
			users: {alpha: {name: 'alpha', notes: [{note: 'other', time: 1, mod: 'm',},],},},
		}
		const merged = mergeShardData([a, b,], [],)
		expect(merged.corrupted,).toBe(true,)
		expect(merged.users.alpha!.notes[0]!.note,).toBe('other',)
	})

	it('propagates a corrupted flag from any shard', () => {
		const a: UserNotesData = {ver: 6, users: {}, corrupted: true,}
		expect(mergeShardData([a,], [],).corrupted,).toBe(true,)
	})
})
