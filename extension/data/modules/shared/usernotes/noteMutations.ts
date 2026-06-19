/**
 * Pure functions for applying mutations to the in-memory usernotes data
 * structure. Notes are addressed by their stable per-user `index` (assigned
 * from the user's persisted `nextIndex` at creation and never reused), so a
 * mutation unambiguously names its target - including for third-party tools
 * reading the wiki.
 */

import {nowInSeconds,} from '../../../util/data/time'
import type {UserNoteEntry, UserNotesData, UsernotesUser,} from '../../../util/wiki/schemas/usernotes/schema'

/** A discriminated union describing a single change to a user's note list. */
export type UserNoteMutation =
	/** Creates a note; its `index` is assigned from the user's `nextIndex`. */
	| {change: 'add'; note: UserNoteEntry}
	/**
	 * Removes a note. Its `index` is never reused (`nextIndex` survives), and
	 * a user emptied of notes keeps their record so the index stays stable.
	 */
	| {change: 'delete'; index: number}
	/** Updates a note's text/type in place. */
	| {change: 'edit'; index: number; note: {note: string; type: string | undefined}}
	/** Hides a note without deleting it, with attribution. */
	| {change: 'archive'; index: number; by: string}
	/** Clears a note's archived state. */
	| {change: 'unarchive'; index: number}

/** Resolved field values for a new usernote, before the shared conventions are applied. */
export interface NewUserNoteFields {
	/** Raw note text; trimmed by {@link makeUserNoteEntry}. */
	note: string
	/** Username of the moderator creating the note. */
	mod: string
	/** Creation time in epoch seconds; defaults to now when omitted. */
	time?: number
	/** Note type key, or `undefined` for no type. */
	type?: string
	/** Permalink of the noted item, if any. Falsy values are dropped. */
	link?: string
	/** Full URL of an associated removal message (modmail), if any. */
	messageLink?: string
}

/**
 * Builds a stored usernote entry from resolved field values, applying the
 * conventions every note-creation path must agree on so they cannot drift apart:
 * the note text is trimmed; `time` defaults to the current time in epoch
 * *seconds* (the wiki format and all readers expect seconds, never the
 * milliseconds `Date.now()` returns); and the optional `type`/`link`/
 * `messageLink` fields are omitted entirely when unset rather than stored as
 * empty values. An absent `link` round-trips identically to `''` through the
 * codec, so omitting it is wire-compatible with notes that stored an empty link.
 * @param fields The note's resolved field values.
 * @returns A {@link UserNoteEntry} ready to hand to an `add` mutation.
 */
export function makeUserNoteEntry (
	{note, mod, time = nowInSeconds(), type, link, messageLink,}: NewUserNoteFields,
): UserNoteEntry {
	return {
		note: note.trim(),
		time,
		mod,
		...(type !== undefined ? {type,} : {}),
		...(link ? {link,} : {}),
		...(messageLink !== undefined ? {messageLink,} : {}),
	}
}

/**
 * Merges the note lists of a user stored under both a lowercase and a
 * canonical-cased key. Each storage key has its own index space, so the
 * merged record must reindex one side to stay collision-free: the canonical
 * side keeps its indexes and the lowercase side's are offset past them. The
 * same rule is applied by the read path (`getUser`), so indexes shown in the
 * UI match the ones a subsequent mutation consolidates to.
 * @param lowercaseNotes Notes stored under the lowercase key (listed first).
 * @param canonical The user record stored under the canonical-cased key.
 */
export function mergeDualKeyNotes (
	lowercaseNotes: UserNoteEntry[],
	canonical: UsernotesUser,
): {notes: UserNoteEntry[]; nextIndex: number} {
	let canonicalNext = canonical.nextIndex ?? 0
	for (const note of canonical.notes) {
		if (note.index !== undefined && note.index >= canonicalNext) { canonicalNext = note.index + 1 }
	}
	let highest = canonicalNext - 1
	const reindexed = lowercaseNotes.map((note, position,): UserNoteEntry => {
		const index = canonicalNext + (note.index ?? position)
		if (index > highest) { highest = index }
		return {...note, index,}
	},)
	// Newest-first, matching how the rest of the codebase orders note arrays.
	const notes = [...reindexed, ...canonical.notes,].sort((a, b,) => b.time - a.time)
	return {notes, nextIndex: highest + 1,}
}

/** A deep-copied user record merged across dual storage keys, ready to mutate. */
export interface FoundUser extends UsernotesUser {
	/** The legacy lowercase key that should be removed from storage when writing back. */
	nonCanonicalName?: string
}

