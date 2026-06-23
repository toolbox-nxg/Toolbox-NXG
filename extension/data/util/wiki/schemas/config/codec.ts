/**
 * Wire-format codec for the classic (schema v1) subreddit config page.
 *
 * The in-memory config is always the v2 (NXG) shape: plain text everywhere
 * and brace tokens for interactive fill-in fields. The legacy `toolbox` page,
 * which 6.x parses, needs the classic v1 shape instead:
 *
 * - Removal reason text, header, and footer are `escape()`-encoded, because
 *   6.x reads them with an unconditional `unescape()`. Same for macro text.
 * - Interactive fill-in fields are the limited-HTML form (`<input>`,
 *   `<textarea>`, `<select>`), which 6.x renders directly.
 * - Stable `id` fields and the NXG layout metadata keys are stripped; 6.x
 *   rebuilds entries wholesale on save and would just drop them anyway.
 * - Domain tags and usernote colors, which NXG keeps on their own pages, are
 *   re-injected here from their NXG sources because 6.x reads both straight
 *   from the config page's `domainTags` / `usernoteColors` fields.
 *
 * The reverse (v1 -> v2) direction lives in `normalizeConfig`/`migrateConfig`,
 * which every read path already runs.
 */

import type {WikiPageCodec,} from '../../../../api/resources/wikiVersioned'
import {legacyEscape, unescapeJSON,} from '../../../data/encoding'
import {purifyObject,} from '../../../data/purify'
import {stripLayoutMetadata,} from '../../wikiConstants'
import type {DomainTag,} from '../domaintags/schema'
import {tokensToHtmlFields,} from '../shared/tokens'
import type {UserNoteColor,} from '../usernotes/schema'
import {configSchema, type LegacyConfig, normalizeConfig, type ToolboxConfig,} from './schema'

/**
 * Down-converts one reason/header/footer text: tokens -> legacy HTML (each
 * `{choice}` block becomes a `<select>`), then escape()-encoded.
 */
function encodeClassicText (text: string,): string {
	return legacyEscape(tokensToHtmlFields(text,),)
}

/**
 * Down-converts a v2 (NXG) config object to the classic v1 wire shape for the
 * legacy `toolbox` page. The input is not modified.
 *
 * Domain tags and usernote colors live on their own NXG pages, so the caller
 * passes them in; they are written back onto the legacy config as the minimal
 * v1 shapes 6.x expects (NXG-only subfields are dropped). Omitting them - or
 * passing empty arrays - leaves the corresponding field off the output.
 * @param config The normalized v2 config.
 * @param domainTags The subreddit's domain tags from its dedicated NXG page.
 * @param usernoteColors The subreddit's usernote color types from the manifest.
 * @returns A plain object safe to serialize onto the legacy page.
 */
export function encodeClassicConfig (
	config: ToolboxConfig,
	domainTags?: DomainTag[],
	usernoteColors?: UserNoteColor[],
): LegacyConfig {
	const classic = stripLayoutMetadata(structuredClone(config,),) as unknown as LegacyConfig

	classic.ver = 1

	// NXG-only display preference; 6.x has no concept of shard pages, so keep it
	// off the legacy mirror entirely.
	delete classic.showRetiredUsernoteShards

	// NXG-only usernote save-requirement settings; 6.x has no concept of them,
	// so keep all four off the legacy mirror.
	delete classic.requireUsernoteType
	delete classic.requireUsernoteText
	delete classic.requireUsernoteLink
	delete classic.usernoteRequirementOption

	// NXG-only proposals (training mode) settings; 6.x has no concept of them.
	delete classic.trainingMods
	delete classic.guardedActions
	delete classic.proposalRetentionDays

	// NXG-only report→reason mapping; 6.x has no concept of it, so keep it off the
	// legacy mirror entirely.
	delete classic.removalReasons?.suggestedReasons

	// Guarded throughout: callers normally pass a normalized config, but the
	// down-convert must never throw on a partial object (e.g. a config a mod
	// hand-edited on the wiki between normalize and save).
	if (Array.isArray(classic.removalReasons?.reasons,)) {
		for (const reason of classic.removalReasons.reasons) {
			if (typeof reason.text === 'string') {
				reason.text = encodeClassicText(reason.text,)
			}
			// A pre-migration object may still carry the old separate-definitions
			// shape; it's NXG-only and folded into the text, so drop it defensively.
			delete (reason as {selects?: unknown}).selects
			delete reason.id
		}
	}
	if (typeof classic.removalReasons?.header === 'string') {
		classic.removalReasons.header = encodeClassicText(classic.removalReasons.header,)
	}
	if (typeof classic.removalReasons?.footer === 'string') {
		classic.removalReasons.footer = encodeClassicText(classic.removalReasons.footer,)
	}

	if (Array.isArray(classic.modMacros,)) {
		for (const macro of classic.modMacros) {
			if (typeof macro.text === 'string') { macro.text = legacyEscape(macro.text,) }
			delete macro.id
		}
	}

	// Re-inject domain tags and usernote colors from their NXG sources as the
	// minimal v1 shapes 6.x reads. NXG-only subfields (the domain tag counters,
	// the per-type ban/archive/dark-mode extras) are dropped to keep the mirror
	// a clean v1 object; the dedicated NXG pages remain authoritative for them.
	if (domainTags?.length) {
		classic.domainTags = domainTags.map(({name, color, note,},) =>
			note !== undefined ? {name, color, note,} : {name, color,}
		)
	}
	if (usernoteColors?.length) {
		classic.usernoteColors = usernoteColors.map(({key, text, color,},) => ({key, text, color,}))
	}

	return classic
}

/**
 * The {@link WikiPageCodec} for the canonical NXG config page, used by the versioned
 * transport so a config save can detect a concurrent edit (it conditions the write on
 * the revision the edit was based on). `serialize` is the only part exercised on the
 * write path; `parse` is lenient because config's *read* path (`getConfig`) already
 * validates and rejects unsupported schema versions, and a conditional write's 409 is
 * surfaced as a conflict without inspecting the parsed body.
 */
export const configCodec: WikiPageCodec<ToolboxConfig> = {
	parse (raw,) {
		let obj: unknown
		try {
			obj = JSON.parse(unescapeJSON(raw,),)
		} catch {
			return {ok: false, reason: 'The config page contains invalid JSON.',}
		}
		if (obj && typeof obj === 'object') { purifyObject(obj,) }
		try {
			normalizeConfig(obj,)
		} catch {
			return {ok: false, reason: 'The config page is not a recognized toolbox config.',}
		}
		return {ok: true, data: obj,}
	},
	serialize: (data,) => JSON.stringify(data,),
	empty () {
		const config = {ver: configSchema,}
		normalizeConfig(config,)
		return config
	},
}
