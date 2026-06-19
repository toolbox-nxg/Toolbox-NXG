/** API layer for loading, saving, and querying usernotes from the subreddit wiki. */

import {getRecentModNotes,} from '../../../api/resources/modnotes'
import {postToWiki, readFromWiki,} from '../../../api/resources/wiki'
import {utils,} from '../../../framework/moduleIds'
import {negativeTextFeedback, neutralTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import {purifyObject,} from '../../../util/data/purify'
import {nowInSeconds,} from '../../../util/data/time'
import {createPerKeyQueue,} from '../../../util/infra/perKeyQueue'
import {getCache, setCache,} from '../../../util/persistence/cache'
import {
	decodeUsernotesV6,
	encodeUsernotesV6,
	noteIdentityKey,
	seedV6Types,
} from '../../../util/wiki/schemas/usernotes/codec'
import {
	applyLegacyDiff,
	computeLegacyDiff,
	readLegacyUsersForDiff,
	reconcileFromLegacy,
} from '../../../util/wiki/schemas/usernotes/reconcile'
import {
	AUTO_ARCHIVER,
	defaultUsernoteTypes,
	isNoteActive,
	notesSchema,
	RawUsernotesBlob,
	UserNoteColor,
	UserNoteEntry,
	UserNotesData,
	UsernotesUser,
} from '../../../util/wiki/schemas/usernotes/schema'
import {readShardedUsernotes, writeShardedUsernotes,} from '../../../util/wiki/schemas/usernotes/sharded'
import {OLD_WIKI_PATHS,} from '../../../util/wiki/wikiConstants'
import {compatMirrorEnabled, resolveWikiLayout,} from '../../../util/wiki/wikiPaths'
import {ModNote, PendingNoteRequest,} from '../modnotes/schema'
import {type FoundUser, resolveDualKeyUser,} from './noteMutations'

/** Updates the in-extension note cache for a subreddit after a load or save. */
export async function updateNoteCache (subreddit: string, notes: UserNotesData,): Promise<void> {
	const cachedNotes = await getCache(utils, 'noteCache', {},) as Record<string, UserNotesData>
	cachedNotes[subreddit] = notes
	await setCache(utils, 'noteCache', cachedNotes,)
}

/**
 * Looks up a user in the notes map, merging notes from both a lowercase and
 * the canonical-cased key when both exist. Delegates to {@link resolveDualKeyUser}
 * (the same routine the mutation path uses) with the read-path policy, so indexes
 * shown in the UI stay addressable by a subsequent mutation.
 * @returns The merged user object with notes sorted newest-first, or undefined if no notes exist.
 */
export function getUser (users: Record<string, UsernotesUser>, name: string,): FoundUser | undefined {
	// Read path: drop note-less users and sort newest-first for display.
	return resolveDualKeyUser(users, name, {keepEmptyNotes: false, sort: true,},)
}

/** Returns only the active (non-archived) notes from a list. */
export function activeNotes (notes: UserNoteEntry[],): UserNoteEntry[] {
	return notes.filter(isNoteActive,)
}

/** Milliseconds in one day. */
const MS_PER_DAY = 86_400_000

/**
 * Archives active notes that have outlived their type's configured
 * auto-archive window (`autoArchiveDays`; 0 archives every note of the type
 * on each save). Archived notes are attributed to the {@link AUTO_ARCHIVER}
 * sentinel. Notes whose type has no window configured, or with an empty or
 * unknown type key, are left untouched. Mutates `data` in place.
 * @returns The number of notes archived.
 */
export function autoArchiveOldNotes (data: UserNotesData, types: UserNoteColor[],): number {
	const windows = new Map<string, number>()
	for (const type of types) {
		if (type.autoArchiveDays !== undefined && type.autoArchiveDays >= 0) {
			windows.set(type.key, type.autoArchiveDays * MS_PER_DAY,)
		}
	}
	if (windows.size === 0) { return 0 }

	const now = Date.now()
	const nowSec = nowInSeconds()
	let archivedCount = 0
	for (const user of Object.values(data.users,)) {
		for (const note of user.notes) {
			if (!isNoteActive(note,) || !note.type) { continue }
			const window = windows.get(note.type,)
			// `note.time` is epoch seconds; the windows are ms, so scale the note
			// time up to compare. `>=` so a zero-day window catches notes created
			// within the same second.
			if (window !== undefined && now - note.time * 1000 >= window) {
				note.archived = {by: AUTO_ARCHIVER, at: nowSec,}
				archivedCount++
			}
		}
	}
	return archivedCount
}

/**
 * Loads and inflates usernotes for a subreddit, using an in-extension cache to avoid redundant wiki reads.
 * @param subreddit The subreddit to load usernotes for.
 * @param forceSkipCache When true, bypasses the cache and re-fetches from the wiki.
 * @throws If the wiki page does not exist, the schema is unrecognized, or network/API errors occur.
 */
export async function getUserNotes (subreddit: string, forceSkipCache?: boolean,): Promise<UserNotesData> {
	if (!subreddit) { throw new Error('No subreddit provided',) }

	const cachedNotes = await getCache(utils, 'noteCache', {},) as Record<string, UserNotesData>
	const cachedSubsWithNoNotes = await getCache(utils, 'noNotes', [],) as string[]
	if (!forceSkipCache) {
		if (cachedNotes[subreddit] !== undefined) { return cachedNotes[subreddit] }
		if (cachedSubsWithNoNotes.includes(subreddit,)) { throw new Error('found in noNotes cache',) }
	}

	const layout = await resolveWikiLayout(subreddit,)
	// Non-moderated subs short-circuit to a read-free `notModerated` layout: there are no
	// usernotes to read. Throw the same `no_page` callers already expect for a sub with no
	// notes page (getSubredditColors catches this and returns the default colors).
	if (layout.notModerated) {
		throw new Error('no_page',)
	}
	const notes = layout.state === 'legacyFallback'
		? await readLegacyUsernotes(subreddit,)
		: await readNxgUsernotes(subreddit, compatMirrorEnabled(layout,),)
	if (notes === null) {
		cachedSubsWithNoNotes.push(subreddit,)
		await setCache(utils, 'noNotes', cachedSubsWithNoNotes,)
		throw new Error('no_page',)
	}

	await updateNoteCache(subreddit, notes,)
	if (cachedSubsWithNoNotes.includes(subreddit,)) {
		await setCache(utils, 'noNotes', cachedSubsWithNoNotes.filter((cached,) => cached !== subreddit),)
	}
	return notes
}

/**
 * Reads and decodes the legacy single-page v6 usernotes.
 * @returns The inflated data, or `null` when the page does not exist.
 */
async function readLegacyUsernotes (subreddit: string,): Promise<UserNotesData | null> {
	const response = await readFromWiki(subreddit, OLD_WIKI_PATHS.usernotes, false,)
	if (!response.ok) {
		if (response.reason === 'no_page') { return null }
		throw new Error(response.reason,)
	}

	let raw: RawUsernotesBlob
	try {
		raw = JSON.parse(response.data,) as RawUsernotesBlob
	} catch {
		throw new Error('invalid_json',)
	}
	purifyObject(raw,)
	const notes = await decodeUsernotesV6(raw, subreddit,)
	if (!notes) { throw new Error('usernotes schema too old to be understood',) }
	seedDefaultTypes(notes,)
	return notes
}

/**
 * Reads the sharded NXG usernotes layout. With 6.x compat on, the legacy
 * mirror is diffed against the canonical shards and any 6.x edits are folded
 * into the returned dataset in memory (the wiki is not written on read; the
 * next save persists them).
 * @returns The merged inflated data, or `null` when no notes exist anywhere.
 */
async function readNxgUsernotes (subreddit: string, reconcile: boolean,): Promise<UserNotesData | null> {
	const result = await readShardedUsernotes(subreddit,)
	let notes = result.kind === 'no_page' ? null : result.notes
	if (notes) { purifyObject(notes,) }

	if (reconcile) {
		// NXG may have no usernotes yet while 6.x mods are writing the legacy
		// page (e.g. notes created after a notes-less migration); reconcile
		// from an empty dataset so those flow in.
		const reconciled = await reconcileFromLegacy(subreddit, notes ?? {ver: notesSchema, users: {},},)
		if (notes === null && !reconciled.changed) { return null }
		notes = reconciled.notes
	}
	if (notes === null) { return null }

	if (!notes.types?.length) {
		// Manifests missing type definitions (and datasets sourced purely from
		// the legacy mirror) get them seeded so the next save embeds them.
		seedDefaultTypes(notes,)
	}
	return notes
}

/** Seeds `notes.types` from the built-in defaults, supplemented by any unknown keys found in existing notes. */
function seedDefaultTypes (notes: UserNotesData,): void {
	notes.types = seedV6Types(notes,)
}

/** Per-subreddit save queue: concurrent usernotes saves for one subreddit run in call order. */
const enqueueUsernotesSave = createPerKeyQueue()

/**
 * Encodes and saves usernotes to the subreddit wiki, then updates the cache.
 * The canonical NXG sharded layout is written first; compat-on subs then
 * refresh the legacy `usernotes` mirror as a single v6 blob (its literal path
 * has a special 1MB allowance from Reddit, and 6.x parses it directly). A
 * mirror failure is non-fatal - the canonical save already succeeded and the
 * next save refreshes the mirror. Legacy-fallback subs write the legacy page
 * only.
 *
 * Concurrent saves for the same subreddit are serialized so a later write
 * can't race an earlier in-flight one and silently discard its changes.
 * @param subreddit The subreddit to save usernotes for.
 * @param notes The usernotes data to persist.
 * @param reason Wiki revision note describing the change.
 * @throws On codec or network errors, or when notes outgrow a page limit.
 */
export function saveUserNotes (subreddit: string, notes: UserNotesData, reason: string,): Promise<void> {
	return enqueueUsernotesSave(subreddit, () => doSaveUserNotes(subreddit, notes, reason,),)
}

/** Core write logic for {@link saveUserNotes}, called inside the per-subreddit save queue. */
async function doSaveUserNotes (subreddit: string, notes: UserNotesData, reason: string,): Promise<void> {
	neutralTextFeedback('Saving usernotes...',)
	if (notes.ver < notesSchema) { notes.ver = notesSchema }
	const cleanedNotes = cleanUserNotes(notes,)

	try {
		// Reseed against the outgoing notes so types used by notes but missing
		// from the list (added since load, or never configured) stay in the
		// manifest's self-contained type definitions.
		cleanedNotes.types = seedV6Types(
			cleanedNotes,
			cleanedNotes.types?.length ? cleanedNotes.types : defaultUsernoteTypes,
		)

		const layout = await resolveWikiLayout(subreddit,)

		// Age out notes whose type has an auto-archive window configured.
		// Never on legacy-fallback subs: the v6 page is their only storage and
		// the codec drops archived notes, so archiving there destroys them.
		if (layout.state !== 'legacyFallback') {
			autoArchiveOldNotes(cleanedNotes, cleanedNotes.types,)
		}

		if (layout.state === 'legacyFallback') {
			// Fallback subs: the single legacy page is the only storage.
			await postToWiki(
				subreddit,
				OLD_WIKI_PATHS.usernotes,
				encodeUsernotesV6(cleanedNotes,),
				reason,
				true,
				false,
			)
		} else {
			const mirrorEnabled = compatMirrorEnabled(layout,)
			if (mirrorEnabled) {
				// Capture 6.x edits made since our last read: diff the legacy
				// mirror against the shards as stored, and fold the resulting
				// adds/archives into the outgoing dataset. The diff base must
				// be the *stored* state - the outgoing dataset contains the
				// user's own mutation, which is not a 6.x edit. A failed
				// legacy read aborts: never clobber unseen 6.x notes.
				const [stored, legacyUsers,] = await Promise.all([
					readShardedUsernotes(subreddit,),
					readLegacyUsersForDiff(subreddit,),
				],)
				if (legacyUsers !== null) {
					const ops = computeLegacyDiff(stored.kind === 'no_page' ? {} : stored.notes.users, legacyUsers,)
					applyLegacyDiff(cleanedNotes.users, ops,)
				}
			}

			// The canonical sharded layout is written first; its failure is
			// fatal to the save.
			await writeShardedUsernotes(subreddit, cleanedNotes, reason,)

			if (mirrorEnabled) {
				// Refresh the legacy mirror (active notes only as a v6 blob).
				// Non-fatal: the canonical save succeeded, and the next save
				// rewrites the mirror.
				try {
					await postToWiki(
						subreddit,
						OLD_WIKI_PATHS.usernotes,
						encodeUsernotesV6(cleanedNotes,),
						reason,
						true,
						false,
					)
				} catch (mirrorError: unknown) {
					const mirrorWhy = (mirrorError as {response?: Response}).response?.status === 413
						? 'the active notes exceed the legacy page\'s 1MB limit. Archive old notes or disable '
							+ '6.x compatibility in the Toolbox wiki layout settings to silence this warning'
						: 'network or API error'
					negativeTextFeedback(
						`Notes saved, but the 6.x mirror could not be updated: ${mirrorWhy}`,
						{duration: 5000,},
					)
					await updateNoteCache(subreddit, cleanedNotes,)
					return
				}
			}
		}

		await updateNoteCache(subreddit, cleanedNotes,)
		positiveTextFeedback('Save complete!', {duration: 2000,},)
		return
	} catch (error: unknown) {
		let why: string
		const e = error as {response?: Response}
		if (!e.response) { why = error instanceof Error && error.message ? error.message : 'network error' }
		else if (e.response.status === 413) {
			// The sharded writer splits pages before they can 413, so a 413
			// here means the legacy-fallback page outgrew its 1MB allowance.
			why = 'usernotes full'
		} else { why = await e.response.text() }
		negativeTextFeedback(`Save failed: ${why}`, {duration: 5000,},)
		throw error
	}
}

/**
 * Returns a copy of the dataset with undefined entries and duplicate notes
 * (by identity key) removed. Archived notes are kept - they're data. Users
 * with an empty note list are kept too when they carry a meaningful
 * `nextIndex` (the record is what keeps deleted note indexes from being
 * reissued); empty users with no counter carry no information and are
 * dropped.
 */
function cleanUserNotes (data: UserNotesData,): UserNotesData {
	const users: Record<string, UsernotesUser> = {}
	for (const [name, user,] of Object.entries(data.users,)) {
		const seenNotes = new Set<string>()
		const notes = user.notes.filter((note,): note is UserNoteEntry => {
			if (note === undefined) { return false }
			const key = noteIdentityKey(name, note,)
			if (seenNotes.has(key,)) { return false }
			seenNotes.add(key,)
			return true
		},)
		if (notes.length > 0 || (user.nextIndex ?? 0) > 0) {
			users[name] = {...user, notes,}
		}
	}
	return {...data, users,}
}

/**
 * Returns the usernote type colors for a subreddit from the usernotes manifest,
 * falling back to the built-in defaults when the subreddit has no notes page.
 */
export async function getSubredditColors (subreddit: string,): Promise<UserNoteColor[]> {
	try {
		const notes = await getUserNotes(subreddit,)
		return notes.types?.length ? notes.types : defaultUsernoteTypes
	} catch {
		return defaultUsernoteTypes
	}
}

/**
 * Finds the color definition for a note type key within a subreddit's color list.
 * @returns The matching color entry, or a blank sentinel `{key: 'none', color: '', text: ''}` if not found.
 */
export function findSubredditColor (colors: UserNoteColor[], key: string,): UserNoteColor {
	for (let i = 0; i < colors.length; i++) {
		if (colors[i]!.key === key) { return colors[i]! }
	}
	return {key: 'none', color: '', text: '',}
}

/**
 * Creates a debounced fetcher for the most recent mod note on a user in a
 * subreddit. Batches up to 500 concurrent requests into a single API call.
 * Does not return AI-generated user summary "notes."
 */
export function createLatestModNoteFetcher (): (subreddit: string, user: string,) => Promise<ModNote | null> {
	let pendingLatestNoteRequests: PendingNoteRequest[] = []
	let fetchLatestNotesTimeout: ReturnType<typeof setTimeout> | null = null

	async function processQueue () {
		const queuedRequests = pendingLatestNoteRequests
		pendingLatestNoteRequests = []
		fetchLatestNotesTimeout = null
		try {
			const subreddits = queuedRequests.map((entry,) => entry.subreddit)
			const users = queuedRequests.map((entry,) => entry.user)
			const rawNotes = await getRecentModNotes(subreddits, users,)
			const notes: (ModNote | null)[] = rawNotes.map(
				(note,) => note?.user_note_data?.label === 'USER_SUMMARY' ? null : note,
			)
			for (const [i, {resolve,},] of Object.entries(queuedRequests,)) {
				resolve(notes[parseInt(i, 10,)] ?? null,)
			}
		} catch (error) {
			for (const {reject,} of queuedRequests) {
				reject(error,)
			}
		}
	}

	return function getLatestModNote (subreddit: string, user: string,): Promise<ModNote | null> {
		return new Promise((resolve, reject,) => {
			pendingLatestNoteRequests.push({subreddit, user, resolve, reject,},)
			if (fetchLatestNotesTimeout != null) {
				clearTimeout(fetchLatestNotesTimeout,)
			}
			if (pendingLatestNoteRequests.length === 500) {
				processQueue()
				return
			}
			fetchLatestNotesTimeout = setTimeout(processQueue, 500,)
		},)
	}
}
