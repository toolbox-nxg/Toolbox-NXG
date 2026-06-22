/** Public API for reading and writing the toolbox wiki config page, with caching and legacy normalization. */
import {getWikiRevisions, postToWiki as apiPostToWiki, readFromWiki, readWikiRevision,} from '../../api/resources/wiki'
import {writeWikiPageConditional,} from '../../api/resources/wikiVersioned'
import {utils,} from '../../framework/moduleIds'
import {negativeTextFeedback, neutralTextFeedback, positiveTextFeedback,} from '../../store/feedback'
import {unescapeJSON, zlibDeflate, zlibInflate,} from '../../util/data/encoding'
import {purifyHTML, purifyObject,} from '../../util/data/purify'
import createLogger from '../../util/infra/logging'
import {createPerKeyQueue,} from '../../util/infra/perKeyQueue'
import {clearCache, getCache, setCache,} from '../../util/persistence/cache'
import {isUserProfileSubreddit,} from '../../util/reddit/profileSubreddit'
import {configCodec, encodeClassicConfig,} from '../../util/wiki/schemas/config/codec'
import {reconcileConfigFromLegacy,} from '../../util/wiki/schemas/config/reconcile'
import {normalizeConfig, ToolboxConfig,} from '../../util/wiki/schemas/config/schema'
import {NXG_USERNOTES_FORMAT,} from '../../util/wiki/schemas/usernotes/schema'
import {COMPAT_WRITES_KEY, NEW_WIKI_PATHS, OLD_WIKI_PATHS,} from '../../util/wiki/wikiConstants'
import {compatMirrorEnabled, getWikiWritePaths, resolveWikiLayout,} from '../../util/wiki/wikiPaths'
import {getDomainTagsData,} from '../domaintagger/moduleapi'
import {getSubredditColors,} from '../shared/usernotes/moduleapi'

const log = createLogger('TBConfig',)

/**
 * Cache key holding a `Record<string, string>` of subreddit -> the canonical-config-page
 * revision that subreddit's cached/last-read config was based on. A save conditions its
 * write on this so a concurrent edit elsewhere is detected (and warned about) rather than
 * silently clobbered. Stashed when {@link getConfig} reads the page, and wiped by
 * {@link clearCache} after a save so the next read re-stashes a fresh revision.
 *
 * It lives in the persistent cache (not in memory) so it stays in lockstep with the
 * `configCache` entry it guards: a cache-hit read in another tab, or in the same tab
 * after a reload, still has a base revision to condition on. An absent entry (e.g. config
 * built without a preceding read) -> the write falls back to last-write-wins, matching the
 * pre-detection behavior. Registered on the long-TTL list so it expires with `configCache`.
 */
const CONFIG_REV_KEY = 'configRev'

/** Records the revision a freshly-read config is based on, for the next save's guard. */
async function stashConfigRev (subreddit: string, page: string,): Promise<void> {
	try {
		const revisions = await getWikiRevisions(subreddit, page, 1,)
		const rev = revisions[0]?.id
		if (rev) {
			const revs = await getCache(utils, CONFIG_REV_KEY, {},) as Record<string, string>
			revs[subreddit] = rev
			await setCache(utils, CONFIG_REV_KEY, revs,)
		}
	} catch (err) {
		// A failed revision lookup just means no conflict guard on the next save
		// (last-write-wins) - never block the config read on it.
		log.debug(`could not read config revision for /r/${subreddit}`, err,)
	}
}

/**
 * The outcome of a config read, distinguishing the three cases callers that care about
 * safety must not conflate:
 * - `ok` - the config was read and normalized (`config` is the result).
 * - `absent` - the subreddit has **no** toolbox wiki page (a definite "no config"), cached
 *   so later reads short-circuit.
 * - `error` - the read failed (transient network/API error, or unparseable content), so the
 *   config is **unknown**. Not cached: a later read re-attempts.
 *
 * {@link getConfig} collapses `absent`/`error` to `undefined` for the many callers that
 * treat "no config" the same either way; safety-sensitive callers (training-mode capture)
 * use this richer result so they can fail safe on `error` instead of assuming "no config".
 */
export type ConfigReadResult =
	| {status: 'ok'; config: ToolboxConfig}
	| {status: 'absent'}
	| {status: 'error'}

