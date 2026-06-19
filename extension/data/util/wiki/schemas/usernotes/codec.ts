/**
 * Wire-format codecs for the usernotes wiki pages. This module is the only
 * code that knows about on-page byte layouts:
 *
 * - **nxg-usernotes** - the NXG shard format: a small JSON envelope around a
 *   zlib/base64 blob whose payload is human-readable (named keys, inline mod
 *   names, epoch-second times, full permalinks, per-user stable note indexes,
 *   archive attributions).
 * - **Schema v6** - the legacy single-page format (deflated one-letter keys,
 *   string pools). Survives solely for the legacy `usernotes` page, which 6.x
 *   parses directly; it carries *active* notes only.
 *
 * Everything else works with the inflated {@link UserNotesData} app shape.
 * Blob decompression runs in the background service worker so large pages
 * don't block the content script's main thread.
 */

import browser from 'webextension-polyfill'

import type {TbUsernoteDecompressMessage, TbUsernoteDecompressResponse,} from '../../../../background/messages'
import {htmlDecode, zlibDeflate,} from '../../../data/encoding'
import {coerceEpochSeconds,} from '../../../data/time'
import {
	ConstantPools,
	DecompressedBlob,
	defaultUsernoteTypes,
	DeflatedNote,
	DeflatedUser,
	isNoteActive,
	NoteAttribution,
	NXG_USERNOTES_FORMAT,
	NXG_USERNOTES_VER,
	NxgShardNote,
	NxgShardPayload,
	NxgUsernotesShardPage,
	RawUsernotesBlob,
	UserNoteColor,
	UserNoteEntry,
	UserNotesData,
	UsernotesUser,
} from './schema'

// --- Shared link squashing -------------------------------------------------

/**
 * Squashes a full reddit permalink into the compact stored form:
 * `l,<postId>[,<commentId>]` for comments/submissions, `m,<id>` for modmail,
 * or `''` when the link isn't recognized.
 */
export function squashPermalink (permalink: string,): string {
	if (!permalink) { return '' }
	const commentsLinkRe = /\/comments\/(\w+)\/(?:[^/]+\/(?:(\w+))?)?/
	const modmailLinkRe = /\/messages\/(\w+)/
	const linkMatches = permalink.match(commentsLinkRe,)
	const modMailMatches = permalink.match(modmailLinkRe,)
	if (linkMatches) {
		let squashed = `l,${linkMatches[1]}`
		if (linkMatches[2] !== undefined) { squashed += `,${linkMatches[2]}` }
		return squashed
	} else if (modMailMatches) {
		return `m,${modMailMatches[1]}`
	} else {
		return ''
	}
}

/**
 * Expands a squashed link back into a subreddit-relative permalink, or `''`
 * when the squashed form is empty or unrecognized.
 */
export function unsquashPermalink (subreddit: string, permalink: string,): string {
	if (!permalink) { return '' }
	const linkParams = permalink.split(/,/g,)
	let link = `/r/${subreddit}/`
	if (linkParams[0] === 'l') {
		link += `comments/${linkParams[1]}/`
		if (linkParams.length > 2) { link += `-/${linkParams[2]}/` }
	} else if (linkParams[0] === 'm') {
		link += `message/messages/${linkParams[1]}`
	} else {
		return ''
	}
	return link
}

/** Manages the v6 constant pools, interning strings to indexes and back. */
function constManager (initPools: ConstantPools,) {
	return {
		_pools: initPools,
		create (poolName: keyof ConstantPools, constant: string,): number {
			const pool = this._pools[poolName]
			const id = pool.indexOf(constant,)
			if (id !== -1) { return id }
			pool.push(constant,)
			return pool.length - 1
		},
		get (poolName: keyof ConstantPools, id: number,): string {
			return this._pools[poolName][id] ?? ''
		},
	}
}

// --- Note identity ---------------------------------------------------------

