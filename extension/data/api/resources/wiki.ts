/** API functions for reading from and writing to Reddit wiki pages. */

import {unescapeJSON,} from '../../util/data/encoding'
import createLogger from '../../util/infra/logging'
import {apiOauthGET, apiOauthGetJSON, apiOauthPOST,} from '../transport/http'
import type {RequestError,} from '../transport/http'

const log = createLogger('TBApi',)

/**
 * The discriminated-union result of a wiki read.
 * On success, `data` holds the parsed content. On failure, `reason` describes why:
 * - `no_page` - the page does not exist or wiki is disabled
 * - `invalid_json` - the page exists but is not valid JSON (only when `isJSON` was `true`)
 * - `unknown_error` - an unexpected network or API error occurred
 */
export type WikiReadResult<T = string | object,> =
	| {ok: true; data: T}
	| {ok: false; reason: 'no_page' | 'unknown_error' | 'invalid_json'}

/**
 * Updates the content of a wiki page.
 * @param subreddit Subreddit that owns the page.
 * @param page Name of the wiki page to write.
 * @param data Replacement content for the page.
 * @param reason Revision-history note describing the edit.
 * @param isJSON When true, `data` is JSON-stringified before saving.
 * @param updateAM When true, every tab is expanded to four spaces.
 */
export async function postToWiki (
	subreddit: string,
	page: string,
	data: unknown,
	reason: string,
	isJSON: boolean,
	updateAM: boolean,
): Promise<void> {
	const editReason = reason ? `"${reason}" via toolbox` : 'updated via toolbox'

	let content: string = isJSON ? JSON.stringify(data,) : String(data,)

	log.debug(`Posting /r/${subreddit}/api/wiki/edit/${page}`,)

	// If we update automoderator we want to replace any tabs with four spaces.
	if (updateAM) {
		content = content.replace(/\t/g, '    ',)
	}

	await apiOauthPOST(`/r/${subreddit}/api/wiki/edit`, {
		content,
		page,
		reason: editReason,
	},)

	// Set page access to 'mod only' on every write. The permission is
	// idempotent, and there's no way to distinguish creation from update
	// in the write response, so we always set it rather than reading first.
	// This is best-effort: if it fails, the content write already succeeded.
	await setWikiPageSettings({
		subreddit,
		page,
		listed: 'true',
		permlevel: '2',
	},).catch((err: RequestError,) => {
		const status = err.response?.status
		log.warn(`Failed to set wiki page ${subreddit}/${page} to mod-only (${status ?? 'no response'}):`, err,)
	},)
}

/**
 * Updates the visibility and edit-permission settings for a wiki page.
 * @param options Page settings.
 * @param subreddit The subreddit the wiki page is in.
 * @param page The wiki page path.
 * @param listed Whether the page appears in the wiki page list.
 * @param permlevel Edit permission level: `'0'` = use subreddit setting, `'1'` = approved users only, `'2'` = mods only.
 */
export async function setWikiPageSettings ({
	subreddit,
	page,
	listed,
	permlevel,
}: {
	subreddit: string
	page: string
	listed: 'true' | 'false'
	permlevel: string
},): Promise<Response> {
	return apiOauthPOST(`/r/${subreddit}/wiki/settings/${page}`, {
		listed,
		permlevel,
	},)
}

/**
 * Reads the content of a subreddit wiki page as parsed JSON.
 * @param subreddit The subreddit the wiki page is in.
 * @param page The wiki page path.
 * @param isJSON Must be `true` for this overload.
 * @returns A `WikiReadResult` discriminated union - check `.ok` before using `.data`.
 */
export async function readFromWiki<T extends object = Record<string, unknown>,> (
	subreddit: string,
	page: string,
	isJSON: true,
): Promise<WikiReadResult<T>>
/**
 * Reads the content of a subreddit wiki page as a raw markdown string.
 * @param subreddit The subreddit the wiki page is in.
 * @param page The wiki page path.
 * @param isJSON Omit or pass `false` for this overload.
 * @returns A `WikiReadResult` discriminated union - check `.ok` before using `.data`.
 */