/**
 * Resolves a user that may be stored under both a lowercase and a canonical-cased
 * key, returning a deep-cloned record ready to read or mutate. When both keys hold
 * the user their notes are merged collision-free via {@link mergeDualKeyNotes}; when
 * only one does, that record is returned with `nonCanonicalName` set if it came from
 * a legacy lowercase key (so the caller can drop that key on write-back).
 *
 * The read path and the mutation path differ only in two policies, expressed as
 * options: the read path drops note-less users and sorts newest-first for display,
 * while the mutation path keeps a note-less record (its `nextIndex` continues the add
 * index sequence) and preserves order.
 * @param users The notes map, keyed by username (lowercase and/or canonical case).
 * @param name The username being looked up, in the caller's casing.
 * @param opts.keepEmptyNotes Keep a single-key record that has zero notes.
 * @param opts.sort Sort a single-key record's notes newest-first.
 */
export function resolveDualKeyUser (
	users: Record<string, UsernotesUser>,
	name: string,
	opts: {keepEmptyNotes: boolean; sort: boolean},
): FoundUser | undefined {
	const {keepEmptyNotes, sort,} = opts
	const lowerCaseName = name.toLowerCase()
	const hasLower = name !== lowerCaseName && Object.prototype.hasOwnProperty.call(users, lowerCaseName,)
	const hasExact = Object.prototype.hasOwnProperty.call(users, name,)

	if (hasLower && hasExact) {
		const merged = mergeDualKeyNotes(
			structuredClone(users[lowerCaseName]!.notes,),
			structuredClone(users[name]!,),
		)
		return {name, notes: merged.notes, nextIndex: merged.nextIndex, nonCanonicalName: lowerCaseName,}
	}

	const stored = hasExact ? users[name] : hasLower ? users[lowerCaseName] : undefined
	if (!stored || (!keepEmptyNotes && stored.notes.length === 0)) { return undefined }
	const notes = structuredClone(stored.notes,)
	return {
		name,
		notes: sort ? notes.sort((a, b,) => b.time - a.time) : notes,
		...(stored.nextIndex !== undefined ? {nextIndex: stored.nextIndex,} : {}),
		// The lowercase key is replaced by the caller's casing on write-back.
		...(hasLower ? {nonCanonicalName: lowerCaseName,} : {}),
	}
}

function findUser (users: UserNotesData['users'], name: string,): FoundUser | undefined {
	// Mutation path: keep a note-less record (its `nextIndex` continues the add
	// sequence instead of restarting at 0) and preserve order.
	return resolveDualKeyUser(users, name, {keepEmptyNotes: true, sort: false,},)
}

/**
 * Applies a mutation to the in-memory usernotes data, mutating it in place.
 * Also consolidates notes stored under both a lowercase and mixed-case
 * username key (reindexing collision-free via {@link mergeDualKeyNotes}).
 * @returns A wiki revision message describing the change, or undefined if the
 *   mutation could not be applied (e.g. the target index does not exist).
 */
export function applyUserNoteMutation (
	notes: UserNotesData,
	user: string,
	mutation: UserNoteMutation,
): string | undefined {
	const existingUser = findUser(notes.users, user,)

	if (existingUser === undefined) {
		if (mutation.change !== 'add') { return undefined }
		notes.users[user] = {
			name: user,
			notes: [{...mutation.note, index: 0,},],
			nextIndex: 1,
		}
		return `create new note on new user ${user}`
	}

	if (mutation.change === 'add') {
		let nextIndex = existingUser.nextIndex ?? 0
		for (const note of existingUser.notes) {
			if (note.index !== undefined && note.index >= nextIndex) { nextIndex = note.index + 1 }
		}
		existingUser.notes.unshift({...mutation.note, index: nextIndex,},)
		existingUser.nextIndex = nextIndex + 1
	} else {
		const position = existingUser.notes.findIndex((note,) => note.index === mutation.index)
		if (position === -1) { return undefined }
		const note = existingUser.notes[position]!

		switch (mutation.change) {
			case 'delete':
				existingUser.notes.splice(position, 1,)
				break
			case 'edit': {
				note.note = mutation.note.note
				if (mutation.note.type !== undefined) { note.type = mutation.note.type }
				else { delete note.type }
				break
			}
			case 'archive':
				note.archived = {by: mutation.by, at: nowInSeconds(),}
				break
			case 'unarchive':
				delete note.archived
				break
		}
	}

	if (existingUser.nonCanonicalName !== undefined) {
		delete notes.users[existingUser.nonCanonicalName]
		delete existingUser.nonCanonicalName
	}

	// A user emptied of notes keeps their record: `nextIndex` must survive so
	// deleted indexes are never reissued to a later note.
	notes.users[user] = existingUser

	switch (mutation.change) {
		case 'add':
			return `create new note on user ${user}`
		case 'delete':
			return `delete note ${mutation.index} on user ${user}`
		case 'edit':
			return `edit note ${mutation.index} on user ${user}`
		case 'archive':
			return `archive note ${mutation.index} on user ${user}`
		case 'unarchive':
			return `unarchive note ${mutation.index} on user ${user}`
	}
}