/**
 * The identity key of a note for deduplication and legacy-page
 * reconciliation: `(username, time, note text, mod)`. Timestamps are epoch
 * seconds both in memory and on every wire format, so a note compares equal to
 * itself across a legacy round-trip without any normalization.
 */
export function noteIdentityKey (user: string, note: UserNoteEntry,): string {
	return JSON.stringify([user, note.time, note.note, note.mod,],)
}

// --- Schema v6 -------------------------------------------------------------

/** The deterministic pre-compression form of a v6 page: pooled constants plus deflated users. */
export interface UsernotesV6Payload {
	constants: ConstantPools
	users: Record<string, DeflatedUser>
}

/**
 * Builds the deflated v6 payload from inflated usernotes. Pure, synchronous,
 * and deterministic - users are sorted by name, so the same logical data
 * always produces the same payload regardless of object key order.
 *
 * Only **active** (non-archived) notes survive: archiving is an NXG concept
 * the v6 format can't carry, and archived notes' absence from the legacy
 * page is what lets reconciliation treat any deviation of that page as a
 * 6.x edit. Note indexes are likewise dropped (v6 is position-addressed).
 * Users left with no active notes are omitted entirely.
 * @param data The inflated usernotes to deflate.
 */
export function buildUsernotesV6Payload (data: UserNotesData,): UsernotesV6Payload {
	const constants: ConstantPools = {users: [], warnings: [],}
	const mgr = constManager(constants,)
	const deflatedUsers: Record<string, DeflatedUser> = {}
	const names = Object.keys(data.users,).sort()
	for (const name of names) {
		const activeNotes = data.users[name]!.notes
			.filter((n,): n is UserNoteEntry => n !== undefined && isNoteActive(n,))
		if (activeNotes.length === 0) { continue }
		deflatedUsers[name] = {
			ns: activeNotes.map((note,): DeflatedNote => ({
				n: note.note,
				t: note.time,
				m: mgr.create('users', note.mod,),
				l: squashPermalink(note.link ?? '',),
				w: mgr.create('warnings', note.type ?? '',),
			})),
		}
	}
	return {constants, users: deflatedUsers,}
}

/**
 * Encodes inflated usernotes into the v6 on-page shape: constants pooled,
 * users deflated, blob zlib-compressed and base64-encoded.
 * @param data The inflated usernotes to encode.
 */
export function encodeUsernotesV6 (data: UserNotesData,): RawUsernotesBlob {
	const payload = buildUsernotesV6Payload(data,)
	return {
		ver: 6,
		constants: payload.constants,
		blob: zlibDeflate(JSON.stringify(payload.users,),),
	}
}

/**
 * Decodes a parsed v6 wiki page into the inflated app shape. The zlib blob is
 * decompressed in the background service worker.
 * @param raw The parsed v6 page JSON.
 * @param subreddit The owning subreddit, used to expand squashed links.
 * @param cacheKey Key for the background decompression cache. Defaults to the
 *   subreddit; sharded reads pass a per-shard key so parallel shard decodes
 *   don't evict each other.
 * @returns The inflated data, or `null` when the schema version is not v6.
 */
export async function decodeUsernotesV6 (
	raw: RawUsernotesBlob,
	subreddit: string,
	cacheKey = subreddit,
): Promise<UserNotesData | null> {
	if (raw.ver !== 6) { return null }

	const response: TbUsernoteDecompressResponse = await browser.runtime.sendMessage(
		{
			action: 'toolbox-usernote-decompress',
			cacheKey,
			blob: raw.blob,
		} satisfies TbUsernoteDecompressMessage,
	)
	if ('error' in response) { throw new Error(response.error,) }
	const deflated: DecompressedBlob = {
		ver: 6,
		constants: raw.constants,
		users: response.users as Record<string, DeflatedUser>,
	}

	const mgr = constManager(deflated.constants,)
	const users: Record<string, UsernotesUser> = {}
	for (const [name, user,] of Object.entries(deflated.users,)) {
		// v6 has no stable note indexes; assign ephemeral position-based ones
		// so the UI can address notes uniformly. They become durable on the
		// first NXG write.
		users[name] = {
			name,
			notes: user.ns.map((note, position,): UserNoteEntry => ({
				index: position,
				note: htmlDecode(note.n,),
				// Heal timestamps mistakenly written in milliseconds back to seconds.
				time: coerceEpochSeconds(note.t,),
				mod: mgr.get('users', note.m,),
				link: unsquashPermalink(subreddit, note.l,),
				type: mgr.get('warnings', note.w,),
			})),
			nextIndex: user.ns.length,
		}
	}
	return {ver: 6, users,}
}