/** Options controlling a config read. */
export interface GetConfigOptions {
	/**
	 * Read even when the viewer does not moderate the sub. Off by default so a
	 * non-moderated sub reports `absent` without firing any wiki read. Opt in only
	 * for legitimate cross-sub reads (e.g. removal reasons following a `getfrom`
	 * redirect into a sub you don't moderate).
	 */
	allowNonModerated?: boolean
}

/**
 * Retrieves the toolbox config for a subreddit (cached), returning a discriminated result
 * that distinguishes "no config page" from "could not read the config". Most callers want
 * {@link getConfig}; use this only when an unreadable config must be handled differently
 * from a missing one.
 * @param subreddit The subreddit name to fetch config for.
 * @param options Read options (see {@link GetConfigOptions}).
 */
export async function tryGetConfig (
	subreddit: string,
	options: GetConfigOptions = {},
): Promise<ConfigReadResult> {
	// A user-profile pseudo-subreddit (`u_<username>`) has no toolbox wiki - Reddit lists
	// the viewer's own profile among their moderated subs, so config reads would otherwise
	// fire three doomed wiki requests per profile page. There is definitively no config
	// there, so report `absent` without touching the wiki or the layout resolver.
	if (isUserProfileSubreddit(subreddit,)) {
		return {status: 'absent',}
	}

	const cachedSubsWithNoConfig = await getCache(utils, 'noConfig', [],) as string[]
	if (cachedSubsWithNoConfig.includes(subreddit,)) {
		return {status: 'absent',}
	}

	const cachedConfigs = await getCache(utils, 'configCache', {},) as Record<string, ToolboxConfig>
	if (cachedConfigs[subreddit] !== undefined) {
		// Only serve from cache when we also have the companion base revision this config was
		// read from. Without it a later save can't condition its write and silently degrades
		// to last-write-wins. So a cached config that is missing its rev - an entry written by
		// a pre-rev-tracking build, or one whose rev stash failed - is treated as a cache miss:
		// fall through to a fresh read that re-stashes the rev, keeping guarded edits safe.
		const revs = await getCache(utils, CONFIG_REV_KEY, {},) as Record<string, string>
		if (revs[subreddit] !== undefined) {
			normalizeConfig(cachedConfigs[subreddit],)
			return {status: 'ok', config: cachedConfigs[subreddit]!,}
		}
	}

	// Resolve the layout once: it picks the read path and tells us whether
	// the legacy mirror needs reconciling. The resolver also gates non-moderated
	// subs (no opt-in) to a `notModerated` layout without any wiki read - a
	// definite "no config", so report `absent` before reading the settings page.
	const layout = await resolveWikiLayout(subreddit, options,)
	if (layout.notModerated) {
		return {status: 'absent',}
	}
	const page = layout.state === 'legacyFallback' ? OLD_WIKI_PATHS.settings : NEW_WIKI_PATHS.settings
	const response = await readFromWiki<Record<string, any>>(subreddit, page, true,)
	if (!response.ok) {
		if (response.reason === 'no_page') {
			// A definite "this sub has no toolbox config" - cache it and report absent.
			cachedSubsWithNoConfig.push(subreddit,)
			setCache(utils, 'noConfig', cachedSubsWithNoConfig,)
			return {status: 'absent',}
		}
		// A transient read error or unparseable content: the config is unknown. Don't cache,
		// so the next read re-attempts, and report `error` so safety-sensitive callers can
		// fail safe rather than treat this as "no config".
		return {status: 'error',}
	}

	purifyObject(response.data,)
	normalizeConfig(response.data,)

	// Record the revision this config was read from so the next save can condition
	// its write on it and detect a concurrent edit. Done after a successful content
	// read so the rev corresponds to a config we could actually parse.
	await stashConfigRev(subreddit, page,)

	// Compat-on subs fold any 6.x edits from the legacy mirror into the view;
	// the merged result is cached and persisted by the next config save.
	let resolvedConfig: ToolboxConfig = response.data
	if (compatMirrorEnabled(layout,)) {
		resolvedConfig = (await reconcileConfigFromLegacy(subreddit, resolvedConfig,)).config
	}

	cachedConfigs[subreddit] = resolvedConfig
	setCache(utils, 'configCache', cachedConfigs,)
	return {status: 'ok', config: resolvedConfig,}
}

