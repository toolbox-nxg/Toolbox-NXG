/**
 * Wiki I/O for the sharded NXG usernotes layout: reading the manifest plus
 * all shard pages into one merged dataset, and writing a dataset back by
 * re-encoding only the shards whose users changed, splitting any shard that
 * outgrew the soft size limit.
 *
 * Write ordering is the consistency story: dirty shard pages are written
 * first (sequentially - Reddit rate-limits wiki edits) and the manifest last,
 * and split halves always get brand-new page names. A crash mid-save leaves
 * the old manifest pointing at old, untouched pages, so readers never see a
 * half-split state. Pages a split retires can't be deleted (the wiki API has
 * no delete), so they're tombstoned best-effort after the manifest lands.
 *
 * This module deliberately avoids importing `moduleapi.ts` (feedback, cache,
 * config) so `wikiMigration.ts` can use it without circular imports; callers
 * own caching, purification, and user feedback.
 */

import {getWikiPages, postToWiki, readFromWiki,} from '../../../../api/resources/wiki'
import {byteLength,} from '../../../data/encoding'
import createLogger from '../../../infra/logging'
import {NEW_WIKI_PATHS,} from '../../wikiConstants'
import {buildShardPayload, decodeNotesShard, encodeNotesShard, isNxgUsernotesShardPage,} from './codec'
import {NxgUsernotesShardPage, UserNotesData, UsernotesUser,} from './schema'
import {
	hashUsername,
	initialManifest,
	isUsernotesManifest,
	mergeShardData,
	partitionUsers,
	pickSplitBoundary,
	SHARD_HARD_LIMIT_BYTES,
	SHARD_SOFT_LIMIT_BYTES,
	shardPageName,
	UsernotesManifest,
} from './sharding'

const log = createLogger('TBUsernotesSharded',)

/** Content written to retired shard pages (the wiki API cannot delete pages). */
const TOMBSTONE_TEXT = 'TBUN-RETIRED'

/** Full wiki path of a shard page. */
export function shardPagePath (suffix: string,): string {
	return `${NEW_WIKI_PATHS.usernotes}/${suffix}`
}

/**
 * Lists the suffixes of retired usernote shard pages: pages under the NXG
 * usernotes prefix that exist on the wiki but are no longer referenced by the
 * manifest (tombstoned leftovers from shard splits). Used by the config
 * overlay when the "only show active shards" setting is off.
 * @param subreddit The subreddit to list retired shard pages for.
 * @param activeSuffixes The active shard suffixes from the manifest (see
 *   {@link listUsernoteShardPages}), excluded from the result.
 * @returns The retired suffixes, sorted; `[]` when the page listing fails.
 */
export async function listRetiredUsernoteShardPages (
	subreddit: string,
	activeSuffixes: string[],
): Promise<string[]> {
	let pages: string[]
	try {
		pages = await getWikiPages(subreddit,)
	} catch (error) {
		log.warn(`Could not list wiki pages for /r/${subreddit}:`, error,)
		return []
	}
	const prefix = `${NEW_WIKI_PATHS.usernotes}/`
	const active = new Set(activeSuffixes,)
	return pages
		.filter((page,) => page.startsWith(prefix,))
		.map((page,) => page.slice(prefix.length,))
		// Suffixes never contain slashes; deeper nested pages are not shards.
		.filter((suffix,) => suffix !== '' && !suffix.includes('/',) && !active.has(suffix,))
		.sort()
}

/**
 * Lists the shard page suffixes currently referenced by a subreddit's
 * usernotes manifest, for UIs that expose the raw shard pages (the config
 * overlay's advanced editor tabs). Prefers the session state from the last
 * sharded read/write; otherwise reads the manifest page. Returns `[]` when
 * the subreddit has no manifest (no NXG usernotes page, a legacy-fallback
 * layout, or unrecognized page content).
 * @param subreddit The subreddit to list shard pages for.
 */
