/**
 * Pure helpers for the sharded NXG usernotes layout. Reddit caps wiki pages
 * at 512KB (only the literal legacy path `usernotes` gets 1MB), so the NXG
 * layout splits usernotes across multiple pages: a small JSON manifest at
 * `toolbox-nxg/usernotes` maps username-hash ranges to shard pages under
 * `toolbox-nxg/usernotes/<suffix>`, each holding a complete v6 envelope for
 * its range. A shard that outgrows the soft limit splits at the median user
 * hash, so capacity grows without bound while ordinary saves rewrite only the
 * shards whose users actually changed.
 *
 * This module has no I/O - the wiki-facing read/write logic lives in
 * `sharded.ts`.
 */

import {defaultUsernoteTypes, UserNoteColor, UserNotesData, UsernotesUser,} from './schema'

/** Manifest format marker; identifies the page as a shard manifest. */
export const USERNOTES_MANIFEST_FORMAT = 'tbun-manifest'

/**
 * Current manifest schema version. Continues the legacy usernotes numbering:
 * v6 is the single-page zlib format, v7 the sharded manifest layout.
 */
export const USERNOTES_MANIFEST_VER = 7

/**
 * Soft per-shard limit on the posted page bytes; a dirty shard whose encoded
 * envelope exceeds this is split. Sits safely under Reddit's 512KB cap so a
 * shard can absorb further growth between saves.
 */
export const SHARD_SOFT_LIMIT_BYTES = 480_000

/**
 * Absolute ceiling for a shard that cannot split (all of its users share one
 * hash - in practice, a single user with enormous notes). Past this the save
 * fails rather than risk a 413 from Reddit.
 */
export const SHARD_HARD_LIMIT_BYTES = 510_000

/** One shard's entry in the manifest. */
export interface UsernotesShardRef {
	/**
	 * Inclusive uint32 lower bound of the shard's hash range. Shard `i` covers
	 * `[start_i, start_{i+1})`; the last shard covers through 2^32 - 1.
	 */
	start: number
	/** Page-name suffix under the NXG usernotes prefix, e.g. `s3-80000000`. */
	page: string
}

/** The JSON manifest stored at the NXG usernotes page. */
export interface UsernotesManifest {
	format: typeof USERNOTES_MANIFEST_FORMAT
	ver: typeof USERNOTES_MANIFEST_VER
	/** Monotonic generation counter, bumped whenever the shard list changes. Makes split page names unique. */
	gen: number
	/**
	 * Usernote type definitions, making the sharded layout self-contained
	 * (v6 envelopes only carry type keys). Seeded from the subreddit config's
	 * `usernoteColors` on write.
	 */
	types: UserNoteColor[]
	/** Shard ranges, sorted by `start`; `shards[0].start` is always 0. */
	shards: UsernotesShardRef[]
	/**
	 * Pages retired by a split whose best-effort tombstone write failed;
	 * retried on later manifest writes and dropped once tombstoned.
	 */
	retired?: string[]
}

/**
 * Hashes a username to its uint32 shard key with 32-bit FNV-1a over the
 * lowercased name. Lowercased because storage may key one user under both a
 * lowercase and a canonical-cased name (merged by `getUser`) - both casings
 * must land in the same shard. The function is part of the storage format:
 * changing it strands existing users in the wrong shards.
 */
export function hashUsername (name: string,): number {
	const text = name.toLowerCase()
	let hash = 0x811c9dc5
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i,)
		hash = Math.imul(hash, 0x01000193,)
	}
	return hash >>> 0
}

/**
 * Structurally validates a parsed NXG usernotes page as a manifest, including
 * the shard range invariants (sorted, first range starts at 0, no duplicate
 * starts or pages).
 */
export function isUsernotesManifest (value: unknown,): value is UsernotesManifest {
	const manifest = value as UsernotesManifest
	if (
		!manifest || typeof manifest !== 'object'
		|| manifest.format !== USERNOTES_MANIFEST_FORMAT
		|| manifest.ver !== USERNOTES_MANIFEST_VER
		|| typeof manifest.gen !== 'number'
		|| !Array.isArray(manifest.types,)
		|| !Array.isArray(manifest.shards,)
		|| manifest.shards.length === 0
		|| (manifest.retired !== undefined && !Array.isArray(manifest.retired,))
	) {
		return false
	}
	const pages = new Set<string>()
	for (const [i, shard,] of manifest.shards.entries()) {
		if (
			!shard || typeof shard !== 'object'
			|| typeof shard.start !== 'number' || !Number.isInteger(shard.start,)
			|| shard.start < 0 || shard.start > 0xffffffff
			|| typeof shard.page !== 'string' || shard.page === ''
			|| pages.has(shard.page,)
		) {
			return false
		}
		pages.add(shard.page,)
		if (i === 0 ? shard.start !== 0 : shard.start <= manifest.shards[i - 1]!.start) {
			return false
		}
	}
	return true
}

