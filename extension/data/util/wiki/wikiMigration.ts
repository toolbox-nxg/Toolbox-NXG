/**
 * Multi-step wiki copy operations for the toolbox-nxg layout: the initial
 * legacy->NXG migration (also used to refresh the NXG mirror or repair deleted
 * NXG pages), the reverse NXG->legacy copy used when 6.x compatibility is
 * re-enabled, and the compatibility-mode toggle that sequences them.
 *
 * Writes are sequential, not parallel - Reddit rate-limits wiki edits, and a
 * deliberate ordering lets a failure abort cleanly instead of leaving an
 * unknown subset of pages written.
 */

import {isModSub,} from '../../api/resources/modSubs'
import {getWikiPages, getWikiRevisions, postToWiki, readFromWiki,} from '../../api/resources/wiki'
import {utils,} from '../../framework/moduleIds'
import {purifyObject,} from '../data/purify'
import createLogger from '../infra/logging'
import {clearCache, getCache, setCache,} from '../persistence/cache'
import {encodeClassicConfig,} from './schemas/config/codec'
import {adoptLegacyConfigFields, legacyOwnedFieldsEqual,} from './schemas/config/reconcile'
import {config as defaultToolboxConfig, normalizeConfig,} from './schemas/config/schema'
import type {ToolboxConfig,} from './schemas/config/schema'
import {decodeDomainTagsPage,} from './schemas/domaintags/codec'
import type {DomainTag,} from './schemas/domaintags/schema'
import {
	buildIndexFromWikiPages,
	encodeLegacyIndex,
	mergeLegacyIndex,
	normalizeIndex,
} from './schemas/subredditnotes/codec'
import type {SubredditNoteIndex,} from './schemas/subredditnotes/schema'
import {decodeUsernotesV6, encodeUsernotesV6, seedV6Types,} from './schemas/usernotes/codec'
import {reconcileFromLegacy,} from './schemas/usernotes/reconcile'
import type {RawUsernotesBlob, UserNoteColor, UserNotesData,} from './schemas/usernotes/schema'
import {clearSessionShardState, readShardedUsernotes, writeShardedUsernotes,} from './schemas/usernotes/sharded'
import {
	COMPAT_WRITES_KEY,
	DOMAIN_TAGS_PAGE,
	isTombstone,
	NEW_NOTE_PAGE_PREFIX,
	NEW_WIKI_PATHS,
	OLD_NOTE_PAGE_PREFIX,
	OLD_WIKI_PATHS,
	WIKI_LAYOUT_KEY,
} from './wikiConstants'
import {setCachedWikiLayout,} from './wikiLayoutCache'
import type {WikiLayout,} from './wikiLayoutCache'

const log = createLogger('TBWikiMigration',)

/** Per-page outcome report for a migration or reverse-copy run. */
export type WikiMigrationResult = {
	/** Pages successfully written to the destination side. */
	copied: string[]
	/** Source pages skipped because they don't exist (`no_page`). */
	skipped: string[]
	/** Pages that failed, with the reason. A non-empty list means the run aborted. */
	failed: Array<{page: string; reason: string}>
}

/**
 * Turns a migration result into a short human-readable summary line for
 * display in settings UIs.
 * @param result The migration result to summarize.
 */
export function summarizeMigrationResult (result: WikiMigrationResult,): string {
	const parts = [`${result.copied.length} page(s) copied`,]
	if (result.skipped.length > 0) { parts.push(`${result.skipped.length} skipped`,) }
	if (result.failed.length > 0) {
		parts.push(`failed at ${result.failed[0]!.page}: ${result.failed[0]!.reason}`,)
	}
	return parts.join(', ',)
}

/** The wiki revision note used for all migration writes. */
const MIGRATION_REASON = 'Toolbox-NXG wiki layout migration'

/**
 * Copies one raw (non-JSON) wiki page to another path, byte-for-byte.
 * Records the outcome in `result` and returns `false` when the run should
 * abort (read error other than `no_page`, or write failure).
 */
