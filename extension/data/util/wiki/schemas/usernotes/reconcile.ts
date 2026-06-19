/**
 * Reconciliation between the canonical NXG usernotes shards and the legacy
 * `usernotes` page while 6.x compatibility is on.
 *
 * The NXG side is canonical; the legacy page is a derived mirror holding only
 * *active* notes in v6 form. Because every compat-on save rewrites that
 * mirror as `flattenActive(NXG)`, any later deviation of the legacy page from
 * that flatten is exactly the set of edits made by 6.x mods (or external
 * tools writing the legacy page). Reconciliation folds those edits back into
 * the NXG dataset:
 *
 * - Notes present on legacy but not in NXG were created by 6.x -> merged in as
 *   active notes with fresh indexes.
 * - Active NXG notes missing from legacy were deleted by 6.x -> **archived**
 *   (never deleted) under a sentinel author, since a page diff cannot
 *   attribute the acting mod. Worst case, a diff mismatch wrongly archives a
 *   note, which is recoverable - reconciliation never destroys data.
 *
 * The diff is computed against the NXG state *as stored* and expressed as
 * ops, so the save path can fold concurrent 6.x edits into an outgoing
 * dataset that already contains the user's own mutation - the diff base must
 * never include that mutation (a brand-new note absent from legacy is not a
 * 6.x deletion), and notes the user just deleted or pruned must not be
 * re-added.
 *
 * Like `sharded.ts`, this module avoids importing `moduleapi.ts` so
 * `wikiMigration.ts` can use it without circular imports.
 */

import {readFromWiki,} from '../../../../api/resources/wiki'
import {purifyObject,} from '../../../data/purify'
import {nowInSeconds,} from '../../../data/time'
import {OLD_WIKI_PATHS,} from '../../wikiConstants'
import {decodeUsernotesV6, noteIdentityKey,} from './codec'
import {
	isNoteActive,
	LEGACY_DELETION_ARCHIVER,
	RawUsernotesBlob,
	UserNoteEntry,
	UserNotesData,
	UsernotesUser,
} from './schema'

/** The 6.x edits found by diffing the legacy page against the stored NXG state. */
export interface LegacyDiffOps {
	/** Notes that exist only on the legacy page (6.x-created), per storage key. */
	adds: Array<{username: string; note: UserNoteEntry}>
	/** Identity keys of active NXG notes missing from the legacy mirror (6.x-deleted). */
	archivedKeys: Set<string>
}

/**
 * Computes the 6.x edit ops by diffing the legacy page's users against the
 * NXG users *as stored*. Pure; mutates nothing.
 * @param storedUsers The canonical users as currently stored in the shards.
 * @param legacyUsers The users decoded from the legacy `usernotes` page.
 */
export function computeLegacyDiff (
	storedUsers: Record<string, UsernotesUser>,
	legacyUsers: Record<string, UsernotesUser>,
): LegacyDiffOps {
	const legacyKeys = new Set<string>()
	for (const [name, user,] of Object.entries(legacyUsers,)) {
		for (const note of user.notes) {
			legacyKeys.add(noteIdentityKey(name, note,),)
		}
	}

	const storedKeys = new Set<string>()
	const archivedKeys = new Set<string>()
	for (const [name, user,] of Object.entries(storedUsers,)) {
		for (const note of user.notes) {
			const key = noteIdentityKey(name, note,)
			storedKeys.add(key,)
			// Active notes absent from the mirror were deleted via 6.x.
			if (isNoteActive(note,) && !legacyKeys.has(key,)) {
				archivedKeys.add(key,)
			}
		}
	}

	const adds: LegacyDiffOps['adds'] = []
	for (const [name, user,] of Object.entries(legacyUsers,)) {
		for (const note of user.notes) {
			// Keys present anywhere in NXG - including archived notes - are
			// never re-added; an archived note must not be resurrected.
			if (!storedKeys.has(noteIdentityKey(name, note,),)) {
				adds.push({username: name, note,},)
			}
		}
	}

	return {adds, archivedKeys,}
}

/**
 * Applies 6.x edit ops to a user map, mutating it in place: archives the
 * matching active notes under the `[6.x]` sentinel and merges in the added
 * notes with fresh indexes. Notes the dataset no longer contains (or already
 * has) are skipped, so applying ops to a dataset that has since changed is
 * safe.
 * @returns Whether anything changed.
 */
