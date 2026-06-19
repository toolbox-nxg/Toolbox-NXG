/** Decode, normalize, and encode helpers for the standalone domain tags wiki page. */

import type {WikiPageCodec,} from '../../../../api/resources/wikiVersioned'
import {unescapeJSON,} from '../../../data/encoding'
import {purifyObject,} from '../../../data/purify'
import createLogger from '../../../infra/logging'
import {
	defaultDomainTagsData,
	type DomainTag,
	type DomainTagsData,
	domainTagsMaxSchema,
	domainTagsMinSchema,
	domainTagsSchema,
} from './schema'

const log = createLogger('TBDomainTags',)

/**
 * Coerces a raw parsed object into a valid {@link DomainTagsData} in-place.
 * Missing or malformed fields are replaced with safe defaults so a hand-edited
 * page doesn't crash the module.
 * @param raw The raw (possibly partial) parsed object to normalize.
 */
export function normalizeDomainTagsData (raw: any,): asserts raw is DomainTagsData {
	if (typeof raw.ver !== 'number') { raw.ver = domainTagsSchema }
	if (typeof raw.showCounts !== 'boolean') { raw.showCounts = false }

	if (!Array.isArray(raw.tags,)) { raw.tags = [] }

	raw.tags = (raw.tags as any[]).filter((entry: any,) => {
		// Drop entries that aren't objects or lack a string name.
		if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name) {
			return false
		}
		// Coerce color to string; default to light blue.
		if (typeof entry.color !== 'string' || !entry.color) {
			entry.color = '#cee3f8'
		}
		// Coerce counts to non-negative integers.
		entry.approvalCount = typeof entry.approvalCount === 'number' && entry.approvalCount >= 0
			? Math.floor(entry.approvalCount,)
			: 0
		entry.removalCount = typeof entry.removalCount === 'number' && entry.removalCount >= 0
			? Math.floor(entry.removalCount,)
			: 0
		// Drop malformed threshold values; valid range is 0-100.
		if (
			entry.removalThreshold !== undefined
			&& (typeof entry.removalThreshold !== 'number' || entry.removalThreshold < 0
				|| entry.removalThreshold > 100)
		) {
			delete entry.removalThreshold
		}
		// Drop malformed note values.
		if (entry.note !== undefined && typeof entry.note !== 'string') {
			delete entry.note
		}
		return true
	},) as DomainTag[]
}

/**
 * Parses and normalizes a raw JSON value read from the domain tags wiki page.
 * Returns `null` when the value cannot be interpreted as domain tags data
 * (wrong type, unsupported schema version).
 * @param raw The parsed JSON value from the wiki page.
 * @param subreddit The subreddit name, used only for error logging.
 */
export function decodeDomainTagsPage (raw: unknown, subreddit: string,): DomainTagsData | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw,)) {
		log.error(`Domain tags page for /r/${subreddit} is not an object`,)
		return null
	}

	const data = raw as any

	if (typeof data.ver === 'number' && (data.ver < domainTagsMinSchema || data.ver > domainTagsMaxSchema)) {
		log.error(
			`Domain tags schema version ${data.ver} for /r/${subreddit} is outside the supported range `
				+ `${domainTagsMinSchema}–${domainTagsMaxSchema}`,
		)
		return null
	}

	normalizeDomainTagsData(data,)
	return data as DomainTagsData
}

/**
 * Serializes a {@link DomainTagsData} object into the plain JSON wire format
 * written to the wiki page. Returns the object as-is (JSON.stringify happens in
 * the transport layer); this is the encode counterpart to {@link decodeDomainTagsPage}.
 * @param data The domain tags data to encode.
 */
export function encodeDomainTagsPage (data: DomainTagsData,): DomainTagsData {
	// The in-memory shape is already the wire shape - no down-conversion needed.
	// Return a structured clone so callers can't accidentally mutate the cached object.
	return structuredClone(data,)
}

/**
 * Returns a fresh default {@link DomainTagsData} object, deep-cloned from the
 * module constant so callers can mutate it freely.
 */
export function makeDefaultDomainTagsData (): DomainTagsData {
	return structuredClone(defaultDomainTagsData,)
}

/**
 * The {@link WikiPageCodec} for the domain tags page, used by the versioned wiki
 * transport so per-tag edits become conflict-safe. `parse` **refuses**
 * (`{ok:false}`) a page it can't interpret - invalid JSON, or an unsupported
 * schema version (via {@link decodeDomainTagsPage} returning `null`) - so a write
 * never overwrites a page produced by a newer Toolbox. Content is HTML-entity-escaped
 * on the wiki, so `parse` reverses that before `JSON.parse` (matching `readFromWiki`).
 */
export const domainTagsCodec: WikiPageCodec<DomainTagsData> = {
	parse (raw,) {
		let obj: unknown
		try {
			obj = JSON.parse(unescapeJSON(raw,),)
		} catch {
			return {ok: false, reason: 'The domain tags page contains invalid JSON.',}
		}
		if (obj && typeof obj === 'object') { purifyObject(obj,) }
		const decoded = decodeDomainTagsPage(obj, '(domain tags)',)
		if (!decoded) {
			return {
				ok: false,
				reason:
					'The domain tags page is in an unexpected format or a newer schema version; refusing to overwrite.',
			}
		}
		return {ok: true, data: decoded,}
	},
	serialize: (data,) => JSON.stringify(data,),
	empty: makeDefaultDomainTagsData,
}
