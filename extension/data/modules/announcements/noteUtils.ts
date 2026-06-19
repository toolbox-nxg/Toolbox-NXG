/**
 * Pure helpers for announcement ids and note-list shaping. Kept free of any
 * browser/extension imports so they can be unit-tested in a plain Node
 * environment (see noteUtils.test.ts).
 */

import type {AnnouncementNote, AnnouncementsWikiData,} from './types'

/**
 * Formats a `Date` as a `YYYY-MM-DD` string in local time.
 * Local time is intentional: announcement ids are human-facing labels keyed to
 * the publishing mod's calendar day, not an absolute instant.
 * @param date The date to format.
 */
export function formatDateStamp (date: Date,): string {
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1,).padStart(2, '0',)
	const day = String(date.getDate(),).padStart(2, '0',)
	return `${year}-${month}-${day}`
}

/**
 * Generates a stable, collision-free announcement id of the form `YYYY-MM-DD-N`,
 * where `N` is one greater than the highest existing index for today's date stamp.
 *
 * Using the highest index (not the count) is what keeps ids unique: removing a note
 * lowers the count, so a count-based scheme could hand out an index a surviving note
 * already uses - and `removeAnnouncement` filters by id, so a duplicate id would strip
 * both. Indexing past the max never reuses a freed slot within the day.
 * @param notes Existing notes (used only to find today's highest index).
 * @param today The reference date; defaults to now. Injectable for testing.
 */
export function generateAnnouncementId (notes: AnnouncementNote[], today: Date = new Date(),): string {
	const stamp = formatDateStamp(today,)
	const prefix = `${stamp}-`
	let maxIndex = 0
	for (const note of notes) {
		if (!note.id.startsWith(prefix,)) { continue }
		const index = Number.parseInt(note.id.slice(prefix.length,), 10,)
		if (Number.isFinite(index,) && index > maxIndex) { maxIndex = index }
	}
	return `${stamp}-${maxIndex + 1}`
}

/**
 * Returns a new announcements document with `note` prepended to the existing
 * notes (newest first), preserving `version`. Does not mutate `existing`.
 * @param existing The current announcements document.
 * @param note The note to add.
 */
export function appendNote (
	existing: AnnouncementsWikiData,
	note: AnnouncementNote,
): AnnouncementsWikiData {
	return {
		version: existing.version,
		notes: [note, ...existing.notes,],
	}
}

/**
 * Returns `true` only if `value` parses as an absolute `http:`/`https:` URL.
 * Used both to validate the author-supplied link and to guard it at render time:
 * other schemes (notably `javascript:` and `data:`) parse fine via `URL` but must
 * never become a clickable `href`, since the card renders in the user's Reddit
 * page context.
 * @param value The candidate URL string.
 */
export function isHttpUrl (value: string,): boolean {
	try {
		const {protocol,} = new URL(value,)
		return protocol === 'http:' || protocol === 'https:'
	} catch {
		return false
	}
}

/**
 * Filters out scheduled notes whose `publishAt` is still in the future - the
 * client-side half of "publish later". A note is eligible when it has no
 * `publishAt` or its `publishAt` is at/before `nowSeconds`.
 * @param notes Notes to filter.
 * @param nowSeconds Current time in epoch seconds.
 */
export function filterByPublishAt (notes: AnnouncementNote[], nowSeconds: number,): AnnouncementNote[] {
	return notes.filter((n,) => n.publishAt == null || n.publishAt <= nowSeconds)
}
