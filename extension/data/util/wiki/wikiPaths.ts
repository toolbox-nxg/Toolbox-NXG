/**
 * Central wiki layout resolver for the toolbox-nxg wiki page namespace.
 *
 * Toolbox historically scattered its wiki data across several separately-named
 * pages (`toolbox`, `usernotes`, `notes/index`, `notes/{slug}`, `tbsettings`).
 * NXG gathers all of them under a `toolbox-nxg/` namespace, and the NXG pages
 * are always canonical. This module is the single authority on which paths to
 * read and write for a given subreddit:
 *
 * - **`nxg`** subs read NXG paths and write them first. With 6.x compatibility
 *   ON, the legacy paths are maintained as a derived mirror: writes fan out to
 *   them second (non-fatally), and reads reconcile any 6.x edits found on the
 *   mirror back into the canonical data.
 * - **`legacyFallback`** subs have legacy data but no NXG pages and no way to
 *   create them (the user doesn't mod the sub, or bootstrap failed). Reads and
 *   writes stay on the legacy paths so nothing is lost; a later successful
 *   bootstrap folds that data in.
 *
 * The first resolution of a sub the user moderates bootstraps it into the
 * `nxg` state: legacy data is migrated (with compatibility ON so 6.x mods
 * lose nothing), and data-less subs get a default `toolbox-nxg` config page.
 *
 * The bootstrapped signal is the existence of the `toolbox-nxg` wiki page; the
 * compatibility flag lives inside it (6.x never touches that page, so the
 * flag can't be stripped by a 6.x save the way it would be on `toolbox`).
 */

import {isModSub,} from '../../api/resources/modSubs'
import {readFromWiki,} from '../../api/resources/wiki'
import {utils,} from '../../framework/moduleIds'
import {negativeTextFeedback,} from '../../store/feedback'
import createLogger from '../infra/logging'
import {getCache,} from '../persistence/cache'
import {
	COMPAT_WRITES_KEY,
	isTombstone,
	NEW_NOTE_PAGE_PREFIX,
	NEW_WIKI_PATHS,
	OLD_NOTE_PAGE_PREFIX,
	OLD_WIKI_PATHS,
	WikiPageName,
} from './wikiConstants'
import {LAYOUT_CACHE_KEY, sessionLayouts, setCachedWikiLayout,} from './wikiLayoutCache'
import type {WikiLayout,} from './wikiLayoutCache'
import {bootstrapFreshSub, migrateSubredditToNxg,} from './wikiMigration'

const log = createLogger('TBWikiPaths',)

// Coalesces concurrent resolutions (and the migration they may trigger) for
// the same subreddit onto a single in-flight promise.
const inFlightResolutions = new Map<string, Promise<WikiLayout>>()

/** Options controlling a wiki-layout resolution. */
export interface ResolveWikiLayoutOptions {
	/**
	 * Resolve even when the viewer does not moderate the sub. Off by default so a
	 * non-moderated sub short-circuits to a `notModerated` layout without firing
	 * any wiki reads. Opt in only for legitimate cross-sub reads (e.g. removal
	 * reasons following a `getfrom` redirect into a sub you don't moderate).
	 */
	allowNonModerated?: boolean
}

/**
 * Resolves the current wiki layout for a subreddit. Checks the local cache
 * first (performance hint), then falls back to reading the wiki: the
 * `toolbox-nxg` page first, then `toolbox`, then a legacy `usernotes` probe.
 * Read-only - migration to the NXG layout is opt-in via the Wiki Layout
 * settings section ({@link util/wiki/wikiMigration!migrateSubredditToNxg}).
 * Never silently downgrades a migrated subreddit to legacy reads.
 *
 * For subs the viewer does not moderate, resolution short-circuits to a
 * `notModerated` layout without any wiki read (Toolbox has no business reading
 * a non-moderated sub's config); pass `allowNonModerated` to override that for
 * legitimate cross-sub reads.
 * @param subreddit The subreddit to resolve.
 * @param options Resolution options (see {@link ResolveWikiLayoutOptions}).
 */
export async function resolveWikiLayout (
	subreddit: string,
	options: ResolveWikiLayoutOptions = {},
): Promise<WikiLayout> {
	return cachedResolve(subreddit, false, options,)
}

