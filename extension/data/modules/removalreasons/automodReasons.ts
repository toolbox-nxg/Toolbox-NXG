/**
 * Lightweight extraction of the report reasons from a subreddit's AutoModerator config: the
 * `action_reason` of every rule whose `action` is `report`, which is the text that actually shows
 * up as the report reason in the mod queue. Used to offer the real reasons as suggestions when
 * authoring suggested-reason mappings. Deliberately a focused per-document regex sweep rather than a
 * full YAML parse: AutoMod config is multi-document YAML and we only need these two single-line
 * scalar values per rule, so this avoids pulling in a YAML dependency.
 */

/** Strips one layer of matching surrounding single/double quotes from a scalar value. */
function unquote (value: string,): string {
	const trimmed = value.trim()
	if (trimmed.length >= 2) {
		const first = trimmed[0]
		const last = trimmed[trimmed.length - 1]
		if ((first === '"' || first === '\'') && last === first) {
			return trimmed.slice(1, -1,)
		}
	}
	return trimmed
}

/**
 * Reduces an AutoMod `action_reason` to a literal substring usable for matching by dropping
 * `{{placeholder}}` tokens (which AutoMod substitutes at report time, so they never appear
 * verbatim in the queue) and keeping the longest remaining static run. A reason with no
 * placeholders is returned trimmed and unchanged.
 * @param reason The raw `action_reason` value, possibly containing `{{...}}` tokens.
 */
export function staticReasonPart (reason: string,): string {
	const segments = reason.split(/\{\{[^}]*\}\}/,).map((part,) => part.trim()).filter(Boolean,)
	if (segments.length === 0) { return reason.trim() }
	return segments.reduce((longest, part,) => (part.length > longest.length ? part : longest), '',)
}

/** Matches a rule whose `action` is exactly `report` (optionally quoted). */
const actionIsReport = /^[ \t]*action[ \t]*:[ \t]*["']?report["']?[ \t]*$/im
/** Captures a rule's `action_reason` scalar value. */
const actionReasonValue = /^[ \t]*action_reason[ \t]*:[ \t]*(.*\S)[ \t]*$/im

/**
 * Extracts the distinct report reasons from a raw AutoModerator config string — the
 * `action_reason` of each `action: report` rule — in first-seen order. Surrounding quotes are
 * stripped; empty values and YAML block-scalar indicators (`>`/`|`, whose content spans following
 * lines) are skipped. Dedup is case-insensitive but preserves each reason's first-seen original
 * text.
 * @param configText The raw `config/automoderator` wiki page content.
 */
export function parseAutomodReasons (configText: string,): string[] {
	if (!configText) { return [] }
	const reasons: string[] = []
	const seen = new Set<string>()
	// AutoMod config is multiple YAML documents (rules) separated by `---` lines. Only rules that
	// report surface their `action_reason` as the queue's report reason, so check each rule in
	// isolation rather than sweeping the whole file.
	for (const rule of configText.split(/^-{3,}[ \t]*$/m,)) {
		if (!actionIsReport.test(rule,)) { continue }
		const match = rule.match(actionReasonValue,)
		if (!match) { continue }
		const value = unquote(match[1] ?? '',)
		if (value === '' || value === '>' || value === '|') { continue }
		const key = value.toLowerCase()
		if (seen.has(key,)) { continue }
		seen.add(key,)
		reasons.push(value,)
	}
	return reasons
}