export async function listUsernoteShardPages (subreddit: string,): Promise<string[]> {
	const session = sessionStates.get(subreddit,)
	if (session) {
		return session.manifest.shards.map((ref,) => ref.page)
	}
	const response = await readFromWiki(subreddit, NEW_WIKI_PATHS.usernotes, false,)
	if (!response.ok) { return [] }
	try {
		return parseManifestPage(response.data,).shards.map((ref,) => ref.page)
	} catch {
		return []
	}
}

/** The result of reading the NXG usernotes page family. */
export type ShardedReadResult =
	/** The NXG usernotes page does not exist. */
	| {kind: 'no_page'}
	/** The sharded layout, merged into one dataset. */
	| {kind: 'sharded'; notes: UserNotesData; manifest: UsernotesManifest}

/** UI-facing storage statistics for a subreddit's sharded usernotes. */
export interface ShardedStorageInfo {
	/** Total bytes across all shard pages. */
	totalBytes: number
	shardCount: number
	/** Bytes of the largest shard page, to show headroom against the split limit. */
	largestShardBytes: number
}

/**
 * Session-scoped per-subreddit state from the last successful sharded read or
 * write: the manifest, per-shard content fingerprints for dirty detection,
 * and per-shard page sizes for the manager UI. Only ever a hint - a save
 * without it falls back to re-reading (or rewriting) every shard, never to
 * data loss.
 */
interface SessionShardState {
	manifest: UsernotesManifest
	/** Content fingerprint by shard page suffix. */
	fingerprints: Record<string, string>
	/** Page size in bytes by shard page suffix. */
	pageBytes: Record<string, number>
}

const sessionStates = new Map<string, SessionShardState>()

/**
 * Clears the session shard state for a subreddit (or all subreddits). Called
 * after migrations and compat toggles, which rewrite shard pages outside the
 * save path.
 */
export function clearSessionShardState (subreddit?: string,): void {
	if (subreddit === undefined) {
		sessionStates.clear()
	} else {
		sessionStates.delete(subreddit,)
	}
}

/**
 * Returns storage statistics from the last sharded read or write this
 * session, or `undefined` when none happened.
 */
export function getSessionStorageInfo (subreddit: string,): ShardedStorageInfo | undefined {
	const state = sessionStates.get(subreddit,)
	if (!state) { return undefined }
	const sizes = Object.values(state.pageBytes,)
	return {
		totalBytes: sizes.reduce((total, bytes,) => total + bytes, 0,),
		shardCount: state.manifest.shards.length,
		largestShardBytes: Math.max(0, ...sizes,),
	}
}

/** Computes a shard slice's content fingerprint: the deterministic pre-compression shard payload. */
function fingerprintSlice (users: Record<string, UsernotesUser>,): string {
	return JSON.stringify(buildShardPayload(users,),)
}

/** Byte length of a shard envelope exactly as {@link postToWiki} will post it. */
function envelopeBytes (envelope: NxgUsernotesShardPage,): number {
	return byteLength(JSON.stringify(envelope,),)
}

/**
 * Parses raw NXG usernotes page text into a shard manifest.
 * @throws For unparseable or unrecognized content.
 */
function parseManifestPage (text: string,): UsernotesManifest {
	let parsed: unknown
	try {
		parsed = JSON.parse(text,)
	} catch {
		throw new Error('the NXG usernotes page is not valid JSON',)
	}
	if (!isUsernotesManifest(parsed,)) {
		throw new Error('the NXG usernotes page is not a shard manifest',)
	}
	return parsed
}

/**
 * Reads and decodes one shard page.
 * @throws When the page is missing, unreadable, or unrecognized - a partial
 *   dataset must never be returned (bulk operations like pruning and the 6.x
 *   compat copy act on "all users").
 */