export async function readFromWiki (
	subreddit: string,
	page: string,
	isJSON?: false,
): Promise<WikiReadResult<string>>
export async function readFromWiki<T extends object = Record<string, unknown>,> (
	subreddit: string,
	page: string,
	isJSON?: boolean,
): Promise<WikiReadResult<T | string>> {
	let wikiData
	try {
		const response = await apiOauthGET(`/r/${subreddit}/wiki/${page}.json`,)
		const data = await response.json()
		// Guard the wrapper shape: an unexpected body (e.g. an error object) reads as a
		// missing page (`!wikiData` below) rather than throwing into the generic catch,
		// matching how `readWikiRevision` handles the same case.
		wikiData = data?.data?.content_md
	} catch (error: unknown) {
		const response = error instanceof Error ? (error as RequestError).response : undefined
		if (!response) {
			log.error(`Wiki error (${subreddit}/${page}):`, error,)
			return {ok: false, reason: 'unknown_error',}
		}
		let reason
		try {
			reason = (await response.json()).reason || ''
		} catch {
			reason = ''
		}
		if (reason === 'PAGE_NOT_CREATED') {
			// An uncreated page is an ordinary state (a sub simply hasn't saved this
			// config yet), not a failure - log at debug so it doesn't read as an error.
			log.debug(`Wiki page not created (${subreddit}/${page})`,)
			return {ok: false, reason: 'no_page',}
		}
		if (reason === 'WIKI_DISABLED') {
			// Disabled wiki blocks toolbox from working on the sub - surface it as an error.
			log.error(`Wiki disabled for /r/${subreddit} (${page}):`, error,)
			return {ok: false, reason: 'no_page',}
		}
		// Unknown failure - do not attempt to write to this page.
		log.error(`Wiki error (${subreddit}/${page}):`, error,)
		return {ok: false, reason: 'unknown_error',}
	}

	// Empty string is treated the same as missing: Reddit returns content_md: '' for
	// pages that exist in the index but have never had content written to them.
	if (!wikiData) {
		return {ok: false, reason: 'no_page',}
	}

	if (isJSON) {
		try {
			// Reddit returns content_md with HTML entities escaped (`&` `<` `>`).
			// v2 stores plain text, where a literal `<` or `&` would gain one more
			// `&amp;` layer on every read/save round trip if the encoding were not
			// reversed here.
			return {ok: true, data: JSON.parse(unescapeJSON(wikiData,),) as T,}
		} catch (jsonError) {
			log.debug(jsonError,)
			return {ok: false, reason: 'invalid_json',}
		}
	}

	return {ok: true, data: wikiData,}
}

/** Lists the page names on a subreddit's wiki. */
export const getWikiPages = (subreddit: string,): Promise<string[]> =>
	apiOauthGetJSON(`/r/${subreddit}/wiki/pages.json`,)
		.then((response,) => response.data as string[])

/** One entry in a wiki page's revision history. */
export interface WikiRevision {
	/** The revision's UUID, used to fetch its content. */
	id: string
	/** Unix timestamp (seconds) of the revision. */
	timestamp: number
	/** Username of the moderator who made the edit. */
	author: string
	/** The revision note, or an empty string. */
	reason: string
}

/**
 * Lists a wiki page's revision history, newest first.
 * @param subreddit The subreddit the wiki page is in.
 * @param page The wiki page path.
 * @param limit Maximum number of revisions to return (Reddit caps at 100).
 */
export const getWikiRevisions = (subreddit: string, page: string, limit = 25,): Promise<WikiRevision[]> =>
	apiOauthGetJSON(`/r/${subreddit}/wiki/revisions/${page}.json`, {limit: String(limit,),},)
		.then((response,) =>
			((response.data?.children ?? []) as any[]).map((revision,): WikiRevision => ({
				id: revision.id,
				timestamp: revision.timestamp,
				author: revision.author?.data?.name ?? '[unknown]',
				reason: revision.reason ?? '',
			}))
		)

/**
 * Reads the raw content of one specific revision of a wiki page.
 * @param subreddit The subreddit the wiki page is in.
 * @param page The wiki page path.
 * @param revisionId The revision UUID from {@link getWikiRevisions}.
 * @returns A `WikiReadResult` with the revision's raw markdown.
 */
export async function readWikiRevision (
	subreddit: string,
	page: string,
	revisionId: string,
): Promise<WikiReadResult<string>> {
	try {
		const response = await apiOauthGET(`/r/${subreddit}/wiki/${page}.json`, {v: revisionId,},)
		const data = await response.json()
		// Guard the wrapper shape: an unexpected body (e.g. an error object)
		// reads as a missing page rather than throwing into the generic catch.
		const content = data?.data?.content_md
		if (!content) { return {ok: false, reason: 'no_page',} }
		return {ok: true, data: content,}
	} catch (error: unknown) {
		log.error(`Wiki revision error (${subreddit}/${page}@${revisionId}):`, error,)
		return {ok: false, reason: 'unknown_error',}
	}
}