export function applyLegacyDiff (users: Record<string, UsernotesUser>, ops: LegacyDiffOps,): boolean {
	let changed = false

	if (ops.archivedKeys.size > 0) {
		for (const [name, user,] of Object.entries(users,)) {
			for (const note of user.notes) {
				if (isNoteActive(note,) && ops.archivedKeys.has(noteIdentityKey(name, note,),)) {
					note.archived = {by: LEGACY_DELETION_ARCHIVER, at: nowInSeconds(),}
					changed = true
				}
			}
		}
	}

	if (ops.adds.length > 0) {
		const presentKeys = new Set<string>()
		for (const [name, user,] of Object.entries(users,)) {
			for (const note of user.notes) {
				presentKeys.add(noteIdentityKey(name, note,),)
			}
		}
		for (const {username, note,} of ops.adds) {
			if (presentKeys.has(noteIdentityKey(username, note,),)) { continue }
			const user = users[username] ?? (users[username] = {name: username, notes: [], nextIndex: 0,})
			let nextIndex = user.nextIndex ?? 0
			for (const existing of user.notes) {
				if (existing.index !== undefined && existing.index >= nextIndex) {
					nextIndex = existing.index + 1
				}
			}
			// Newest-first within the array, matching how adds are stored.
			user.notes.unshift({
				index: nextIndex,
				note: note.note,
				time: note.time,
				mod: note.mod,
				type: note.type ?? '',
				link: note.link ?? '',
			},)
			user.nextIndex = nextIndex + 1
			changed = true
		}
	}

	return changed
}

/**
 * Folds 6.x edits from the legacy page's user map into a copy of the
 * canonical NXG user map. Pure.
 * @returns The reconciled user map (a fresh object; inputs are not mutated)
 *   and whether anything changed.
 */
export function diffLegacyNotes (
	nxgUsers: Record<string, UsernotesUser>,
	legacyUsers: Record<string, UsernotesUser>,
): {users: Record<string, UsernotesUser>; changed: boolean} {
	const users = structuredClone(nxgUsers,)
	const changed = applyLegacyDiff(users, computeLegacyDiff(nxgUsers, legacyUsers,),)
	return {users, changed,}
}

/**
 * Reads and decodes the legacy `usernotes` page.
 * @returns The decoded users, or `null` when the page does not exist.
 * @throws When the page exists but cannot be read or decoded - callers abort
 *   rather than risk clobbering unseen 6.x edits.
 */
export async function readLegacyUsersForDiff (
	subreddit: string,
): Promise<Record<string, UsernotesUser> | null> {
	const response = await readFromWiki(subreddit, OLD_WIKI_PATHS.usernotes, false,)
	if (!response.ok) {
		if (response.reason === 'no_page') { return null }
		throw new Error(`could not read the legacy usernotes page (${response.reason})`,)
	}

	let raw: RawUsernotesBlob
	try {
		raw = JSON.parse(response.data,) as RawUsernotesBlob
	} catch {
		throw new Error('the legacy usernotes page is not valid JSON',)
	}
	purifyObject(raw,)
	const legacy = await decodeUsernotesV6(raw, subreddit,)
	if (!legacy) {
		throw new Error('the legacy usernotes page has an unrecognized schema',)
	}
	return legacy.users
}

/**
 * Reads the legacy `usernotes` page and folds any 6.x edits into a copy of
 * the given canonical dataset.
 * @param subreddit The subreddit to reconcile.
 * @param nxgNotes The canonical dataset as read from the NXG shards.
 * @returns The reconciled dataset (the same object when nothing changed) and
 *   whether anything changed. A missing legacy page is a no-op.
 * @throws When the legacy page exists but cannot be read or decoded.
 */
export async function reconcileFromLegacy (
	subreddit: string,
	nxgNotes: UserNotesData,
): Promise<{notes: UserNotesData; changed: boolean}> {
	const legacyUsers = await readLegacyUsersForDiff(subreddit,)
	if (legacyUsers === null) { return {notes: nxgNotes, changed: false,} }

	const {users, changed,} = diffLegacyNotes(nxgNotes.users, legacyUsers,)
	if (!changed) { return {notes: nxgNotes, changed: false,} }
	return {notes: {...nxgNotes, users,}, changed: true,}
}
