/** Codec for the subreddit-notes index: validates/normalizes raw wiki page
 * data into the canonical v2 `SubredditNoteIndex`, down-converts to the legacy
 * v1 wire shape for the old `notes/index` page, and reconciles legacy edits
 * back into the canonical index. */

import type {SubredditNoteIndex, SubredditNoteIndexV1, SubredditNoteMeta,} from './schema'
import {subredditNotesIndexVersion, subredditNotesLegacyIndexVersion,} from './schema'

function isRecord (value: unknown,): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value,)
}

/**
 * @returns An empty note index at the current schema version.
 */
export function makeEmptyIndex (): SubredditNoteIndex {
	return {version: subredditNotesIndexVersion, notes: [], tags: [], authors: [],}
}

/**
 * Computes the v2 pre-aggregated tag and author lists from a notes array:
 * sorted, unique, recomputed from scratch so they can never go stale relative
 * to the notes they describe.
 * @param notes The note metadata entries to aggregate.
 */
export function computeIndexAggregates (notes: SubredditNoteMeta[],): {tags: string[]; authors: string[]} {
	const tags = new Set<string>()
	const authors = new Set<string>()
	for (const note of notes) {
		for (const tag of note.tags ?? []) { tags.add(tag,) }
		if (note.author) { authors.add(note.author,) }
	}
	const sorter = (a: string, b: string,) => a.localeCompare(b, undefined, {sensitivity: 'base',},)
	return {tags: [...tags,].sort(sorter,), authors: [...authors,].sort(sorter,),}
}

/**
 * Converts an index to the legacy v1 wire shape for the old `notes/index`
 * page: notes only, no aggregate fields, so older toolbox builds see exactly
 * the format they expect.
 * @param index The index to down-convert.
 */
export function encodeLegacyIndex (index: Pick<SubredditNoteIndex, 'notes'>,): SubredditNoteIndexV1 {
	return {version: subredditNotesLegacyIndexVersion, notes: index.notes,}
}

/**
 * Converts a slug like `my-note-slug` into a title-cased string `My Note Slug`.
 */
export function noteTitleFromSlug (slug: string,): string {
	return slug
		.split(/[-_]/,)
		.filter(Boolean,)
		.map((part,) => part.charAt(0,).toUpperCase() + part.slice(1,))
		.join(' ',)
		|| slug
}

/**
 * Validates and normalizes a raw parsed index value into a canonical
 * `SubredditNoteIndex`. The v2 aggregate fields are always recomputed from
 * the notes regardless of input version, so both v1 pages and stale v2
 * aggregates self-heal on load.
 * Returns `null` if the value is not a recognizable index shape.
 */
export function normalizeIndex (value: unknown, now = Date.now(),): SubredditNoteIndex | null {
	if (!isRecord(value,) || !Array.isArray(value.notes,)) { return null }

	const seen = new Set<string>()
	const notes: SubredditNoteMeta[] = []
	for (const rawNote of value.notes) {
		if (!isRecord(rawNote,) || typeof rawNote.slug !== 'string') { continue }
		const slug = rawNote.slug.trim()
		if (!slug || slug === 'index' || seen.has(slug,)) { continue }

		seen.add(slug,)
		notes.push({
			slug,
			title: typeof rawNote.title === 'string' && rawNote.title.trim()
				? rawNote.title.trim()
				: noteTitleFromSlug(slug,),
			createdAt: typeof rawNote.createdAt === 'number' && Number.isFinite(rawNote.createdAt,)
				? rawNote.createdAt
				: now,
			updatedAt: typeof rawNote.updatedAt === 'number' && Number.isFinite(rawNote.updatedAt,)
				? rawNote.updatedAt
				: now,
			archived: rawNote.archived === true,
			tags: Array.isArray(rawNote.tags,)
				? rawNote.tags.filter((tag,): tag is string => typeof tag === 'string').map((tag,) => tag.trim())
					.filter(
						Boolean,
					)
				: [],
			...(typeof rawNote.author === 'string' && rawNote.author.trim() ? {author: rawNote.author.trim(),} : {}),
		},)
	}

	return {version: subredditNotesIndexVersion, notes, ...computeIndexAggregates(notes,),}
}

/**
 * Merges a legacy `notes/index` page into the canonical NXG index by slug
 * union - the index analog of the usernotes reconcile path:
 * - Slugs only in the legacy index were created by 6.x and are appended.
 * - Slugs only in the NXG index are kept: a 6.x deletion is indistinguishable
 *   from a failed mirror write, so deletions never propagate legacy->NXG.
 * - Slugs in both keep the NXG entry (it carries the richer v2 metadata).
 * The aggregates are recomputed when anything changed.
 * @param nxg The canonical normalized NXG index.
 * @param legacy The normalized legacy index to fold in.
 */
export function mergeLegacyIndex (
	nxg: SubredditNoteIndex,
	legacy: SubredditNoteIndex,
): {index: SubredditNoteIndex; changed: boolean} {
	const knownSlugs = new Set(nxg.notes.map((note,) => note.slug),)
	const added = legacy.notes.filter((note,) => !knownSlugs.has(note.slug,))
	if (added.length === 0) { return {index: nxg, changed: false,} }

	const notes = [...nxg.notes, ...added,]
	return {
		index: {version: subredditNotesIndexVersion, notes, ...computeIndexAggregates(notes,),},
		changed: true,
	}
}

/**
 * Builds a note index by scanning existing wiki page names for the given note
 * page prefix. Used as a migration path when no index page exists yet.
 * @param pages All wiki page names on the subreddit.
 * @param notePrefix The note page prefix for the subreddit's wiki layout
 *   (e.g. `'notes/'` or `'toolbox-nxg/notes/'`).
 * @param now Timestamp recorded as the created/updated time of every note.
 */
export function buildIndexFromWikiPages (
	pages: string[],
	notePrefix: string,
	now = Date.now(),
): SubredditNoteIndex {
	const seen = new Set<string>()
	const notes = pages
		.map((page,) => page.startsWith(notePrefix,) ? page.slice(notePrefix.length,) : undefined)
		.filter((slug,): slug is string => Boolean(slug,) && slug !== 'index')
		.filter((slug,) => {
			if (seen.has(slug,)) { return false }
			seen.add(slug,)
			return true
		},)
		.sort((a, b,) => a.localeCompare(b, undefined, {sensitivity: 'base',},))
		.map((slug,) => ({
			slug,
			title: noteTitleFromSlug(slug,),
			createdAt: now,
			updatedAt: now,
			archived: false,
			tags: [],
		}))

	return {version: subredditNotesIndexVersion, notes, ...computeIndexAggregates(notes,),}
}