/**
 * Like {@link resolveWikiLayout}, but never shows feedback toasts. Used by
 * the settings UI, which displays problems like missing NXG pages in-place.
 * @param subreddit The subreddit to inspect.
 * @param options Resolution options (see {@link ResolveWikiLayoutOptions}).
 */
export async function peekWikiLayout (
	subreddit: string,
	options: ResolveWikiLayoutOptions = {},
): Promise<WikiLayout> {
	return cachedResolve(subreddit, true, options,)
}

/** Cache/in-flight handling shared by {@link resolveWikiLayout} and {@link peekWikiLayout}. */
async function cachedResolve (
	subreddit: string,
	silent: boolean,
	options: ResolveWikiLayoutOptions,
): Promise<WikiLayout> {
	const sessionHit = sessionLayouts.get(subreddit,)
	if (sessionHit) { return sessionHit }

	// First caller wins: concurrent resolutions of the same sub share one
	// in-flight promise regardless of which entry point started it.
	const inFlight = inFlightResolutions.get(subreddit,)
	if (inFlight) { return inFlight }

	const resolution = doResolveWikiLayout(subreddit, silent, options,).finally(() => {
		inFlightResolutions.delete(subreddit,)
	},)
	inFlightResolutions.set(subreddit, resolution,)
	return resolution
}

/**
 * Uncached resolution logic behind {@link resolveWikiLayout}.
 * @param subreddit The subreddit to resolve.
 * @param silent Whether to suppress feedback toasts (settings-UI peeks).
 * @param options Resolution options (see {@link ResolveWikiLayoutOptions}).
 */