/**
 * Seeds usernote type definitions for v6 data: the subreddit's configured
 * `usernoteColors` when present, otherwise the built-in defaults, plus an
 * entry for any note type key not covered by either. Used to populate the
 * self-contained `types` carried by the NXG usernotes manifest.
 * @param data The inflated v6 data to scan for unknown type keys.
 * @param configColors The subreddit's `usernoteColors` config, if any.
 */
export function seedV6Types (data: UserNotesData, configColors?: UserNoteColor[],): UserNoteColor[] {
	const types: UserNoteColor[] = (configColors?.length ? configColors : defaultUsernoteTypes)
		.map((t,) => ({...t,}))
	const known = new Set(types.map((t,) => t.key),)
	for (const user of Object.values(data.users,)) {
		for (const note of user.notes) {
			if (note.type && !known.has(note.type,)) {
				known.add(note.type,)
				types.push({key: note.type, text: note.type, color: '',},)
			}
		}
	}
	return types
}

// --- nxg-usernotes shard format --------------------------------------------

/** Returns `true` when a parsed page object is an NXG usernotes shard envelope. */
export function isNxgUsernotesShardPage (value: unknown,): value is NxgUsernotesShardPage {
	const page = value as NxgUsernotesShardPage
	return !!page && typeof page === 'object'
		&& page.format === NXG_USERNOTES_FORMAT
		&& page.ver === NXG_USERNOTES_VER
		&& typeof page.blob === 'string'
}

/** Returns a sanitized copy of an attribution object, or `undefined` when malformed. */
function sanitizeAttribution (value: unknown,): NoteAttribution | undefined {
	const attribution = value as NoteAttribution
	if (!attribution || typeof attribution !== 'object') { return undefined }
	if (typeof attribution.by !== 'string' || typeof attribution.at !== 'number') { return undefined }
	// Heal an `at` mistakenly stored in milliseconds back to seconds, matching the note `time` guard.
	return {by: attribution.by, at: coerceEpochSeconds(attribution.at,),}
}

/**
 * Builds the human-readable NXG shard payload from a slice of users. Pure,
 * synchronous, and deterministic - users sorted by name, fixed note key
 * order - so the serialized payload doubles as the dirty-shard fingerprint.
 *
 * Notes missing an `index` (data straight from a legacy decode, or older
 * in-memory state) are assigned one here in array order, starting from the
 * user's `nextIndex` (or past the highest existing index); assignment is
 * order-stable, so repeated builds of the same data agree.
 * @param users The user slice to serialize.
 */
export function buildShardPayload (users: Record<string, UsernotesUser>,): NxgShardPayload {
	const payload: NxgShardPayload = {}
	for (const name of Object.keys(users,).sort()) {
		const user = users[name]!
		const notes = user.notes.filter((n,): n is UserNoteEntry => n !== undefined)

		let nextIndex = user.nextIndex ?? 0
		for (const note of notes) {
			if (note.index !== undefined && note.index >= nextIndex) { nextIndex = note.index + 1 }
		}

		const serialized: NxgShardNote[] = notes.map((note,) => {
			const index = note.index ?? nextIndex++
			const out: NxgShardNote = {index, note: note.note, time: note.time, mod: note.mod,}
			if (note.type) { out.type = note.type }
			if (note.link) { out.link = note.link }
			if (note.messageLink) { out.messageLink = note.messageLink }
			if (note.archived) { out.archived = {by: note.archived.by, at: note.archived.at,} }
			return out
		},)

		payload[name] = {nextIndex, notes: serialized,}
	}
	return payload
}

