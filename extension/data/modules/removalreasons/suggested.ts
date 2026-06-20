/**
 * Report-reason → removal-reason matching for "suggested removal reasons".
 *
 * Reads the reports attached to a queue item (mod/bot reports and, when a mapping
 * opts in, user reports) and resolves which configured removal reasons a subreddit's
 * {@link SuggestedReasonMapping} list suggests for that item. AutoMod is just the
 * common case - any reporter's text can drive a suggestion.
 */

import {getModReports, getUserReports,} from '../../dom/oldReddit/queue'
import {getQueueItemReasons,} from '../../dom/shreddit/queue'
import type {SuggestedReasonMapping,} from './schema'

/** A single report extracted from a queue item, tagged by where it came from. */
export interface ExtractedReport {
	/** `'mod'` for a moderator/bot report, `'user'` for a user report. */
	source: 'mod' | 'user'
	/** The reporting mod/bot's name, or `''` when unknown (user reports, anonymized). */
	reporter: string
	/** The report reason text to match against. */
	text: string
}

/** Splits an old-Reddit `"Reporter: reason text"` mod-report string into its parts. */
function splitModReport (raw: string,): {reporter: string; text: string} {
	const trimmed = raw.trim()
	const sep = trimmed.indexOf(': ',)
	if (sep === -1) { return {reporter: '', text: trimmed,} }
	return {reporter: trimmed.slice(0, sep,).trim(), text: trimmed.slice(sep + 2,).trim(),}
}

/**
 * Extracts the report reasons attached to a queue item across both Reddit flavors.
 * Returns an empty array when the element isn't a queue item or carries no reports.
 * @param thingElement The thing/queue-item element (or a descendant) being removed.
 */
export function extractReportReasons (thingElement: Element | null | undefined,): ExtractedReport[] {
	if (!thingElement) { return [] }
	const reports: ExtractedReport[] = []

	// Shreddit: reports live as JSON on the `shreddit-post[view-context="ModQueue"]` ancestor.
	const shredditItem = thingElement.closest('shreddit-post[view-context="ModQueue"]',)
	if (shredditItem) {
		for (const reason of getQueueItemReasons(shredditItem,)) {
			const isAutomod = reason.icon === 'AUTOMOD'
			const reporter = reason.actor?.displayName ?? (isAutomod ? 'AutoModerator' : '')
			const source: ExtractedReport['source'] = reason.actor || isAutomod ? 'mod' : 'user'
			const text = [reason.title, reason.description?.markdown,].filter(Boolean,).join(' ',).trim()
			if (text) { reports.push({source, reporter, text,},) }
		}
		return reports
	}

	// Old Reddit: scope to the `.thing` so we don't pick up sibling items' reports.
	const thing = thingElement.closest('.thing',) ?? thingElement
	for (const el of getModReports(thing,)) {
		const text = el.textContent ?? ''
		if (!text.trim()) { continue }
		const {reporter, text: reason,} = splitModReport(text,)
		if (reason) { reports.push({source: 'mod', reporter, text: reason,},) }
	}
	for (const el of getUserReports(thing,)) {
		// Old Reddit appends the aggregate report count, e.g. "spam (3)"; drop it so the matched
		// text is the reason itself and the trailing count can't block a substring match.
		const text = (el.textContent ?? '').trim().replace(/\s*\(\d+\)$/, '',).trim()
		if (text) { reports.push({source: 'user', reporter: '', text,},) }
	}
	return reports
}

/** Returns true when a mapping's pattern is a (case-insensitive) substring of the report text. */
function patternMatches (mapping: SuggestedReasonMapping, text: string,): boolean {
	return text.toLowerCase().includes(mapping.pattern.toLowerCase(),)
}

/**
 * Resolves which removal reason ids a subreddit's mappings suggest for a set of
 * extracted reports. Reports from any mod/bot are considered; user reports are skipped
 * unless the mapping opts in, and the pattern is matched as a case-insensitive substring.
 * Returns de-duplicated reason ids in mapping order (and reason order within each mapping).
 * @param reports The reports extracted from the queue item.
 * @param mappings The subreddit's configured suggested-reason mappings.
 */
export function matchSuggestedReasons (
	reports: ExtractedReport[],
	mappings: SuggestedReasonMapping[] | undefined,
): string[] {
	if (!mappings?.length || !reports.length) { return [] }
	const matched: string[] = []
	const seen = new Set<string>()
	for (const mapping of mappings) {
		if (!mapping.pattern || !mapping.reasonIds?.length) { continue }
		const candidates = reports.filter((report,) => report.source !== 'user' || mapping.includeUserReports)
		if (!candidates.some((report,) => patternMatches(mapping, report.text,))) { continue }
		for (const id of mapping.reasonIds) {
			if (!seen.has(id,)) {
				seen.add(id,)
				matched.push(id,)
			}
		}
	}
	return matched
}