async function doResolveWikiLayout (
	subreddit: string,
	silent: boolean,
	options: ResolveWikiLayoutOptions,
): Promise<WikiLayout> {
	// Default-deny reads for subs the viewer doesn't moderate: skip all wiki work
	// and report `notModerated`, which readers treat as "no config / no notes".
	// Done before the persistent-cache read so it also neutralizes any stale
	// `legacyFallback/notMod` entries left by older builds. `isModSub` is in-memory
	// cached after its first call, so this costs nothing on subsequent resolutions.
	if (!options.allowNonModerated) {
		let moderates = true // fail-open on lookup error: never hide a real mod's config
		try {
			moderates = await isModSub(subreddit,)
		} catch (error) {
			log.warn(`Could not determine mod status for /r/${subreddit}; resolving normally:`, error,)
		}
		if (!moderates) {
			const layout: WikiLayout = {subreddit, state: 'nxg', compatibilityWrites: false, notModerated: true,}
			// Session-only: getting modded later re-resolves on the next page session.
			await setCachedWikiLayout(layout, false,)
			return layout
		}
	}

	const persisted = await getCache(utils, LAYOUT_CACHE_KEY, {},) as Record<string, WikiLayout>
	const cached = persisted[subreddit]
	if (cached !== undefined) {
		sessionLayouts.set(subreddit, cached,)
		return cached
	}

	const nxgResponse = await readFromWiki<Record<string, any>>(subreddit, NEW_WIKI_PATHS.settings, true,)
	if (nxgResponse.ok) {
		// The NXG page exists -> bootstrapped. The compat flag is written
		// explicitly on every NXG config save, so absence means external
		// tampering; fall back on whether a real legacy config exists.
		let compatibilityWrites = nxgResponse.data[COMPAT_WRITES_KEY]
		if (typeof compatibilityWrites !== 'boolean') {
			const legacyResponse = await readFromWiki<Record<string, any>>(subreddit, OLD_WIKI_PATHS.settings, true,)
			compatibilityWrites = legacyResponse.ok && !isTombstone(legacyResponse.data,)
		}
		const layout: WikiLayout = {subreddit, state: 'nxg', compatibilityWrites,}
		await setCachedWikiLayout(layout, true,)
		return layout
	}

	const legacyResponse = await readFromWiki<Record<string, any>>(subreddit, OLD_WIKI_PATHS.settings, true,)

	if (legacyResponse.ok && isTombstone(legacyResponse.data,)) {
		// The sub was bootstrapped and compat turned off, but toolbox-nxg is
		// gone: the NXG pages were deleted externally. Surface the problem
		// instead of silently reading stale legacy data. Writes still target
		// NXG paths so a save can recreate them.
		log.error(`NXG pages missing for /r/${subreddit} despite tombstone`,)
		if (!silent && nxgResponse.reason === 'no_page') {
			negativeTextFeedback(
				`Toolbox-NXG wiki pages for /r/${subreddit} are missing. `
					+ 'Run "Restore from legacy pages" in the toolbox settings to repair.',
			)
		}
		const layout: WikiLayout = {subreddit, state: 'nxg', compatibilityWrites: false, nxgMissing: true,}
		// Session-only: the missing pages may be restored at any moment.
		await setCachedWikiLayout(layout, false,)
		return layout
	}

	if (nxgResponse.reason !== 'no_page') {
		// Transient/unknown failure reading toolbox-nxg: we can't tell whether
		// the sub is bootstrapped. Decide conservatively from the legacy page
		// without caching persistently or kicking off a bootstrap: legacy data
		// present means legacy reads still show something sensible; tombstoned
		// subs are caught by the branch above.
		const layout: WikiLayout = legacyResponse.ok || legacyResponse.reason === 'invalid_json'
			? {subreddit, state: 'legacyFallback', compatibilityWrites: false, fallbackReason: 'resolveError',}
			: {subreddit, state: 'nxg', compatibilityWrites: false,}
		await setCachedWikiLayout(layout, false,)
		return layout
	}

	// toolbox-nxg does not exist. An invalid_json toolbox page still counts as
	// legacy data (the sub has *something* there, even if 6.x can't parse it
	// either); a missing toolbox page falls through to the usernotes probe,
	// covering teams that only ever used usernotes.
	let hasLegacyData = legacyResponse.ok || legacyResponse.reason === 'invalid_json'
	if (!hasLegacyData) {
		const usernotesProbe = await readFromWiki(subreddit, OLD_WIKI_PATHS.usernotes, false,)
		hasLegacyData = usernotesProbe.ok
	}

	// First touch of an un-bootstrapped sub. Mods get the NXG pages created
	// right here: legacy data is migrated (compat ON so 6.x mods lose
	// nothing), data-less subs get a default config page. Non-mods can't
	// create pages, so they stay on read-only legacy paths (or empty NXG).
	let moderatesSub = false
	try {
		moderatesSub = await isModSub(subreddit,)
	} catch (error) {
		log.warn(`Could not determine mod status for /r/${subreddit}:`, error,)
	}

	if (!moderatesSub) {
		// legacyFallback/notMod is stable and persistable (the TTL re-checks
		// in case the user is modded later); the data-less case stays
		// session-only so getting modded triggers a bootstrap next session.
		const layout: WikiLayout = hasLegacyData
			? {subreddit, state: 'legacyFallback', compatibilityWrites: false, fallbackReason: 'notMod',}
			: {subreddit, state: 'nxg', compatibilityWrites: false,}
		await setCachedWikiLayout(layout, hasLegacyData,)
		return layout
	}

	// Both bootstrap helpers record the layout cache themselves on success.
	// They never resolve layouts internally (see their recursion invariant),
	// so calling them while this sub's in-flight promise is held cannot
	// deadlock - and that same promise coalesces concurrent first touches
	// into this single bootstrap.
	const result = hasLegacyData
		? await migrateSubredditToNxg(subreddit, {compatibilityWrites: true,},)
		: await bootstrapFreshSub(subreddit,)
	if (result.failed.length === 0) {
		const layout: WikiLayout = {subreddit, state: 'nxg', compatibilityWrites: hasLegacyData,}
		sessionLayouts.set(subreddit, layout,)
		return layout
	}

	const failure = result.failed[0]!
	log.error(`Could not bootstrap /r/${subreddit} onto the NXG layout: ${failure.page}: ${failure.reason}`,)
	if (!silent) {
		negativeTextFeedback(
			`Could not set up the toolbox-nxg wiki pages for /r/${subreddit} (${failure.reason}). `
				+ (hasLegacyData
					? 'Using the legacy pages for now; setup retries automatically.'
					: 'Setup retries automatically.'),
		)
	}
	// Session-only degraded states: the next session (or a manual retry from
	// the settings UI) attempts the bootstrap again.
	const layout: WikiLayout = hasLegacyData
		? {subreddit, state: 'legacyFallback', compatibilityWrites: false, fallbackReason: 'bootstrapFailed',}
		: {subreddit, state: 'nxg', compatibilityWrites: false,}
	await setCachedWikiLayout(layout, false,)
	return layout
}