/**
 * Retrieves the toolbox config for a subreddit, using an in-memory cache to avoid redundant API calls.
 * @param subreddit The subreddit name to fetch config for.
 * @param options Read options (see {@link GetConfigOptions}).
 * @returns The normalized config object, or `undefined` if the subreddit has no toolbox wiki page or an error occurred.
 */
export async function getConfig (
	subreddit: string,
	options: GetConfigOptions = {},
): Promise<ToolboxConfig | undefined> {
	const result = await tryGetConfig(subreddit, options,)
	return result.status === 'ok' ? result.config : undefined
}

/**
 * Reads the freshest toolbox config straight from the canonical wiki page,
 * bypassing the config cache. Used by config tabs to refresh their state
 * after an external wiki edit.
 * @param subreddit The subreddit name (without the `r/` prefix).
 * @returns The purified and normalized config, or `null` if the wiki read failed.
 */
export async function reloadConfigFromWiki (subreddit: string,): Promise<ToolboxConfig | null> {
	// User-profile pseudo-subreddits have no toolbox wiki page to reload (see tryGetConfig).
	if (isUserProfileSubreddit(subreddit,)) {
		return null
	}
	const layout = await resolveWikiLayout(subreddit,)
	// Non-moderated subs short-circuit to a read-free `notModerated` layout - no page to reload.
	if (layout.notModerated) {
		return null
	}
	const page = layout.state === 'legacyFallback' ? OLD_WIKI_PATHS.settings : NEW_WIKI_PATHS.settings
	const response = await readFromWiki<Record<string, any>>(subreddit, page, true,)
	if (!response.ok) {
		log.debug('Failed: wiki config',)
		return null
	}
	purifyObject(response.data,)
	normalizeConfig(response.data,)
	// Refresh the save guard's base revision: a tab that reloads then saves should
	// condition on the revision it just re-read, not a stale earlier one.
	await stashConfigRev(subreddit, page,)
	if (compatMirrorEnabled(layout,)) {
		return (await reconcileConfigFromLegacy(subreddit, response.data,)).config
	}
	return response.data
}

/**
 * Decompresses a usernotes blob into a human-readable object for display in
 * the wiki editor. Handles both the legacy v6 page and the NXG shard envelope
 * (`format: 'nxg-usernotes'`) - in either case the zlib/base64 `blob` is
 * inflated into a `users` object.
 */
function humanizeUsernotes (notes: any,) {
	if ((notes.ver >= 6 || notes.format === NXG_USERNOTES_FORMAT) && typeof notes.blob === 'string') {
		const decompressed = zlibInflate(notes.blob,)
		delete notes.blob
		notes.users = JSON.parse(decompressed,)
	}
	return notes
}

/** Inverse of {@link humanizeUsernotes}: deflates an expanded `users` object back into the on-wiki `blob`. */
function compressUsernotesBlob (notes: any,) {
	notes.blob = zlibDeflate(JSON.stringify(notes.users,),)
	delete notes.users
	return notes
}

/** The result of loading a wiki page for the config editor. */
export type WikiEditorLoadResult =
	| {ok: true; text: string}
	| {ok: false; kind: 'empty' | 'error'}

/** Options describing what kind of page the wiki editor is working with. */
export interface WikiEditorPageOptions {
	/** Whether the page is the usernotes page (enables blob expansion/compression). */
	isUsernotes: boolean
	/** Whether the page is AutoModerator YAML (skips JSON handling entirely). */
	isAutomod: boolean
}

/**
 * Converts raw wiki page text to display-ready editor text: usernotes pages
 * get their v6 blob expanded, and JSON pages are pretty-printed.
 * @param raw The raw wiki page content.
 * @param opts What kind of page this is.
 */
export function formatWikiEditorText (raw: string, opts: WikiEditorPageOptions,): string {
	let pageText: any = unescapeJSON(raw,)
	if (opts.isAutomod) {
		return pageText as string
	}
	pageText = JSON.parse(pageText as string,)
	if (opts.isUsernotes) {
		pageText = humanizeUsernotes(pageText,)
	}
	return JSON.stringify(pageText, null, 4,)
}

