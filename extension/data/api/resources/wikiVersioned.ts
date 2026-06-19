/**
 * Revision-aware (optimistic-concurrency) read/write primitives for wiki pages.
 *
 * The shared `postToWiki`/`readFromWiki` helpers in `./wiki` are last-write-wins:
 * a save blindly overwrites whatever is on the page, so a second moderator's edit
 * made between our read and our write is silently discarded. These primitives close
 * that gap for single-page read-modify-write consumers (proposals, announcements):
 * a write carries the `previous` revision id it was based on, and Reddit rejects a
 * stale write with HTTP 409 `EDIT_CONFLICT` (whose body carries the current
 * `newrevision`/`newcontent`) so the caller can re-apply against fresh state rather
 * than clobber it.
 *
 * Schema-agnostic: every consumer supplies a {@link WikiPageCodec} describing how to
 * parse/serialize its payload and what an empty page looks like. `postToWiki`/
 * `readFromWiki` are intentionally NOT retrofitted - mirrors, migration copies, and
 * sharded multi-page writes do not fit this single-page model (see the toolbox wiki
 * write-path notes).
 */

import createLogger from '../../util/infra/logging'
import {apiOauthPOST,} from '../transport/http'
import type {RequestError,} from '../transport/http'
import {getWikiRevisions, readWikiRevision, setWikiPageSettings,} from './wiki'

const log = createLogger('TBApi',)

/**
 * The encode/decode/identity seam for a versioned wiki page's payload. A consumer
 * implements one of these to teach the transport how to handle its content.
 */
export interface WikiPageCodec<T,> {
	/**
	 * Parses raw wiki content (HTML-entity-escaped, as Reddit returns it) into `T`.
	 * MUST NOT throw. Return `{ok: false, reason}` to signal the content exists but
	 * cannot be interpreted safely - the caller must then refuse to overwrite it
	 * rather than risk discarding data it did not understand. Codecs that prefer to
	 * coerce malformed content to empty simply return `{ok: true, data: empty()}`.
	 */
	parse(raw: string,): WikiParseResult<T>
	/** Serializes `T` into the string stored on the wiki (e.g. `JSON.stringify`). */
	serialize(data: T,): string
	/** A fresh empty value, used when the page does not exist yet. */
	empty(): T
}

/**
 * The outcome of {@link WikiPageCodec.parse}.
 * - `ok: true` - `data` is usable.
 * - `ok: false` - the content existed but was unrecognized/unparseable; `reason`
 *   is a human-readable explanation the caller can surface, and no write should
 *   proceed against it.
 */
export type WikiParseResult<T,> =
	| {ok: true; data: T}
	| {ok: false; reason: string}

/**
 * The result of a versioned read: the parsed value plus the revision it came from
 * (for use as `previous` on a subsequent conditional write).
 */
export interface WikiVersionedRead<T,> {
	/** The parsed data, or the codec's empty value when the page is absent/unparseable. */
	data: T
	/** The revision `data` was read from; `undefined` when the page does not exist
	 *  yet (a first write will create it). */
	rev: string | undefined
	/** Present when the page exists but the codec refused to parse it; the caller
	 *  must not overwrite. Carries the codec's refusal reason. */
	unparseable?: {reason: string}
}

/** The outcome of a conditional (revision-guarded) write. */
export type WikiConditionalWriteResult<T,> =
	/** The write committed. */
	| {ok: true}
	/**
	 * A concurrent writer won. `data`/`rev` are the current canonical state to
	 * re-apply against (taken from the 409 body where possible, so no re-read is
	 * needed). `unparseable` is set when that fresh state itself cannot be parsed,
	 * in which case the caller must refuse rather than retry.
	 */
	| {ok: false; conflict: true; data: T; rev: string; unparseable?: {reason: string}}
	/** The write failed for a non-conflict reason (transport error, unexpected status). */
	| {ok: false; conflict: false; error: Error}