async function copyRawPage (
	subreddit: string,
	fromPage: string,
	toPage: string,
	result: WikiMigrationResult,
): Promise<boolean> {
	const response = await readFromWiki(subreddit, fromPage, false,)
	if (!response.ok) {
		if (response.reason === 'no_page') {
			result.skipped.push(fromPage,)
			return true
		}
		result.failed.push({page: fromPage, reason: response.reason,},)
		return false
	}
	try {
		await postToWiki(subreddit, toPage, response.data, MIGRATION_REASON, false, false,)
		result.copied.push(toPage,)
		return true
	} catch (error) {
		log.error(`Failed to write ${subreddit}/${toPage}:`, error,)
		result.failed.push({page: toPage, reason: describeError(error,),},)
		return false
	}
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
 * Copies one legacy note page to its NXG path, but only when the legacy side
 * is actually ahead: identical content is skipped, and when the two sides
 * diverge the newer revision wins (a blind copy could roll back an NXG edit
 * whose legacy mirror write had failed).
 * Records the outcome in `result` and returns `false` when the run should abort.
 */
async function copyNotePageNewerWins (
	subreddit: string,
	slug: string,
	result: WikiMigrationResult,
): Promise<boolean> {
	const fromPage = `${OLD_NOTE_PAGE_PREFIX}${slug}`
	const toPage = `${NEW_NOTE_PAGE_PREFIX}${slug}`

	const legacy = await readFromWiki(subreddit, fromPage, false,)
	if (!legacy.ok) {
		if (legacy.reason === 'no_page') {
			result.skipped.push(fromPage,)
			return true
		}
		result.failed.push({page: fromPage, reason: legacy.reason,},)
		return false
	}

	const nxg = await readFromWiki(subreddit, toPage, false,)
	if (nxg.ok) {
		if (nxg.data === legacy.data) {
			result.skipped.push(toPage,)
			return true
		}
		const [nxgTime, legacyTime,] = await Promise.all([
			latestRevisionTime(subreddit, toPage,),
			latestRevisionTime(subreddit, fromPage,),
		],)
		// Ties go to the canonical NXG side.
		if (legacyTime <= nxgTime) {
			result.skipped.push(toPage,)
			return true
		}
	}

	try {
		await postToWiki(subreddit, toPage, legacy.data, MIGRATION_REASON, false, false,)
		result.copied.push(toPage,)
		return true
	} catch (error) {
		log.error(`Failed to write ${subreddit}/${toPage}:`, error,)
		result.failed.push({page: toPage, reason: describeError(error,),},)
		return false
	}
}

/** Turns a thrown wiki write error into a short human-readable reason string. */
function describeError (error: unknown,): string {
	const response = (error as {response?: Response}).response
	if (response?.status === 403) { return 'no wiki write permission' }
	if (response?.status === 413) { return 'page too large' }
	if (response?.status) { return `write failed (HTTP ${response.status})` }
	return error instanceof Error ? error.message : String(error,)
}

/**
 * Resolves the note slugs to copy and the index object to write, reading the
 * source index page and falling back to scanning the wiki page listing.
 * @returns The index to write (or `null` to skip the index page entirely),
 *   or `'abort'` when the run should stop.
 */
async function resolveNoteIndex (
	subreddit: string,
	indexPage: string,
	notePrefix: string,
	result: WikiMigrationResult,
): Promise<SubredditNoteIndex | null | 'abort'> {
	const response = await readFromWiki<Record<string, unknown>>(subreddit, indexPage, true,)
	if (response.ok) {
		const normalized = normalizeIndex(response.data,)
		if (normalized) { return normalized }
	} else if (response.reason === 'unknown_error') {
		result.failed.push({page: indexPage, reason: response.reason,},)
		return 'abort'
	}

	// No usable index (missing or malformed) - rebuild one from the page listing.
	let pages: string[]
	try {
		pages = await getWikiPages(subreddit,)
	} catch (error) {
		log.error(`Failed to list wiki pages for /r/${subreddit}:`, error,)
		result.failed.push({page: indexPage, reason: 'could not list wiki pages',},)
		return 'abort'
	}
	const rebuilt = buildIndexFromWikiPages(pages, notePrefix,)
	if (rebuilt.notes.length === 0 && !response.ok) {
		// Nothing to migrate and no index page existed - don't create one.
		result.skipped.push(indexPage,)
		return null
	}
	return rebuilt
}

/**
 * Migrates a subreddit's toolbox data from the legacy paths to `toolbox-nxg/*`.
 * The legacy pages are never modified, so this is also safe to re-run at any
 * time to fold in 6.x edits or repair deleted NXG pages. Idempotent:
 * existing NXG pages are reconcile-merged (config, usernotes) or overwritten
 * from legacy data.
 *
 * **Recursion invariant:** this runs from inside `doResolveWikiLayout` while
 * the subreddit's in-flight resolution promise is held. Nothing in this call
 * graph may call `resolveWikiLayout`, `getWikiReadPath`, `getConfig`, or any
 * other layout-resolving helper for the same subreddit - it would await its
 * own resolution and deadlock. All wiki access here uses explicit
 * `OLD_/NEW_WIKI_PATHS`.
 * @param subreddit The subreddit to migrate.
 * @param compatibilityWrites The compat flag to embed in the NXG config and
 *   record in the layout cache. Defaults to `true` (6.x compat on).
 * @returns A per-page outcome report; a non-empty `failed` list means the run
 *   aborted and the layout cache was left untouched.
 */
export async function migrateSubredditToNxg (
	subreddit: string,
	{compatibilityWrites = true,}: {compatibilityWrites?: boolean} = {},
): Promise<WikiMigrationResult> {
	const result: WikiMigrationResult = {copied: [], skipped: [], failed: [],}

	// Permission pre-check: only mods can create the NXG pages. A wiki-perms
	// 403 on the first write also aborts below, but this catches the common
	// case without burning a write attempt.
	let moderatesSub = false
	try {
		moderatesSub = await isModSub(subreddit,)
	} catch (error) {
		log.warn(`Could not determine mod status for /r/${subreddit}:`, error,)
	}
	if (!moderatesSub) {
		result.failed.push({page: NEW_WIKI_PATHS.settings, reason: 'you do not moderate this subreddit',},)
		return result
	}

	// Step 1 (required): the main config. A missing or tombstoned toolbox page
	// yields a minimal NXG config - the toolbox-nxg page must exist either
	// way, since its existence is the bootstrapped signal.
	//
	// Re-runs must not clobber NXG-only state (stable ids, fields 6.x doesn't
	// know about), so when a readable NXG config already exists the legacy
	// page is reconcile-merged into it - adopting the 6.x-owned fields and
	// preserving ids by content match - instead of overwriting. Only a missing
	// or unreadable NXG config gets the full overwrite, the true repair path.
	const legacyConfig = await readFromWiki<Record<string, unknown>>(subreddit, OLD_WIKI_PATHS.settings, true,)
	let legacyData: ToolboxConfig | null = null
	if (legacyConfig.ok && !isTombstone(legacyConfig.data,)) {
		purifyObject(legacyConfig.data,)
		normalizeConfig(legacyConfig.data,)
		legacyData = legacyConfig.data
	} else if (!legacyConfig.ok && legacyConfig.reason !== 'no_page') {
		result.failed.push({page: OLD_WIKI_PATHS.settings, reason: legacyConfig.reason,},)
		return result
	}

	let storedNxgConfig: ToolboxConfig | null = null
	const existingNxg = await readFromWiki<Record<string, unknown>>(subreddit, NEW_WIKI_PATHS.settings, true,)
	if (existingNxg.ok) {
		purifyObject(existingNxg.data,)
		normalizeConfig(existingNxg.data,)
		storedNxgConfig = existingNxg.data
	}

	// Holds a ToolboxConfig, a legacy-config spread, or {} - a union the upcoming LegacyConfig model will type.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accumulator holding a full ToolboxConfig, a legacy-config spread, or {}, plus an injected COMPAT_WRITES_KEY bookkeeping field; ToolboxConfig (an interface) is not assignable to Record<string, unknown>
	let nxgConfig: Record<string, any>
	if (storedNxgConfig && legacyData && !legacyOwnedFieldsEqual(storedNxgConfig, legacyData,)) {
		nxgConfig = adoptLegacyConfigFields(storedNxgConfig, legacyData,)
	} else if (storedNxgConfig) {
		nxgConfig = storedNxgConfig
	} else {
		nxgConfig = legacyData ? {...legacyData,} : {}
	}

	// Skip the write when the stored page already says exactly this (same
	// 6.x-owned fields and same compat flag) - re-runs stay cheap.
	if (
		storedNxgConfig && nxgConfig === storedNxgConfig
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reads the injected COMPAT_WRITES_KEY bookkeeping field, which is not part of the ToolboxConfig interface
		&& (storedNxgConfig as Record<string, any>)[COMPAT_WRITES_KEY] === compatibilityWrites
	) {
		result.skipped.push(NEW_WIKI_PATHS.settings,)
	} else {
		nxgConfig[COMPAT_WRITES_KEY] = compatibilityWrites
		try {
			await postToWiki(subreddit, NEW_WIKI_PATHS.settings, nxgConfig, MIGRATION_REASON, true, false,)
			result.copied.push(NEW_WIKI_PATHS.settings,)
		} catch (error) {
			log.error(`Failed to write ${subreddit}/${NEW_WIKI_PATHS.settings}:`, error,)
			result.failed.push({page: NEW_WIKI_PATHS.settings, reason: describeError(error,),},)
			return result
		}
	}

	// Step 2: usernotes. Never raw-copied: the legacy page has a special 1MB
	// allowance from Reddit while NXG pages get the standard 512KB, so the
	// blob is decoded and re-written through the sharded layout (splitting
	// into multiple pages as needed). The legacy page is never modified.
	//
	// Re-runs must not clobber NXG-only state (archives, soft-deletions,
	// stable note indexes), so when a readable sharded layout already exists
	// the legacy page is reconcile-merged into it instead of overwriting.
	// Only a missing or unreadable NXG layout gets the full overwrite - the
	// true repair path, where that state is already gone.
	let storedNxgNotes: UserNotesData | null = null
	let nxgReadable = false
	try {
		const stored = await readShardedUsernotes(subreddit,)
		if (stored.kind === 'sharded') {
			storedNxgNotes = stored.notes
			nxgReadable = true
		}
	} catch (error) {
		log.warn(`Existing NXG usernotes for /r/${subreddit} are unreadable; rebuilding from legacy:`, error,)
	}

	try {
		if (nxgReadable && storedNxgNotes) {
			// Reconcile: fold any 6.x edits from the legacy page into the
			// canonical shards; nothing to do when they already agree.
			const reconciled = await reconcileFromLegacy(subreddit, storedNxgNotes,)
			if (reconciled.changed) {
				const {written,} = await writeShardedUsernotes(subreddit, reconciled.notes, MIGRATION_REASON,)
				result.copied.push(...written,)
			} else {
				result.skipped.push(NEW_WIKI_PATHS.usernotes,)
			}
		} else {
			const legacyNotes = await readFromWiki(subreddit, OLD_WIKI_PATHS.usernotes, false,)
			if (!legacyNotes.ok && legacyNotes.reason !== 'no_page') {
				result.failed.push({page: OLD_WIKI_PATHS.usernotes, reason: legacyNotes.reason,},)
				return result
			}
			if (!legacyNotes.ok) {
				result.skipped.push(OLD_WIKI_PATHS.usernotes,)
			} else {
				let raw: RawUsernotesBlob
				try {
					raw = JSON.parse(legacyNotes.data,) as RawUsernotesBlob
				} catch {
					throw new Error('legacy usernotes are not valid JSON',)
				}
				purifyObject(raw,)
				const decoded = await decodeUsernotesV6(raw, subreddit,)
				if (!decoded) { throw new Error('usernotes schema too old to be understood',) }
				// Seed the manifest's type definitions from the config migrated
				// in step 1 (falling back to the defaults).
				decoded.types = seedV6Types(decoded, nxgConfig['usernoteColors'] as UserNoteColor[] | undefined,)
				const {written,} = await writeShardedUsernotes(subreddit, decoded, MIGRATION_REASON,)
				result.copied.push(...written,)
			}
		}
	} catch (error) {
		log.error(`Failed to migrate ${subreddit} usernotes to the sharded layout:`, error,)
		result.failed.push({page: NEW_WIKI_PATHS.usernotes, reason: describeError(error,),},)
		return result
	}

	// Step 3: the subreddit-notes index, rebuilt from the page listing when
	// missing or malformed. When an NXG index already exists, the legacy one
	// is union-merged into it (6.x-created notes flow in, NXG-only entries
	// survive) instead of overwriting.
	const legacyIndex = await resolveNoteIndex(subreddit, OLD_WIKI_PATHS.notes, OLD_NOTE_PAGE_PREFIX, result,)
	if (legacyIndex === 'abort') { return result }

	let storedNxgIndex: SubredditNoteIndex | null = null
	const nxgIndexResponse = await readFromWiki<Record<string, unknown>>(subreddit, NEW_WIKI_PATHS.notes, true,)
	if (nxgIndexResponse.ok) {
		purifyObject(nxgIndexResponse.data,)
		storedNxgIndex = normalizeIndex(nxgIndexResponse.data,)
	}

	let index: SubredditNoteIndex | null
	let writeIndex: boolean
	if (storedNxgIndex && legacyIndex) {
		const merged = mergeLegacyIndex(storedNxgIndex, legacyIndex,)
		index = merged.index
		writeIndex = merged.changed
	} else {
		index = legacyIndex ?? storedNxgIndex
		writeIndex = legacyIndex !== null && storedNxgIndex === null
	}

	if (index !== null) {
		if (writeIndex) {
			try {
				await postToWiki(subreddit, NEW_WIKI_PATHS.notes, index, MIGRATION_REASON, true, false,)
				result.copied.push(NEW_WIKI_PATHS.notes,)
			} catch (error) {
				log.error(`Failed to write ${subreddit}/${NEW_WIKI_PATHS.notes}:`, error,)
				result.failed.push({page: NEW_WIKI_PATHS.notes, reason: describeError(error,),},)
				return result
			}
		} else {
			result.skipped.push(NEW_WIKI_PATHS.notes,)
		}

		// Step 4: each individual note page from the index, newer-wins when
		// both sides exist and differ (a blind legacy->NXG copy could roll
		// back an NXG edit whose mirror write failed).
		for (const {slug,} of index.notes) {
			if (slug === 'index') { continue }
			const copied = await copyNotePageNewerWins(subreddit, slug, result,)
			if (!copied) { return result }
		}
	}

	// Step 5: the user-settings backup page.
	if (!await copyRawPage(subreddit, OLD_WIKI_PATHS.userSettings, NEW_WIKI_PATHS.userSettings, result,)) {
		return result
	}

	const layout: WikiLayout = {subreddit, state: 'nxg', compatibilityWrites,}
	await setCachedWikiLayout(layout, true,)
	log.debug(`Migrated /r/${subreddit} to NXG layout:`, result,)
	return result
}

/**
 * Creates the `toolbox-nxg` config page for a subreddit with no toolbox data
 * at all: the default config plus `compatibilityWrites: false`. The usernotes
 * manifest and notes index stay lazily created on their first save - one wiki
 * edit is all a fresh sub costs. Mod-gated like {@link migrateSubredditToNxg}.
 *
 * **Recursion invariant:** runs from inside `doResolveWikiLayout` while the
 * in-flight resolution promise is held; nothing here may call
 * `resolveWikiLayout` or helpers that do.
 * @param subreddit The subreddit to bootstrap.
 * @returns A per-page outcome report; a non-empty `failed` list means nothing
 *   was created and the layout cache was left untouched.
 */
export async function bootstrapFreshSub (subreddit: string,): Promise<WikiMigrationResult> {
	const result: WikiMigrationResult = {copied: [], skipped: [], failed: [],}

	let moderatesSub = false
	try {
		moderatesSub = await isModSub(subreddit,)
	} catch (error) {
		log.warn(`Could not determine mod status for /r/${subreddit}:`, error,)
	}
	if (!moderatesSub) {
		result.failed.push({page: NEW_WIKI_PATHS.settings, reason: 'you do not moderate this subreddit',},)
		return result
	}

	const nxgConfig: Record<string, unknown> = {...defaultToolboxConfig, [COMPAT_WRITES_KEY]: false,}
	try {
		await postToWiki(subreddit, NEW_WIKI_PATHS.settings, nxgConfig, MIGRATION_REASON, true, false,)
		result.copied.push(NEW_WIKI_PATHS.settings,)
	} catch (error) {
		log.error(`Failed to write ${subreddit}/${NEW_WIKI_PATHS.settings}:`, error,)
		result.failed.push({page: NEW_WIKI_PATHS.settings, reason: describeError(error,),},)
		return result
	}

	// The sub may be in the noConfig negative cache from an earlier session
	// (before the default page existed); drop it so the new page is found.
	const cachedSubsWithNoConfig = await getCache(utils, 'noConfig', [],) as string[]
	if (cachedSubsWithNoConfig.includes(subreddit,)) {
		await setCache(utils, 'noConfig', cachedSubsWithNoConfig.filter((cached,) => cached !== subreddit),)
	}

	await setCachedWikiLayout({subreddit, state: 'nxg', compatibilityWrites: false,}, true,)
	log.debug(`Bootstrapped /r/${subreddit} with a default NXG config page`,)
	return result
}

/**
 * Reverse copy: NXG pages -> legacy pages. Used when 6.x compatibility is
 * turned back on after a period of NXG-only writes, so 6.x mods resume with
 * current data. The NXG pages are never modified.
 * @param subreddit The subreddit to copy.
 * @returns A per-page outcome report; a non-empty `failed` list means the run aborted.
 */
export async function copyNxgToLegacy (subreddit: string,): Promise<WikiMigrationResult> {
	const result: WikiMigrationResult = {copied: [], skipped: [], failed: [],}

	let moderatesSub = false
	try {
		moderatesSub = await isModSub(subreddit,)
	} catch (error) {
		log.warn(`Could not determine mod status for /r/${subreddit}:`, error,)
	}
	if (!moderatesSub) {
		result.failed.push({page: OLD_WIKI_PATHS.settings, reason: 'you do not moderate this subreddit',},)
		return result
	}

	// Required: the main config. The legacy copy gets the classic v1 schema -
	// escape()-encoded text fields, limited-HTML fill-in fields, and no NXG
	// metadata keys - because 6.x parses it directly and rewrites the page
	// wholesale on save. normalizeConfig first brings the NXG data to the
	// current v2 shape (a no-op when it already is), so the down-convert
	// always starts from a known schema.
	const nxgConfig = await readFromWiki<Record<string, unknown>>(subreddit, NEW_WIKI_PATHS.settings, true,)
	if (!nxgConfig.ok) {
		result.failed.push({page: NEW_WIKI_PATHS.settings, reason: nxgConfig.reason,},)
		return result
	}
	purifyObject(nxgConfig.data,)
	normalizeConfig(nxgConfig.data,)

	// 6.x reads domain tags and usernote colors straight from the config page,
	// but NXG keeps them on their own pages. Read both NXG sources up front so
	// the classic down-convert below can re-inject them; the usernotes read is
	// also reused for the v6 usernotes copy further down. A usernotes read
	// failure aborts before the config write so the legacy pages don't end up
	// half-migrated.
	let domainTags: DomainTag[] | undefined
	const domainTagsPage = await readFromWiki<Record<string, unknown>>(subreddit, DOMAIN_TAGS_PAGE, true,)
	if (domainTagsPage.ok) {
		purifyObject(domainTagsPage.data,)
		domainTags = decodeDomainTagsPage(domainTagsPage.data, subreddit,)?.tags
	}

	// Usernotes: merge the sharded NXG layout back into a single v6 blob for
	// the legacy page (whose literal path has a special 1MB allowance). The
	// v6 encoder writes *active* notes only - archived and soft-deleted notes
	// stay NXG-only, which is also what lets reconciliation treat legacy-page
	// deviations as 6.x edits. When the active notes exceed the allowance the
	// copy - and therefore the compat toggle sequencing it - fails with a
	// clear reason. The manifest's embedded type definitions don't survive
	// the trip in the usernotes page; 6.x reads types from the config's
	// `usernoteColors`, written from the same manifest just below.
	let nxgNotes
	try {
		nxgNotes = await readShardedUsernotes(subreddit,)
	} catch (error) {
		log.error(`Failed to read ${subreddit} sharded usernotes:`, error,)
		result.failed.push({page: NEW_WIKI_PATHS.usernotes, reason: describeError(error,),},)
		return result
	}
	const usernoteColors = nxgNotes.kind === 'sharded' ? nxgNotes.manifest.types : undefined

	try {
		await postToWiki(
			subreddit,
			OLD_WIKI_PATHS.settings,
			encodeClassicConfig(nxgConfig.data, domainTags, usernoteColors,),
			MIGRATION_REASON,
			true,
			false,
		)
		result.copied.push(OLD_WIKI_PATHS.settings,)
	} catch (error) {
		log.error(`Failed to write ${subreddit}/${OLD_WIKI_PATHS.settings}:`, error,)
		result.failed.push({page: OLD_WIKI_PATHS.settings, reason: describeError(error,),},)
		return result
	}

	if (nxgNotes.kind === 'no_page') {
		result.skipped.push(NEW_WIKI_PATHS.usernotes,)
	} else {
		try {
			await postToWiki(
				subreddit,
				OLD_WIKI_PATHS.usernotes,
				encodeUsernotesV6(nxgNotes.notes,),
				MIGRATION_REASON,
				true,
				false,
			)
			result.copied.push(OLD_WIKI_PATHS.usernotes,)
		} catch (error) {
			log.error(`Failed to write ${subreddit}/${OLD_WIKI_PATHS.usernotes}:`, error,)
			const e = error as {response?: Response}
			const reason = e.response?.status === 413
				? 'merged usernotes exceed the legacy page\'s 1MB limit - '
					+ '6.x compatibility cannot be enabled for this subreddit'
				: describeError(error,)
			result.failed.push({page: OLD_WIKI_PATHS.usernotes, reason,},)
			return result
		}
	}

	const index = await resolveNoteIndex(subreddit, NEW_WIKI_PATHS.notes, NEW_NOTE_PAGE_PREFIX, result,)
	if (index === 'abort') { return result }
	if (index !== null) {
		try {
			// The legacy page gets the v1 index shape older builds expect.
			await postToWiki(subreddit, OLD_WIKI_PATHS.notes, encodeLegacyIndex(index,), MIGRATION_REASON, true, false,)
			result.copied.push(OLD_WIKI_PATHS.notes,)
		} catch (error) {
			log.error(`Failed to write ${subreddit}/${OLD_WIKI_PATHS.notes}:`, error,)
			result.failed.push({page: OLD_WIKI_PATHS.notes, reason: describeError(error,),},)
			return result
		}
		for (const {slug,} of index.notes) {
			if (slug === 'index') { continue }
			const copied = await copyRawPage(
				subreddit,
				`${NEW_NOTE_PAGE_PREFIX}${slug}`,
				`${OLD_NOTE_PAGE_PREFIX}${slug}`,
				result,
			)
			if (!copied) { return result }
		}
	}

	if (!await copyRawPage(subreddit, NEW_WIKI_PATHS.userSettings, OLD_WIKI_PATHS.userSettings, result,)) {
		return result
	}

	log.debug(`Copied /r/${subreddit} NXG pages back to legacy paths:`, result,)
	return result
}

/**
 * Toggles 6.x compatibility mode for a subreddit. The NXG pages are always
 * canonical; the flag only controls whether the legacy mirror is maintained.
 * Sequencing keeps both sides intact:
 *
 * - **Turning on:** copy NXG -> legacy first (so 6.x mods resume with current
 *   data, and any tombstone is replaced with a real config), then record the
 *   flag.
 * - **Turning off:** run one final reconcile-merge from the legacy pages
 *   (folding in any outstanding 6.x edits before the mirror is abandoned),
 *   then tombstone the legacy `toolbox` page so 6.x users see the sub has
 *   moved.
 *
 * Clears the toolbox cache on success so all reads re-resolve.
 * @param subreddit The subreddit to toggle.
 * @param enabled The new compatibility state.
 * @returns The outcome report of the underlying copy; a non-empty `failed`
 *   list means nothing was toggled.
 */
export async function setCompatibilityMode (subreddit: string, enabled: boolean,): Promise<WikiMigrationResult> {
	if (enabled) {
		const result = await copyNxgToLegacy(subreddit,)
		if (result.failed.length > 0) { return result }

		// Record the flag inside the NXG config page (the one page 6.x never
		// rewrites, so the flag can't be stripped).
		const nxgConfig = await readFromWiki<Record<string, unknown>>(subreddit, NEW_WIKI_PATHS.settings, true,)
		if (!nxgConfig.ok) {
			result.failed.push({page: NEW_WIKI_PATHS.settings, reason: nxgConfig.reason,},)
			return result
		}
		nxgConfig.data[COMPAT_WRITES_KEY] = true
		try {
			await postToWiki(subreddit, NEW_WIKI_PATHS.settings, nxgConfig.data, MIGRATION_REASON, true, false,)
			result.copied.push(NEW_WIKI_PATHS.settings,)
		} catch (error) {
			result.failed.push({page: NEW_WIKI_PATHS.settings, reason: describeError(error,),},)
			return result
		}

		await clearCache()
		clearSessionShardState(subreddit,)
		await setCachedWikiLayout({subreddit, state: 'nxg', compatibilityWrites: true,}, true,)
		return result
	}

	// Turning off: the refresh embeds the new flag value and records the
	// layout; the tombstone tells 6.x users (and a future bootstrap without
	// the NXG pages) that this sub has moved.
	const result = await migrateSubredditToNxg(subreddit, {compatibilityWrites: false,},)
	if (result.failed.length > 0) { return result }
	try {
		await postToWiki(
			subreddit,
			OLD_WIKI_PATHS.settings,
			{[WIKI_LAYOUT_KEY]: 'nxg',},
			MIGRATION_REASON,
			true,
			false,
		)
		result.copied.push(OLD_WIKI_PATHS.settings,)
	} catch (error) {
		result.failed.push({page: OLD_WIKI_PATHS.settings, reason: describeError(error,),},)
		return result
	}

	await clearCache()
	clearSessionShardState(subreddit,)
	await setCachedWikiLayout({subreddit, state: 'nxg', compatibilityWrites: false,}, true,)
	return result
}