/**
 * Reads a wiki page for the config editor and returns display-ready text.
 * @param subreddit The subreddit whose wiki page to read.
 * @param actualPage The resolved wiki page path (e.g. `'toolbox'`, `'config/automoderator'`).
 * @param opts What kind of page this is.
 * @returns `{ok: true, text}` with editor-ready text, or `{ok: false, kind}` where `'empty'`
 *   means no page / blank content and `'error'` means an unexpected read failure.
 */
export async function loadWikiEditorPage (
	subreddit: string,
	actualPage: string,
	opts: WikiEditorPageOptions,
): Promise<WikiEditorLoadResult> {
	const rawResp = await readFromWiki(subreddit, actualPage, false,)
	if (!rawResp.ok) {
		if (rawResp.reason === 'unknown_error') { return {ok: false, kind: 'error',} }
		return {ok: false, kind: 'empty',}
	}
	return {ok: true, text: formatWikiEditorText(rawResp.data, opts,),}
}

/**
 * Reads one historical revision of a wiki page for the config editor,
 * formatted the same way as {@link loadWikiEditorPage}. Used by the editor's
 * rollback dropdown - saving the loaded text writes it as a new revision.
 * @param subreddit The subreddit whose wiki page to read.
 * @param actualPage The resolved wiki page path.
 * @param revisionId The revision UUID from the page's history listing.
 * @param opts What kind of page this is.
 */
export async function loadWikiEditorRevision (
	subreddit: string,
	actualPage: string,
	revisionId: string,
	opts: WikiEditorPageOptions,
): Promise<WikiEditorLoadResult> {
	const rawResp = await readWikiRevision(subreddit, actualPage, revisionId,)
	if (!rawResp.ok) {
		if (rawResp.reason === 'unknown_error') { return {ok: false, kind: 'error',} }
		return {ok: false, kind: 'empty',}
	}
	return {ok: true, text: formatWikiEditorText(rawResp.data, opts,),}
}

/**
 * Which representation of the usernotes page the editor text currently is:
 * `'compressed'` (v6 JSON with its zlib blob), `'decompressed'` (editable
 * JSON with a `users` object), or `null` when the text is neither (blank
 * page, placeholder text, malformed JSON, the NXG shard manifest).
 */
export type UsernotesEditorView = 'compressed' | 'decompressed' | null

/**
 * Classifies usernotes editor text as compressed, decompressed, or neither.
 * @param text The current editor text.
 */
export function getUsernotesEditorView (text: string,): UsernotesEditorView {
	try {
		const parsed = JSON.parse(text,)
		if (!parsed || typeof parsed !== 'object') { return null }
		if (typeof parsed.blob === 'string') { return 'compressed' }
		if (
			parsed.users && typeof parsed.users === 'object'
			&& (parsed.ver === 6 || parsed.format === NXG_USERNOTES_FORMAT)
		) {
			return 'decompressed'
		}
	} catch { /* not JSON */ }
	return null
}

/** The result of converting usernotes editor text between representations. */
export type UsernotesConvertResult =
	| {ok: true; text: string}
	| {ok: false; message: string}

/**
 * Converts usernotes editor text between its compressed and decompressed
 * representations, preserving any edits (the conversion always starts from
 * the given text, not from the wiki):
 *
 * - decompressing expands the v6 blob into pretty-printed editable JSON
 * - compressing re-deflates a v6 `users` object into its blob (shown as
 *   pretty JSON, since the v6 page is JSON either way)
 *
 * A no-op (returning the input) when the text is already in the requested
 * representation.
 * @param text The current editor text.
 * @param target The representation to convert to.
 */
export async function convertUsernotesEditorText (
	text: string,
	target: 'compressed' | 'decompressed',
): Promise<UsernotesConvertResult> {
	const view = getUsernotesEditorView(text,)
	if (view === null) {
		return {ok: false, message: 'This page is not recognized as usernotes data.',}
	}
	if (view === target) {
		return {ok: true, text,}
	}

	try {
		if (target === 'decompressed') {
			return {ok: true, text: JSON.stringify(humanizeUsernotes(JSON.parse(text,),), null, 4,),}
		}
		return {ok: true, text: JSON.stringify(compressUsernotesBlob(JSON.parse(text,),), null, 4,),}
	} catch (err) {
		log.error(`Failed to ${target === 'compressed' ? 'compress' : 'decompress'} usernotes:`, err,)
		return {ok: false, message: `Could not convert usernotes: ${String(err,)}`,}
	}
}