/** Per-page write behavior. `permlevel` is always `'2'` (mod-only) and not exposed. */
export interface WikiVersionedWriteOptions {
	/** Whether the page appears in the wiki page index. */
	listed: 'true' | 'false'
	/** When true, expand tabs to four spaces before writing (AutoModerator pages). */
	expandTabs?: boolean
	/** Builds the revision note. Defaults to `"<reason>" via toolbox`. */
	formatReason?: (reason: string,) => string
}

/** The body Reddit returns with a 409 wiki edit conflict. */
interface EditConflictBody {
	reason?: string
	newrevision?: string
	newcontent?: string
}

/** The default revision-note format, matching the legacy `postToWiki` convention. */
function defaultFormatReason (reason: string,): string {
	return reason ? `"${reason}" via toolbox` : 'updated via toolbox'
}

/**
 * Reads a wiki page consistently: fetches the latest revision id, then reads that
 * exact revision's content, so the returned `data` and `rev` always correspond (no
 * read-time gap between content and revision). A genuinely missing page (404) yields
 * the codec's empty value and `rev: undefined`; content the codec refuses to parse, an
 * unreadable revision, or a transient list failure yield empty data plus `unparseable`
 * (with the rev preserved where known, so a guarded write still conditions on the
 * current revision) - readers can surface it and the mutate loop refuses to write.
 * @param subreddit The subreddit the page belongs to.
 * @param page The wiki page path.
 * @param codec The payload codec for this page.
 */
export async function readWikiPageVersioned<T,> (
	subreddit: string,
	page: string,
	codec: WikiPageCodec<T>,
): Promise<WikiVersionedRead<T>> {
	// getWikiRevisions throws on a non-2xx. A 404 means the page (or the subreddit wiki)
	// genuinely doesn't exist yet - return empty so a first write creates it. Any other
	// failure (a network error with no response, a 5xx, or a permission error) does NOT
	// prove the page is absent: reporting an empty page would hide the error from readers
	// and let a write try to create over a page that may already exist. Surface those as
	// unparseable so reads can show the error and the mutate loop refuses to write.
	let rev: string | undefined
	try {
		const revisions = await getWikiRevisions(subreddit, page, 1,)
		rev = revisions[0]?.id
	} catch (err) {
		const status = (err as RequestError).response?.status
		if (status === 404) {
			log.debug(`no page ${subreddit}/${page} (404; treating as empty)`, err,)
			return {data: codec.empty(), rev: undefined,}
		}
		log.warn(`could not list revisions for ${subreddit}/${page} (${status ?? 'no response'})`, err,)
		return {
			data: codec.empty(),
			rev: undefined,
			unparseable: {reason: `The wiki page could not be read (${status ?? 'network error'}). Try again.`,},
		}
	}
	if (!rev) {
		return {data: codec.empty(), rev: undefined,}
	}
	const raw = await readWikiRevision(subreddit, page, rev,)
	if (!raw.ok) {
		// The page exists (it has a revision) but its content could not be read - a
		// transient/odd response, or an empty/unexpected body. We can't prove what the
		// page actually holds, so keep the rev but mark it unparseable: a conditional
		// write must refuse rather than clobber the real content, and readers can surface
		// the problem instead of silently showing an empty page.
		log.warn(`${subreddit}/${page} revision ${rev} unreadable (${raw.reason})`,)
		return {
			data: codec.empty(),
			rev,
			unparseable: {reason: `The wiki page revision could not be read (${raw.reason}).`,},
		}
	}
	const parsed = codec.parse(raw.data,)
	if (!parsed.ok) {
		return {data: codec.empty(), rev, unparseable: {reason: parsed.reason,},}
	}
	return {data: parsed.data, rev,}
}

