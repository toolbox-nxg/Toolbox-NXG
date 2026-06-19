/**
 * The {@link WikiPageCodec} for the announcements wiki page.
 *
 * Unlike the proposals codec (which coerces malformed content to empty), this codec
 * **refuses** to interpret content it does not recognize - invalid JSON, or a doc
 * whose shape doesn't match {@link AnnouncementsWikiData} (e.g. a newer `version`).
 * That refusal flows through the versioned transport as `unparseable`, so the mutate
 * loop aborts before any write: the write path must never overwrite notes it could
 * not read, or existing announcements would be silently lost.
 */

import type {WikiPageCodec,} from '../../api/resources/wikiVersioned'
import {unescapeJSON,} from '../../util/data/encoding'
import type {AnnouncementsWikiData,} from './types'

/** Refusal message when the page exists but is not valid JSON. */
export const INVALID_JSON_REASON =
	'The announcements page contains invalid JSON. Fix it by hand before editing so existing notes are not lost.'

/** Refusal message when the page parses but isn't a recognized announcements doc. */
export const UNEXPECTED_FORMAT_REASON =
	'The announcements page is in an unexpected format (it may have been written by a newer version of Toolbox). '
	+ 'Update before editing so existing notes are not lost.'

/** Narrows an untrusted parsed blob to a well-formed announcements document. */
function isAnnouncementsDoc (value: unknown,): value is AnnouncementsWikiData {
	return typeof value === 'object' && value !== null
		&& (value as AnnouncementsWikiData).version === 1
		&& Array.isArray((value as AnnouncementsWikiData).notes,)
}

/** The codec used by the versioned transport for the announcements page. */
export const announcementsCodec: WikiPageCodec<AnnouncementsWikiData> = {
	parse (raw,) {
		let data: unknown
		try {
			// Reddit returns content HTML-entity-escaped; reverse it before parsing
			// (the shared `readFromWiki` did this internally - we now own it).
			data = JSON.parse(unescapeJSON(raw,),)
		} catch {
			return {ok: false, reason: INVALID_JSON_REASON,}
		}
		if (isAnnouncementsDoc(data,)) {
			return {ok: true, data,}
		}
		return {ok: false, reason: UNEXPECTED_FORMAT_REASON,}
	},
	serialize: (data,) => JSON.stringify(data,),
	empty: () => ({version: 1, notes: [],}),
}