/** Builds the page-name suffix for a shard created at `gen` covering hashes from `start`. */
export function shardPageName (gen: number, start: number,): string {
	return `s${gen}-${start.toString(16,).padStart(8, '0',)}`
}

/** Builds the manifest for a freshly sharded subreddit: one shard covering the whole hash space. */
export function initialManifest (types: UserNoteColor[],): UsernotesManifest {
	return {
		format: USERNOTES_MANIFEST_FORMAT,
		ver: USERNOTES_MANIFEST_VER,
		gen: 1,
		types: types.length ? types : defaultUsernoteTypes.map((t,) => ({...t,})),
		shards: [{start: 0, page: shardPageName(1, 0,),},],
	}
}

/** Returns the index of the manifest shard whose range contains `hash` (binary search on `start`s). */
export function shardIndexForHash (manifest: UsernotesManifest, hash: number,): number {
	let low = 0
	let high = manifest.shards.length - 1
	while (low < high) {
		const mid = (low + high + 1) >> 1
		if (manifest.shards[mid]!.start <= hash) { low = mid }
		else { high = mid - 1 }
	}
	return low
}

/**
 * Partitions a user map into per-shard user maps by username hash. Every
 * shard in the manifest gets an entry, even when empty - an emptied shard is
 * rewritten as a valid empty envelope rather than removed (ranges never
 * merge).
 */
export function partitionUsers (
	users: Record<string, UsernotesUser>,
	manifest: UsernotesManifest,
): Map<string, Record<string, UsernotesUser>> {
	const slices = new Map<string, Record<string, UsernotesUser>>()
	for (const shard of manifest.shards) {
		slices.set(shard.page, {},)
	}
	for (const [key, user,] of Object.entries(users,)) {
		const shard = manifest.shards[shardIndexForHash(manifest, hashUsername(key,),)]!
		slices.get(shard.page,)![key] = user
	}
	return slices
}

/**
 * Picks the hash boundary to split an overflowing shard's range at: the
 * median user's hash, nudged forward past duplicates so the boundary is
 * strictly inside the range and both halves are non-empty.
 * @param users The users currently in the shard.
 * @param rangeStart The shard's inclusive lower hash bound.
 * @returns The new boundary (start of the upper half), or `null` when the
 *   shard cannot split (fewer than two distinct hashes above `rangeStart`).
 */
export function pickSplitBoundary (users: UsernotesUser[], rangeStart: number,): number | null {
	const hashes = users.map((user,) => hashUsername(user.name,)).sort((a, b,) => a - b)
	if (hashes.length < 2) { return null }
	let index = Math.ceil(hashes.length / 2,)
	// The boundary must be > rangeStart (the lower half keeps at least the
	// range start) and must differ from the previous hash (entries equal to
	// the boundary go to the upper half, so a duplicated median would put
	// everything in one half).
	while (index < hashes.length && (hashes[index] === hashes[index - 1] || hashes[index]! <= rangeStart)) {
		index++
	}
	if (index >= hashes.length) {
		// Walk backward instead: split as low as possible.
		index = Math.ceil(hashes.length / 2,) - 1
		while (index > 0 && (hashes[index] === hashes[index - 1] || hashes[index]! <= rangeStart)) {
			index--
		}
		if (index <= 0 || hashes[index]! <= rangeStart) { return null }
	}
	return hashes[index]!
}

/**
 * Merges decoded shard datasets into one in-memory dataset. Users colliding
 * across shards should be impossible (ranges are disjoint); if it happens
 * anyway the last shard wins and the result is flagged `corrupted`.
 * @param shards The decoded per-shard datasets, in manifest order.
 * @param types The manifest's type definitions, attached to the result.
 */
export function mergeShardData (shards: UserNotesData[], types: UserNoteColor[],): UserNotesData {
	const users: Record<string, UsernotesUser> = {}
	let corrupted = false
	for (const shard of shards) {
		if (shard.corrupted) { corrupted = true }
		for (const [key, user,] of Object.entries(shard.users,)) {
			if (users[key] !== undefined) { corrupted = true }
			users[key] = user
		}
	}
	const merged: UserNotesData = {ver: 6, users, types: types.map((t,) => ({...t,})),}
	if (corrupted) { merged.corrupted = true }
	return merged
}
