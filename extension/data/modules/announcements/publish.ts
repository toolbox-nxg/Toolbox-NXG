/**
 * Read-modify-write data access for the `toolbox_nxg` announcements wiki page:
 * publishing, listing, and removing notes. Kept free of React/DOM so the core
 * logic stays simple to reason about (and the pure helpers in noteUtils stay
 * unit-testable).
 *
 * Writes go through the conflict-safe {@link mutateWikiPage} primitive: a concurrent
 * editor's change can't be silently clobbered, and the {@link announcementsCodec}
 * refuses to overwrite a page it can't interpret (invalid JSON or an unexpected
 * schema), surfaced here as a typed `{ok: false, reason}` instead of a thrown error.
 */

import {readWikiPageVersioned,} from '../../api/resources/wikiVersioned'
import {nowInSeconds,} from '../../util/data/time'
import createLogger from '../../util/infra/logging'
import {mutateWikiPage,} from '../../util/wiki/mutateWikiPage'
import {announcementsCodec,} from './codec'
import {ANNOUNCEMENTS_PAGE, ANNOUNCEMENTS_SUB,} from './constants'
import {generateAnnouncementId,} from './noteUtils'
import type {AnnouncementNote, AnnouncementsWikiData,} from './types'

const log = createLogger('Announcements',)

/** Outcome of a publish attempt. */
export type PublishResult =
	| {ok: true; id: string}
	| {ok: false; reason: string}

/** Outcome of a list (read) attempt. */
export type ListResult =
	| {ok: true; notes: AnnouncementNote[]}
	| {ok: false; reason: string}

/** Outcome of a mutation that returns no value (e.g. remove). */
export type WriteResult =
	| {ok: true}
	| {ok: false; reason: string}

/** The write behavior for the announcements page: listed (it's a public page) and mod-only. */
const WRITE_OPTIONS = {listed: 'true' as const,}

/**
 * Returns all announcement notes currently on the wiki (newest first).
 *
 * Mirrors the write path's refusal semantics: a page the codec cannot interpret
 * (invalid JSON or an unexpected schema) returns `{ok: false, reason}` rather than
 * pretending the page is empty.
 */
export async function getAnnouncements (): Promise<ListResult> {
	const read = await readWikiPageVersioned(ANNOUNCEMENTS_SUB, ANNOUNCEMENTS_PAGE, announcementsCodec,)
	if (read.unparseable) {
		log.warn(`Announcements page unreadable: ${read.unparseable.reason}`,)
		return {ok: false, reason: read.unparseable.reason,}
	}
	return {ok: true, notes: read.data.notes,}
}

/**
 * Appends a new note to the wiki and writes the result back as valid JSON.
 * @param note The note's content, plus an optional `publishAt` (epoch seconds)
 *   for scheduling. Its `id` is always assigned here from the live list;
 *   `publishAt` defaults to now when the caller leaves it unset (publish now).
 */
export async function publishAnnouncement (
	note: Omit<AnnouncementNote, 'id'>,
): Promise<PublishResult> {
	try {
		return await mutateWikiPage<AnnouncementsWikiData, PublishResult>({
			subreddit: ANNOUNCEMENTS_SUB,
			page: ANNOUNCEMENTS_PAGE,
			codec: announcementsCodec,
			reason: 'add announcement',
			writeOptions: WRITE_OPTIONS,
			mutator: (doc,) => {
				const id = generateAnnouncementId(doc.notes,)
				// Default to publishing now; a caller-supplied future publishAt schedules it
				// (the display side hides it until then).
				const publishAt = note.publishAt ?? nowInSeconds()
				// Prepend in place (newest first) so the loop persists the mutated doc.
				doc.notes.unshift({...note, id, publishAt,},)
				return {write: true, result: {ok: true, id,},}
			},
		},)
	} catch (error: unknown) {
		return failureFrom(error, 'Failed to save the announcement to the wiki.', 'write announcement to wiki',)
	}
}

/**
 * Replaces the content of an existing note, identified by `id`. Refuses once the
 * note has gone live (its `publishAt` is at/before now) - only still-scheduled
 * announcements are editable. `publishAt` defaults to now when unset, so clearing
 * a schedule publishes immediately.
 * @param id The id of the announcement to edit.
 * @param note The replacement content.
 */
export async function updateAnnouncement (id: string, note: Omit<AnnouncementNote, 'id'>,): Promise<WriteResult> {
	try {
		return await mutateWikiPage<AnnouncementsWikiData, WriteResult>({
			subreddit: ANNOUNCEMENTS_SUB,
			page: ANNOUNCEMENTS_PAGE,
			codec: announcementsCodec,
			reason: `edit announcement ${id}`,
			writeOptions: WRITE_OPTIONS,
			mutator: (doc,) => {
				const index = doc.notes.findIndex((n,) => n.id === id)
				if (index === -1) {
					return {write: false, result: {ok: false, reason: 'This announcement no longer exists.',},}
				}
				const now = nowInSeconds()
				const existing = doc.notes[index]!
				if (existing.publishAt != null && existing.publishAt <= now) {
					return {
						write: false,
						result: {
							ok: false,
							reason: 'This announcement has already gone live and can no longer be edited.',
						},
					}
				}
				doc.notes[index] = {...note, id, publishAt: note.publishAt ?? now,}
				return {write: true, result: {ok: true,},}
			},
		},)
	} catch (error: unknown) {
		return failureFrom(error, 'Failed to update the announcement.', 'update announcement on wiki',)
	}
}

/**
 * Removes the note with the given id from the wiki.
 * @param id The id of the announcement to remove.
 */
export async function removeAnnouncement (id: string,): Promise<WriteResult> {
	try {
		return await mutateWikiPage<AnnouncementsWikiData, WriteResult>({
			subreddit: ANNOUNCEMENTS_SUB,
			page: ANNOUNCEMENTS_PAGE,
			codec: announcementsCodec,
			reason: `remove announcement ${id}`,
			writeOptions: WRITE_OPTIONS,
			mutator: (doc,) => {
				const remaining = doc.notes.filter((n,) => n.id !== id)
				if (remaining.length === doc.notes.length) {
					// Already gone (e.g. another mod removed it); treat as success, no write.
					return {write: false, result: {ok: true,},}
				}
				doc.notes = remaining
				return {write: true, result: {ok: true,},}
			},
		},)
	} catch (error: unknown) {
		return failureFrom(error, 'Failed to update the announcements wiki.', 'remove announcement from wiki',)
	}
}

/**
 * Converts a thrown mutate error into the module's `{ok: false, reason}` contract.
 * A codec refusal (invalid JSON / unexpected schema) carries a user-facing message,
 * which we surface directly; any other failure uses the generic `fallback`.
 */
function failureFrom (error: unknown, fallback: string, context: string,): {ok: false; reason: string} {
	log.error(`Failed to ${context}:`, error,)
	// The mutate loop throws the codec's refusal reason verbatim; prefer it when present.
	const message = error instanceof Error ? error.message : ''
	return {ok: false, reason: message || fallback,}
}