/**
 * Returns `true` when the layout maintains the legacy 6.x mirror: writes fan
 * out to the legacy paths second, and reads reconcile 6.x edits found there
 * back into the canonical NXG data. Always `false` for `legacyFallback` subs
 * (which write legacy *only*) and for subs with missing NXG pages.
 */
export function compatMirrorEnabled (layout: WikiLayout,): boolean {
	return layout.state === 'nxg' && layout.compatibilityWrites && !layout.nxgMissing
}

/**
 * Returns the single canonical read path for a logical wiki page: the NXG
 * path, except for `legacyFallback` subs (which have no NXG pages to read).
 * @param name The logical page name.
 * @param subreddit The subreddit to resolve for.
 */
export async function getWikiReadPath (name: WikiPageName, subreddit: string,): Promise<string> {
	const layout = await resolveWikiLayout(subreddit,)
	return layout.state === 'legacyFallback' ? OLD_WIKI_PATHS[name] : NEW_WIKI_PATHS[name]
}

/**
 * Returns one or more write paths for a logical wiki page, canonical first.
 * Subs with compat on return `[nxg, legacy]`; compat-off subs return `[nxg]`;
 * `legacyFallback` subs return `[legacy]`.
 *
 * Contract for writers: index 0 is canonical and its failure is fatal to the
 * save; any subsequent entries are mirrors whose failure is non-fatal (warn
 * and continue - the next successful save refreshes them).
 * @param name The logical page name.
 * @param subreddit The subreddit to resolve for.
 */
export async function getWikiWritePaths (name: WikiPageName, subreddit: string,): Promise<string[]> {
	const layout = await resolveWikiLayout(subreddit,)
	if (layout.state === 'legacyFallback') { return [OLD_WIKI_PATHS[name],] }
	if (compatMirrorEnabled(layout,)) {
		return [NEW_WIKI_PATHS[name], OLD_WIKI_PATHS[name],]
	}
	return [NEW_WIKI_PATHS[name],]
}

/**
 * Returns the note page prefix for the subreddit's current canonical layout,
 * used to derive slugs when scanning wiki page listings.
 * @param subreddit The subreddit to resolve for.
 */
export async function getNotePagePrefix (subreddit: string,): Promise<string> {
	const layout = await resolveWikiLayout(subreddit,)
	return layout.state === 'legacyFallback' ? OLD_NOTE_PAGE_PREFIX : NEW_NOTE_PAGE_PREFIX
}

/**
 * Returns the canonical read path for an individual subreddit note's slug.
 * @param slug The note slug (page name suffix after the notes prefix).
 * @param subreddit The subreddit to resolve for.
 */
export async function getNoteReadPath (slug: string, subreddit: string,): Promise<string> {
	const prefix = await getNotePagePrefix(subreddit,)
	return `${prefix}${slug}`
}

/**
 * Returns one or more write paths for an individual subreddit note's slug,
 * canonical first, mirroring {@link getWikiWritePaths} fan-out semantics.
 * @param slug The note slug (page name suffix after the notes prefix).
 * @param subreddit The subreddit to resolve for.
 */
export async function getNoteWritePaths (slug: string, subreddit: string,): Promise<string[]> {
	const layout = await resolveWikiLayout(subreddit,)
	if (layout.state === 'legacyFallback') { return [`${OLD_NOTE_PAGE_PREFIX}${slug}`,] }
	if (compatMirrorEnabled(layout,)) {
		return [`${NEW_NOTE_PAGE_PREFIX}${slug}`, `${OLD_NOTE_PAGE_PREFIX}${slug}`,]
	}
	return [`${NEW_NOTE_PAGE_PREFIX}${slug}`,]
}