/**
 * Conditionally writes a wiki page. On a stale `previous`, Reddit returns HTTP 409
 * `EDIT_CONFLICT`; this returns a `conflict` result carrying the current state (from
 * the 409 body, or a fresh read as fallback) so the caller can re-apply and retry
 * without a separate read. Every successful write re-applies mod-only page settings
 * (`permlevel: '2'`) as a best-effort data-leak guard.
 * @param subreddit The subreddit the page belongs to.
 * @param page The wiki page path.
 * @param data The full payload to store.
 * @param reason The wiki revision note (pre-format).
 * @param previous The revision the write must apply on top of, or `undefined` to
 *   create the page.
 * @param codec The payload codec for this page.
 * @param options Per-page write behavior.
 */
export async function writeWikiPageConditional<T,> (
	subreddit: string,
	page: string,
	data: T,
	reason: string,
	previous: string | undefined,
	codec: WikiPageCodec<T>,
	options: WikiVersionedWriteOptions,
): Promise<WikiConditionalWriteResult<T>> {
	let content = codec.serialize(data,)
	if (options.expandTabs) {
		content = content.replace(/\t/g, '    ',)
	}
	const formatReason = options.formatReason ?? defaultFormatReason

	let response: Response
	try {
		response = await apiOauthPOST(`/r/${subreddit}/api/wiki/edit`, {
			page,
			content,
			reason: formatReason(reason,),
			previous,
		}, {okOnly: false,},)
	} catch (err) {
		// okOnly:false means non-2xx resolves; a thrown error here is a transport
		// failure (no response).
		return {ok: false, conflict: false, error: err as RequestError,}
	}

	if (response.ok) {
		// Deliberately re-assert mod-only on EVERY write (not just creation): permlevel can
		// drift - a page adopted from 6.x or hand-edited, or settings changed out of band -
		// and a readable page would leak moderator data. The permission write is idempotent,
		// so this is an intentional defense-in-depth cost, not redundant work. (Do not gate
		// it on `previous === undefined`.) Best-effort - the content write already succeeded.
		await setWikiPageSettings({subreddit, page, listed: options.listed, permlevel: '2',},)
			.catch((err: RequestError,) => {
				const status = err.response?.status
				log.warn(`Failed to set ${subreddit}/${page} mod-only (${status ?? 'no response'}):`, err,)
			},)
		return {ok: true,}
	}

	if (response.status === 409) {
		return await handleConflict(subreddit, page, response, codec,)
	}

	return {ok: false, conflict: false, error: new Error(`wiki write failed: HTTP ${response.status}`,),}
}

/**
 * Builds a conflict result from a 409 response, preferring the current state embedded
 * in the `EDIT_CONFLICT` body and falling back to a fresh consistent read.
 */
async function handleConflict<T,> (
	subreddit: string,
	page: string,
	response: Response,
	codec: WikiPageCodec<T>,
): Promise<WikiConditionalWriteResult<T>> {
	let body: EditConflictBody | null = null
	try {
		body = await response.json() as EditConflictBody
	} catch {
		body = null
	}
	if (body?.reason === 'EDIT_CONFLICT' && typeof body.newcontent === 'string' && body.newrevision) {
		const parsed = codec.parse(body.newcontent,)
		if (parsed.ok) {
			return {ok: false, conflict: true, data: parsed.data, rev: body.newrevision,}
		}
		// The current state itself is unparseable; surface it so the caller refuses.
		return {
			ok: false,
			conflict: true,
			data: codec.empty(),
			rev: body.newrevision,
			unparseable: {reason: parsed.reason,},
		}
	}
	// 409 without a usable body - fall back to a fresh consistent read.
	const fresh = await readWikiPageVersioned(subreddit, page, codec,)
	if (fresh.rev) {
		return fresh.unparseable
			? {ok: false, conflict: true, data: fresh.data, rev: fresh.rev, unparseable: fresh.unparseable,}
			: {ok: false, conflict: true, data: fresh.data, rev: fresh.rev,}
	}
	return {ok: false, conflict: false, error: new Error('wiki 409 with no usable conflict state',),}
}