async function readShard (
	subreddit: string,
	suffix: string,
): Promise<{notes: UserNotesData; bytes: number}> {
	const response = await readFromWiki(subreddit, shardPagePath(suffix,), false,)
	if (!response.ok) {
		throw new Error(
			`usernotes shard ${shardPagePath(suffix,)} is missing or unreadable (${response.reason}) - `
				+ 'run the migration repair in the Toolbox wiki layout settings',
		)
	}
	let raw: unknown
	try {
		raw = JSON.parse(response.data,)
	} catch {
		throw new Error(`usernotes shard ${shardPagePath(suffix,)} is not valid JSON`,)
	}
	const bytes = byteLength(response.data,)

	if (isNxgUsernotesShardPage(raw,)) {
		const {users, corrupted,} = await decodeNotesShard(raw, `${subreddit}#${suffix}`,)
		const notes: UserNotesData = {ver: 6, users,}
		if (corrupted) { notes.corrupted = true }
		return {notes, bytes,}
	}
	throw new Error(`usernotes shard ${shardPagePath(suffix,)} has an unrecognized schema`,)
}

/**
 * Reads the NXG usernotes page family for a subreddit: the manifest, then all
 * shard pages in parallel, merged into one dataset. Records session state for
 * dirty-shard detection and the manager UI.
 * @throws When the manifest is corrupt or any shard is missing/unreadable.
 */
export async function readShardedUsernotes (subreddit: string,): Promise<ShardedReadResult> {
	const response = await readFromWiki(subreddit, NEW_WIKI_PATHS.usernotes, false,)
	if (!response.ok) {
		if (response.reason === 'no_page') { return {kind: 'no_page',} }
		throw new Error(response.reason,)
	}

	const manifest = parseManifestPage(response.data,)
	const shards = await Promise.all(manifest.shards.map((ref,) => readShard(subreddit, ref.page,)),)

	const fingerprints: Record<string, string> = {}
	const pageBytes: Record<string, number> = {}
	manifest.shards.forEach((ref, i,) => {
		fingerprints[ref.page] = fingerprintSlice(shards[i]!.notes.users,)
		pageBytes[ref.page] = shards[i]!.bytes
	},)
	sessionStates.set(subreddit, {manifest, fingerprints, pageBytes,},)

	const notes = mergeShardData(shards.map((shard,) => shard.notes), manifest.types,)
	return {kind: 'sharded', notes, manifest,}
}

/** A shard about to be written (or skipped as clean) during a save. */
interface PlannedShard {
	suffix: string
	users: Record<string, UsernotesUser>
	fingerprint: string
	dirty: boolean
	/** Whether the page already exists on the wiki (pre-existing pages get tombstoned when retired). */
	preExisting: boolean
}

/**
 * Resolves the manifest and per-shard fingerprints to base a save on: the
 * session state when present, otherwise re-read from the wiki. A missing or
 * corrupt page yields a fresh single-shard manifest with every shard treated
 * as dirty; so does a manifest whose shard pages can't be re-read (they're
 * about to be overwritten anyway - this is the repair path for externally
 * deleted shard pages).
 */
async function resolveWriteBase (
	subreddit: string,
	types: UserNotesData['types'],
): Promise<{manifest: UsernotesManifest; fingerprints: Record<string, string>; manifestOnWiki: boolean}> {
	const session = sessionStates.get(subreddit,)
	if (session) {
		return {
			manifest: structuredClone(session.manifest,),
			fingerprints: {...session.fingerprints,},
			manifestOnWiki: true,
		}
	}

	const response = await readFromWiki(subreddit, NEW_WIKI_PATHS.usernotes, false,)
	if (response.ok) {
		let manifest: UsernotesManifest | undefined
		try {
			manifest = parseManifestPage(response.data,)
		} catch (error) {
			log.warn(`Replacing unusable NXG usernotes page for /r/${subreddit}:`, error,)
		}
		if (manifest) {
			// Rebuild fingerprints from the live shards so clean shards can be
			// skipped. Unreadable shards just mean a full rewrite.
			const fingerprints: Record<string, string> = {}
			try {
				const shards = await Promise.all(manifest.shards.map((ref,) => readShard(subreddit, ref.page,)),)
				manifest.shards.forEach((ref, i,) => {
					fingerprints[ref.page] = fingerprintSlice(shards[i]!.notes.users,)
				},)
			} catch (error) {
				log.warn(`Rewriting all usernotes shards for /r/${subreddit}:`, error,)
			}
			return {manifest, fingerprints, manifestOnWiki: true,}
		}
	}
	return {manifest: initialManifest(types ?? [],), fingerprints: {}, manifestOnWiki: false,}
}

