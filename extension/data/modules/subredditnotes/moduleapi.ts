/** Wiki storage operations for the Subreddit Notes module. */
import {getWikiPages, getWikiRevisions, postToWiki, readFromWiki,} from '../../api/resources/wiki'
import {
	NEW_NOTE_PAGE_PREFIX,
	NEW_WIKI_PATHS,
	OLD_NOTE_PAGE_PREFIX,
	OLD_WIKI_PATHS,
} from '../../util/wiki/wikiConstants'
import {compatMirrorEnabled, getNoteWritePaths, getWikiWritePaths, resolveWikiLayout,} from '../../util/wiki/wikiPaths'

import {
	buildIndexFromWikiPages,
	computeIndexAggregates,
	encodeLegacyIndex,
	mergeLegacyIndex,
	normalizeIndex,
} from '../../util/wiki/schemas/subredditnotes/codec'
import type {SubredditNoteIndex,} from '../../util/wiki/schemas/subredditnotes/schema'

/**
 * Reads the note index for a subreddit, normalizing and migrating as needed.
 * If the stored index is absent or malformed, builds one from existing wiki
 * pages. With 6.x compatibility on, the legacy index is union-merged in so
 * notes created from 6.x show up - the merge sets `bootstrapped`, and the
 * caller's persist writes both pages, healing the divergence.
 * The `bootstrapped` flag is `true` when the caller should persist the index.
 */
export async function loadNoteIndex (
	subreddit: string,
): Promise<{index: SubredditNoteIndex; bootstrapped: boolean}> {
	// Resolve the layout once so the whole operation uses one consistent
	// layout even if the subreddit's compat mode changes mid-flight.
	const layout = await resolveWikiLayout(subreddit,)
	// Non-moderated subs short-circuit to a read-free `notModerated` layout: hand back
	// an empty index without touching the wiki (and never flag it for persisting).
	if (layout.notModerated) {
		return {index: buildIndexFromWikiPages([], NEW_NOTE_PAGE_PREFIX,), bootstrapped: false,}
	}
	const legacyCanonical = layout.state === 'legacyFallback'
	const indexPage = legacyCanonical ? OLD_WIKI_PATHS.notes : NEW_WIKI_PATHS.notes
	const notePrefix = legacyCanonical ? OLD_NOTE_PAGE_PREFIX : NEW_NOTE_PAGE_PREFIX

	let index: SubredditNoteIndex | null = null
	let bootstrapped = false
	const response = await readFromWiki<SubredditNoteIndex>(subreddit, indexPage, true,)
	if (response.ok) {
		index = normalizeIndex(response.data,)
	}
	if (!index) {
		const pages = await getWikiPages(subreddit,)
		index = buildIndexFromWikiPages(pages, notePrefix,)
		bootstrapped = true
	}

	if (compatMirrorEnabled(layout,)) {
		// Fold in any notes 6.x created on the legacy side. Failures reading
		// the mirror never break the load.
		const legacyResponse = await readFromWiki<SubredditNoteIndex>(subreddit, OLD_WIKI_PATHS.notes, true,)
		const legacyIndex = legacyResponse.ok ? normalizeIndex(legacyResponse.data,) : null
		if (legacyIndex) {
			const merged = mergeLegacyIndex(index, legacyIndex,)
			if (merged.changed) {
				index = merged.index
				bootstrapped = true
			}
		}
	}

	return {index, bootstrapped,}
}

/**
 * Writes a sequence of wiki pages canonical-first: the first page's failure
 * is fatal (rethrown), while failures on the remaining mirror pages are
 * swallowed - the canonical write already succeeded and the next save
 * refreshes the mirror.
 */
async function writeCanonicalThenMirrors (
	pages: string[],
	write: (page: string,) => Promise<unknown>,
): Promise<void> {
	const [canonicalPage, ...mirrorPages] = pages
	await write(canonicalPage!,)
	for (const page of mirrorPages) {
		try {
			await write(page,)
		} catch {
			// Non-fatal: mirror divergence is healed by reconciliation on read
			// and by the next successful save.
		}
	}
}

/**
 * Writes the note index for a subreddit to the wiki, fanning out to the
 * legacy mirror after the canonical NXG write when 6.x compatibility is on.
 * Each destination gets its own schema: the NXG page is written as v2 (with
 * freshly recomputed tag and author aggregates), while the legacy page stays
 * in the v1 shape older toolbox builds expect.
 * @param subreddit Target subreddit.
 * @param index Index to persist.
 * @param reason Edit reason shown in the wiki revision history.
 */