/** The result of preparing editor text for saving. */
export type WikiEditorPrepareResult =
	| {ok: true; content: string}
	| {ok: false; message: string}

/**
 * Validates and converts editor text into the content to write to the wiki,
 * reversing the display transforms of {@link formatWikiEditorText}:
 *
 * - AutoModerator YAML passes through verbatim (Reddit validates it server-side).
 * - Expanded v6 usernotes (`ver: 6` with `users` but no `blob`) get their
 *   blob recompressed - readers inflate `blob` unconditionally, so saving
 *   the expanded form would break the page.
 * - Other JSON is validated and minified.
 * @param content The editor text.
 * @param opts What kind of page this is.
 */
export async function prepareWikiEditorContent (
	content: string,
	opts: WikiEditorPageOptions,
): Promise<WikiEditorPrepareResult> {
	if (opts.isAutomod) {
		return {ok: true, content,}
	}

	let parsed: any
	try {
		parsed = JSON.parse(content,)
	} catch (err) {
		return {ok: false, message: `Page not saved, JSON is not correct.<br> ${String(err,)}`,}
	}

	if (
		opts.isUsernotes && parsed && typeof parsed === 'object'
		&& (parsed.ver === 6 || parsed.format === NXG_USERNOTES_FORMAT)
		&& parsed.users && typeof parsed.users === 'object' && parsed.blob === undefined
	) {
		compressUsernotesBlob(parsed,)
	}

	return {ok: true, content: JSON.stringify(parsed,),}
}

/** The outcome of a {@link saveWikiEditorPage} call, for the caller to turn into user feedback. */
export type WikiEditorSaveResult =
	| {ok: true}
	| {ok: false; automodError: string | null; message: string}

/**
 * Writes already-validated wiki-editor content to the page and clears the config cache on success.
 * Performs no user feedback of its own - the caller decides what to surface from the returned result.
 * @param subreddit The subreddit whose wiki page to write.
 * @param actualPage The resolved wiki page path.
 * @param content The content to save (JSON pages must already be minified/validated by the caller).
 * @param note The wiki revision note.
 * @param isAutomod Whether the page is AutoModerator YAML (parses AutoMod `special_errors` on failure).
 * @returns `{ok: true}` on success, or `{ok: false, automodError, message}` where `automodError` is the
 *   purified inline AutoMod error (or `null`) and `message` is the toast text the caller should show.
 */
export async function saveWikiEditorPage (
	subreddit: string,
	actualPage: string,
	content: string,
	note: string,
	isAutomod: boolean,
): Promise<WikiEditorSaveResult> {
	try {
		await apiPostToWiki(subreddit, actualPage, content, note, false, isAutomod,)
		await clearCache()
		return {ok: true,}
	} catch (err: unknown) {
		if (isAutomod) {
			let automodError: string | null = null
			if (err && typeof err === 'object' && 'response' in err) {
				try {
					const response = (err as {response: {json(): Promise<any>}}).response
					const responseJSON = await response.json()
					const saveError = responseJSON.special_errors?.[0]
					if (saveError) { automodError = purifyHTML(saveError,) }
				} catch (_) { /* ignore parse errors */ }
			}
			return {ok: false, automodError, message: 'Config not saved!',}
		}
		const message = err && typeof err === 'object' && 'responseText' in err
			? String((err as {responseText: unknown}).responseText,)
			: String(err,)
		return {ok: false, automodError: null, message,}
	}
}

/**
 * Per-subreddit save queue. Concurrent calls to {@link saveToolboxConfig} for the
 * same subreddit are chained so they execute one after another rather than racing.
 */
const enqueueConfigSave = createPerKeyQueue()