/**
 * Writes a complete usernotes dataset to the sharded NXG layout. Only shards
 * whose users changed are re-encoded and written; a shard whose envelope
 * would exceed the soft size limit splits at the median user hash (its halves
 * getting new page names) until everything fits. Shard pages are written
 * sequentially, the manifest last and only when it changed.
 * @param subreddit The subreddit to write.
 * @param notes The full dataset; `notes.types` should already be seeded.
 * @param reason Wiki revision note for all page writes.
 * @returns The full paths of every page written, in write order.
 * @throws On write failures, and when a single user's notes exceed the hard
 *   per-page limit (a one-user shard cannot split).
 */
export async function writeShardedUsernotes (
	subreddit: string,
	notes: UserNotesData,
	reason: string,
): Promise<{written: string[]}> {
	const {manifest, fingerprints, manifestOnWiki,} = await resolveWriteBase(subreddit, notes.types,)
	const baselineShards = JSON.stringify(manifest.shards,)
	const baselineTypes = JSON.stringify(manifest.types,)
	const baselineRetired = JSON.stringify(manifest.retired ?? [],)
	const preExistingPages = new Set(manifestOnWiki ? manifest.shards.map((ref,) => ref.page) : [],)

	// The manifest carries the type definitions; refresh them from the seeded
	// dataset so type edits propagate.
	if (notes.types?.length) {
		manifest.types = notes.types
	}

	// Partition the dataset and plan the writes: a shard is dirty when its
	// fingerprint changed (or was never known).
	const slices = partitionUsers(notes.users, manifest,)
	let planned: PlannedShard[] = manifest.shards.map((ref,) => {
		const users = slices.get(ref.page,)!
		const fingerprint = fingerprintSlice(users,)
		return {
			suffix: ref.page,
			users,
			fingerprint,
			dirty: fingerprints[ref.page] !== fingerprint,
			preExisting: preExistingPages.has(ref.page,),
		}
	},)

	// Split any dirty shard that outgrew the soft limit. Each split bumps the
	// generation so every new page name is unique - including a half that
	// immediately re-splits.
	const newlyRetired: string[] = []
	const encoded = new Map<string, NxgUsernotesShardPage>()
	const encodedBytes = new Map<string, number>()
	for (let i = 0; i < planned.length; i++) {
		const shard = planned[i]!
		if (!shard.dirty) { continue }
		const envelope = encodeNotesShard(shard.users,)
		const bytes = envelopeBytes(envelope,)
		if (bytes <= SHARD_SOFT_LIMIT_BYTES) {
			encoded.set(shard.suffix, envelope,)
			encodedBytes.set(shard.suffix, bytes,)
			continue
		}

		const shardIndex = manifest.shards.findIndex((ref,) => ref.page === shard.suffix)
		const rangeStart = manifest.shards[shardIndex]!.start
		const boundary = pickSplitBoundary(Object.values(shard.users,), rangeStart,)
		if (boundary === null) {
			// A single hash bucket can't split; allow it up to the hard limit.
			if (bytes <= SHARD_HARD_LIMIT_BYTES) {
				encoded.set(shard.suffix, envelope,)
				encodedBytes.set(shard.suffix, bytes,)
				continue
			}
			const largestUser = Object.values(shard.users,)
				.reduce((a, b,) => JSON.stringify(a,).length >= JSON.stringify(b,).length ? a : b)
			throw new Error(`notes for u/${largestUser.name} are too large to store on a wiki page`,)
		}

		manifest.gen += 1
		const lower: PlannedShard = {
			suffix: shardPageName(manifest.gen, rangeStart,),
			users: {},
			fingerprint: '',
			dirty: true,
			preExisting: false,
		}
		const upper: PlannedShard = {
			suffix: shardPageName(manifest.gen, boundary,),
			users: {},
			fingerprint: '',
			dirty: true,
			preExisting: false,
		}
		for (const [key, user,] of Object.entries(shard.users,)) {
			// Hash on the storage key, matching partitionUsers.
			const target = hashUsername(key,) >= boundary ? upper : lower
			target.users[key] = user
		}
		lower.fingerprint = fingerprintSlice(lower.users,)
		upper.fingerprint = fingerprintSlice(upper.users,)

		manifest.shards.splice(shardIndex, 1, {start: rangeStart, page: lower.suffix,}, {
			start: boundary,
			page: upper.suffix,
		},)
		if (shard.preExisting) { newlyRetired.push(shard.suffix,) }
		// Replace the oversized entry with the halves and re-process them (a
		// half may itself still exceed the limit).
		planned.splice(i, 1, lower, upper,)
		i -= 1
	}

	// Carry over still-untombstoned pages from earlier saves.
	const retired = [...new Set([...manifest.retired ?? [], ...newlyRetired,],),]
	if (retired.length > 0) { manifest.retired = retired }
	else { delete manifest.retired }

	const manifestChanged = !manifestOnWiki
		|| JSON.stringify(manifest.shards,) !== baselineShards
		|| JSON.stringify(manifest.types,) !== baselineTypes
		|| JSON.stringify(manifest.retired ?? [],) !== baselineRetired

	// Writes, sequentially: dirty shards first, manifest last. A failure
	// anywhere aborts with the old manifest still authoritative.
	const written: string[] = []
	for (const shard of planned) {
		if (!shard.dirty) { continue }
		const envelope = encoded.get(shard.suffix,) ?? encodeNotesShard(shard.users,)
		await postToWiki(subreddit, shardPagePath(shard.suffix,), envelope, reason, true, false,)
		if (!encodedBytes.has(shard.suffix,)) {
			encodedBytes.set(shard.suffix, envelopeBytes(envelope,),)
		}
		written.push(shardPagePath(shard.suffix,),)
	}
	if (manifestChanged) {
		await postToWiki(subreddit, NEW_WIKI_PATHS.usernotes, manifest, reason, true, false,)
		written.push(NEW_WIKI_PATHS.usernotes,)
	}

	// Best-effort tombstones for pages no manifest references anymore. A
	// failure is carried in `manifest.retired` and retried on a later save.
	const stillRetired: string[] = []
	for (const suffix of retired) {
		try {
			await postToWiki(subreddit, shardPagePath(suffix,), TOMBSTONE_TEXT, reason, false, false,)
		} catch (error) {
			log.warn(`Failed to tombstone retired usernotes shard ${shardPagePath(suffix,)}:`, error,)
			stillRetired.push(suffix,)
		}
	}
	if (stillRetired.length > 0) { manifest.retired = stillRetired }
	else { delete manifest.retired }

	// Record the new session state for the next save's dirty detection. Page
	// sizes for clean shards carry over from the previous state when known.
	const previous = sessionStates.get(subreddit,)
	const fingerprintsAfter: Record<string, string> = {}
	const pageBytes: Record<string, number> = {}
	for (const shard of planned) {
		fingerprintsAfter[shard.suffix] = shard.fingerprint
		const bytes = encodedBytes.get(shard.suffix,) ?? previous?.pageBytes[shard.suffix]
		if (bytes !== undefined) { pageBytes[shard.suffix] = bytes }
	}
	sessionStates.set(subreddit, {manifest, fingerprints: fingerprintsAfter, pageBytes,},)

	return {written,}
}
