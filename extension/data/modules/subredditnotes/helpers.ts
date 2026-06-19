/** UI helpers for the subreddit-notes module: slug generation and note list
 * filtering. The index codec (normalization, legacy conversion, merging) lives
 * in `util/wiki/schemas/subredditnotes/codec`. */

import {title_to_url,} from '../../util/reddit/reddit-domain'
import type {SubredditNoteMeta, SubredditNoteSort,} from '../../util/wiki/schemas/subredditnotes/schema'

/**
 * Appends an incrementing numeric suffix to `baseSlug` until the result is unique
 * within `taken` and is not the reserved value `'index'`.
 */
function ensureUniqueSlug (baseSlug: string, taken: Set<string>,): string {
	let slug = baseSlug
	let suffix = 2
	while (taken.has(slug.toLowerCase(),) || slug === 'index') {
		slug = `${baseSlug}-${suffix}`
		suffix += 1
	}
	return slug
}

/**
 * Derives a URL-safe slug from a note title, appending a numeric suffix if
 * the slug is already taken or reserved.
 */
export function makeUniqueSlug (title: string, existingSlugs: Iterable<string>,): string {
	const taken = new Set([...existingSlugs,].map((slug,) => slug.toLowerCase()),)
	const cleanedTitle = title.trim()
	const baseSlug = cleanedTitle ? title_to_url(cleanedTitle,) : 'note'
	return ensureUniqueSlug(baseSlug, taken,)
}

/**
 * Generates a slug from a unix timestamp and user, appending a numeric
 * suffix if the slug is already taken.
 */
export function makeTimestampUserSlug (
	timestamp: number,
	user: string,
	existingSlugs: Iterable<string>,
): string {
	const taken = new Set([...existingSlugs,].map((slug,) => slug.toLowerCase()),)
	const safeUsername = title_to_url(user.trim(),) || 'user'
	const baseSlug = `${Math.floor(timestamp / 1000,)}-${safeUsername}`
	return ensureUniqueSlug(baseSlug, taken,)
}

/**
 * Returns a filtered and sorted subset of `notes` according to the given criteria.
 * @param notes Full note list to filter.
 */
export function filterAndSortNotes (
	notes: SubredditNoteMeta[],
	{
		search,
		showArchived,
		sort,
		selectedTags = [],
		selectedAuthors = [],
	}: {
		search: string
		showArchived: boolean
		sort: SubredditNoteSort
		/** When non-empty, only notes that contain ALL of these tags are shown. */
		selectedTags?: string[]
		/** When non-empty, only notes whose author is in this list are shown. */
		selectedAuthors?: string[]
	},
): SubredditNoteMeta[] {
	const term = search.trim().toLowerCase()
	const tagFilters = selectedTags.map((t,) => t.toLowerCase())
	const authorFilters = selectedAuthors.map((a,) => a.toLowerCase())
	return notes
		.filter((note,) => showArchived || !note.archived)
		.filter((note,) =>
			!term
			|| note.title.toLowerCase().includes(term,)
			|| note.slug.toLowerCase().includes(term,)
			|| (note.tags ?? []).some((tag,) => tag.toLowerCase().includes(term,))
		)
		.filter((note,) =>
			tagFilters.length === 0
			|| tagFilters.every((f,) => (note.tags ?? []).some((t,) => t.toLowerCase() === f))
		)
		.filter((note,) =>
			authorFilters.length === 0
			|| authorFilters.includes((note.author ?? '').toLowerCase(),)
		)
		.sort((a, b,) => {
			if (sort === 'updated') {
				return b.updatedAt - a.updatedAt
					|| a.title.localeCompare(b.title, undefined, {sensitivity: 'base',},)
			}
			return a.title.localeCompare(b.title, undefined, {sensitivity: 'base',},)
		},)
}

/**
 * Collects all unique tags from the given notes with occurrence counts,
 * sorted by count descending then alphabetically.
 * @param notes Notes to scan (pass already-filtered notes to respect archive visibility).
 */
export function getAllTags (notes: SubredditNoteMeta[],): {tag: string; count: number}[] {
	const counts = new Map<string, number>()
	for (const note of notes) {
		for (const tag of note.tags ?? []) {
			counts.set(tag, (counts.get(tag,) ?? 0) + 1,)
		}
	}
	return [...counts.entries(),]
		.map(([tag, count,],) => ({tag, count,}))
		.sort((a, b,) => b.count - a.count || a.tag.localeCompare(b.tag, undefined, {sensitivity: 'base',},))
}

/**
 * Collects all unique authors from the given notes, sorted alphabetically.
 * @param notes Notes to scan.
 */
export function getAllAuthors (notes: SubredditNoteMeta[],): string[] {
	const seen = new Set<string>()
	for (const note of notes) {
		if (note.author) { seen.add(note.author,) }
	}
	return [...seen,].sort((a, b,) => a.localeCompare(b, undefined, {sensitivity: 'base',},))
}

/**
 * Returns `true` when there are unsaved changes that should warn before navigation.
 */
export function shouldWarnUnsaved (savedValue: string, editorValue: string, saving: boolean,): boolean {
	return !saving && savedValue !== editorValue
}

/**
 * Parses a comma-separated tag string into a deduplicated array of trimmed tags.
 */
export function parseTags (value: string,): string[] {
	const seen = new Set<string>()
	return value
		.split(',',)
		.map((tag,) => tag.trim())
		.filter((tag,) => {
			const key = tag.toLowerCase()
			if (!tag || seen.has(key,)) { return false }
			seen.add(key,)
			return true
		},)
}