/**
 * Writes a full toolbox config object to a subreddit's config wiki page(s),
 * with the standard save feedback and cache invalidation. Shared by every
 * module that persists its slice of the config (mod macros, removal reasons,
 * usernote types, domain tags, ban macros).
 *
 * The write fans out through the wiki layout resolver: the canonical NXG page
 * is written first, then subs with 6.x compatibility on refresh the legacy
 * `toolbox` mirror (non-fatally - the canonical save already succeeded). The
 * NXG copy is the v2 schema and carries the compat flag; the legacy copy is
 * down-converted to the classic v1 schema (escape()-encoded text fields,
 * limited-HTML fill-in fields, no NXG metadata) so 6.x parses it cleanly.
 *
 * Concurrent saves for the same subreddit are serialized: the second call
 * awaits the first before writing, preventing a later write from silently
 * discarding changes made by an earlier in-flight write.
 *
 * Never rejects - failures are reported through the feedback toasts, so
 * fire-and-forget callers don't need their own error handling.
 * @param subreddit The subreddit whose toolbox config to write.
 * @param config The full toolbox config object.
 * @param reason The wiki revision note.
 */
export function saveToolboxConfig (subreddit: string, config: ToolboxConfig, reason: string,): Promise<void> {
	return enqueueConfigSave(subreddit, () => doSaveToolboxConfig(subreddit, config, reason,),)
}

/** Core write logic for {@link saveToolboxConfig}, called inside the per-subreddit save queue. */
async function doSaveToolboxConfig (subreddit: string, config: ToolboxConfig, reason: string,): Promise<void> {
	log.debug('posting config to wiki',)
	neutralTextFeedback('saving to wiki',)
	try {
		const layout = await resolveWikiLayout(subreddit,)
		const [canonicalPage, ...mirrorPages] = await getWikiWritePaths('settings', subreddit,)

		// 6.x reads domain tags and usernote colors from the config page, but NXG
		// keeps them on their own pages - fetch from those sources so the legacy
		// down-convert can re-inject them. Both reads are cached/cheap.
		const [domainTagsData, usernoteColors,] = await Promise.all([
			getDomainTagsData(subreddit,),
			getSubredditColors(subreddit,),
		],)

		// Payloads are keyed off path identity (not position): the NXG page
		// always gets the v2 schema + compat flag, every other path gets the
		// classic v1 down-convert.
		const payloadFor = (page: string,) =>
			page === NEW_WIKI_PATHS.settings
				? {...config, [COMPAT_WRITES_KEY]: layout.compatibilityWrites,}
				: encodeClassicConfig(config, domainTagsData.tags, usernoteColors,)

		// The canonical write comes first and its failure fails the save. It is
		// conditioned on the revision this config was read from (see CONFIG_REV_KEY):
		// if another moderator's edit landed in between, Reddit returns a conflict and
		// we warn instead of overwriting their change. A missing base rev (config built
		// without a preceding getConfig) falls back to an unconditional last-write-wins.
		const baseRevs = await getCache(utils, CONFIG_REV_KEY, {},) as Record<string, string>
		const writeResult = await writeWikiPageConditional(
			subreddit,
			canonicalPage!,
			payloadFor(canonicalPage!,),
			reason,
			baseRevs[subreddit],
			configCodec,
			{listed: 'true',},
		)
		if (!writeResult.ok && writeResult.conflict) {
			// A concurrent edit won. Drop the stale cache (which clears the stashed base
			// rev too) so a reload reads fresh, and tell the user their change was not
			// saved (no clobber, no merge).
			await clearCache()
			negativeTextFeedback(
				'Settings changed elsewhere since you loaded them - your change was not saved. Reload before saving.',
			)
			return
		}
		if (!writeResult.ok) {
			throw writeResult.error
		}

		// Mirror writes are non-fatal: the canonical page is saved, and the
		// next save refreshes the mirror.
		for (const page of mirrorPages) {
			try {
				await apiPostToWiki(subreddit, page, payloadFor(page,), reason, true, false,)
			} catch (mirrorError: unknown) {
				log.warn(`Failed to refresh the config mirror at ${page}:`, mirrorError,)
				negativeTextFeedback('Settings saved, but the 6.x mirror page could not be updated.',)
			}
		}

		log.debug('clearing cache',)
		// The page moved to a new revision; clearing the cache also drops the stale base
		// rev so the next save re-stashes a fresh one via getConfig rather than condition
		// on this old one.
		await clearCache()
		positiveTextFeedback('wiki page saved',)
	} catch (err: unknown) {
		log.debug(err,)
		const responseText = err && typeof err === 'object' && 'responseText' in err
			? String((err as {responseText: unknown}).responseText,)
			: String(err,)
		negativeTextFeedback(responseText,)
	}
}