export async function writeNoteIndex (
	subreddit: string,
	index: SubredditNoteIndex,
	reason: string,
): Promise<void> {
	const v2Index: SubredditNoteIndex = {...index, ...computeIndexAggregates(index.notes,),}
	const pages = await getWikiWritePaths('notes', subreddit,)
	await writeCanonicalThenMirrors(pages, (page,) =>
		postToWiki(
			subreddit,
			page,
			page === NEW_WIKI_PATHS.notes ? v2Index : encodeLegacyIndex(v2Index,),
			reason,
			true,
			false,
		),)
}

/**
 * Returns the unix timestamp (seconds) of a wiki page's latest revision, or
 * `0` when it can't be determined (treated as oldest-possible).
 */
async function latestRevisionTime (subreddit: string, page: string,): Promise<number> {
	try {
		const revisions = await getWikiRevisions(subreddit, page, 1,)
		return revisions[0]?.timestamp ?? 0
	} catch {
		return 0
	}
}

/**
 * Reads a single note page from the wiki as raw markdown.
 * Returns a discriminated union - check `.ok` before using `.data`.
 *
 * With 6.x compatibility on, the legacy page is consulted too. When the two
 * sides diverge, the newer revision wins: a newer legacy page means a 6.x
 * edit (it's adopted and immediately copied to the NXG page), while a newer
 * NXG page means a previous mirror write failed (the next save heals it).
 * Newer-wins, rather than blind legacy-wins, because under NXG-first writes a
 * partial failure leaves the NXG side ahead.
 */
export async function readNotePage (subreddit: string, slug: string,) {
	const layout = await resolveWikiLayout(subreddit,)
	// Non-moderated subs short-circuit to a read-free `notModerated` layout: no page to read.
	if (layout.notModerated) {
		return {ok: false, reason: 'no_page',} as const
	}
	if (layout.state === 'legacyFallback') {
		return readFromWiki(subreddit, `${OLD_NOTE_PAGE_PREFIX}${slug}`, false,)
	}

	const nxgPage = `${NEW_NOTE_PAGE_PREFIX}${slug}`
	const nxgResponse = await readFromWiki(subreddit, nxgPage, false,)
	if (!compatMirrorEnabled(layout,)) { return nxgResponse }

	const legacyPage = `${OLD_NOTE_PAGE_PREFIX}${slug}`
	const legacyResponse = await readFromWiki(subreddit, legacyPage, false,)
	if (!legacyResponse.ok) { return nxgResponse }
	// 6.x-created note that hasn't reached the NXG side yet.
	if (!nxgResponse.ok) { return legacyResponse }
	if (nxgResponse.data === legacyResponse.data) { return nxgResponse }

	// Divergent content: two extra revision lookups decide which side is
	// newer. Reddit's revision timestamps are second-granular; ties go to the
	// canonical NXG side.
	const [nxgTime, legacyTime,] = await Promise.all([
		latestRevisionTime(subreddit, nxgPage,),
		latestRevisionTime(subreddit, legacyPage,),
	],)
	if (legacyTime <= nxgTime) { return nxgResponse }

	// The legacy side carries a 6.x edit: adopt it and refresh the NXG page
	// right away so subsequent reads agree without re-checking revisions.
	try {
		await postToWiki(subreddit, nxgPage, legacyResponse.data, 'Adopting 6.x note edit', false, false,)
	} catch {
		// Non-fatal: the adoption still serves the newer content; the next
		// write persists it.
	}
	return legacyResponse
}

/**
 * Writes a single note page to the wiki, fanning out to the legacy mirror
 * after the canonical NXG write when 6.x compatibility is on.
 * @param subreddit Target subreddit.
 * @param slug Note slug (page name suffix after the notes prefix).
 * @param content Markdown content to write.
 * @param reason Edit reason shown in the wiki revision history.
 */
export async function writeNotePage (
	subreddit: string,
	slug: string,
	content: string,
	reason: string,
): Promise<void> {
	const pages = await getNoteWritePaths(slug, subreddit,)
	await writeCanonicalThenMirrors(pages, (page,) => postToWiki(subreddit, page, content, reason, false, false,),)
}