/**
 * Encodes a slice of users as a complete NXG shard page: payload JSON ->
 * zlib -> base64, wrapped in the `nxg-usernotes` envelope.
 * @param users The user slice to encode.
 */
export function encodeNotesShard (users: Record<string, UsernotesUser>,): NxgUsernotesShardPage {
	return {
		format: NXG_USERNOTES_FORMAT,
		ver: NXG_USERNOTES_VER,
		blob: zlibDeflate(JSON.stringify(buildShardPayload(users,),),),
	}
}

/**
 * Decodes an NXG shard page into the inflated user map. The blob is
 * decompressed in the background service worker.
 *
 * Tolerant of damage: malformed note entries are dropped (flagged via
 * `corrupted`), malformed `archived` objects are ignored (note treated as
 * active), and missing or duplicate indexes are repaired by reassigning from
 * the user's `nextIndex` (also flagged).
 * @param page The parsed shard page envelope.
 * @param cacheKey Key for the background decompression cache; sharded reads
 *   pass a per-shard key so parallel decodes don't evict each other.
 */
export async function decodeNotesShard (
	page: NxgUsernotesShardPage,
	cacheKey: string,
): Promise<{users: Record<string, UsernotesUser>; corrupted: boolean}> {
	const response: TbUsernoteDecompressResponse = await browser.runtime.sendMessage(
		{
			action: 'toolbox-usernote-decompress',
			cacheKey,
			blob: page.blob,
		} satisfies TbUsernoteDecompressMessage,
	)
	if ('error' in response) { throw new Error(response.error,) }

	const users: Record<string, UsernotesUser> = {}
	let corrupted = false
	for (const [name, record,] of Object.entries(response.users as NxgShardPayload,)) {
		if (!record || typeof record !== 'object' || !Array.isArray(record.notes,)) {
			corrupted = true
			continue
		}
		let nextIndex = typeof record.nextIndex === 'number' && Number.isInteger(record.nextIndex,)
			? record.nextIndex
			: 0
		const notes: UserNoteEntry[] = []
		const seenIndexes = new Set<number>()
		for (const raw of record.notes) {
			if (
				!raw || typeof raw !== 'object'
				|| typeof raw.note !== 'string' || typeof raw.time !== 'number' || typeof raw.mod !== 'string'
			) {
				corrupted = true
				continue
			}
			const note: UserNoteEntry = {
				index: raw.index,
				note: raw.note,
				// Heal timestamps mistakenly written in milliseconds back to seconds.
				time: coerceEpochSeconds(raw.time,),
				mod: raw.mod,
				type: typeof raw.type === 'string' ? raw.type : '',
				link: typeof raw.link === 'string' ? raw.link : '',
				// Omitted (not empty) when absent, matching the encode side.
				...(typeof raw.messageLink === 'string' && raw.messageLink !== ''
					? {messageLink: raw.messageLink,}
					: {}),
			}
			const archived = sanitizeAttribution(raw.archived,)
			if (archived) { note.archived = archived }

			// Repair missing or duplicate indexes by reassigning.
			if (
				typeof note.index !== 'number' || !Number.isInteger(note.index,) || note.index < 0
				|| seenIndexes.has(note.index,)
			) {
				corrupted = true
				note.index = Math.max(nextIndex, 0,)
			}
			seenIndexes.add(note.index,)
			if (note.index >= nextIndex) { nextIndex = note.index + 1 }
			notes.push(note,)
		}
		users[name] = {name, notes, nextIndex,}
	}
	return {users, corrupted,}
}
