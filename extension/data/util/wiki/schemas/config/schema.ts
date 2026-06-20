/** Config schema version constants, default config object, version validation, and migration infrastructure. */
import type {MacroConfig,} from '../../../../modules/macros/schema'
import type {BanMacros,} from '../../../../modules/modbutton/schema'
import type {RemovalReasonsConfig, SuggestedReasonMapping,} from '../../../../modules/removalreasons/schema'
import {tbDecode,} from '../../../data/encoding'
import createLogger from '../../../infra/logging'
import {PROPOSED_ACTION_KINDS,} from '../proposals/schema'
import {
	decodeHtmlAngleBrackets,
	htmlFieldsToTokens,
	htmlSimpleFieldsToTokens,
	type SelectDefinition,
} from '../shared/tokens'

const log = createLogger('TBConfig',)

/**
 * The current toolbox config schema version written to new wiki pages.
 *
 * **v2** (the NXG schema, stored on the `toolbox-nxg` page):
 * - Every string is stored as plain text - no `escape()`/URI encoding anywhere.
 * - Removal reason text, header, and footer use brace tokens for interactive
 *   fill-in fields (`{input: ...}`, `{textarea: ...}`, `{select: a | b}`) instead
 *   of the limited-HTML form elements v1 allowed.
 * - Removal reasons and mod macros carry a stable `id`, so future reordering
 *   and cross-references don't depend on array position.
 *
 * The classic v1 shape lives on at the legacy `toolbox` page for 6.x
 * compatibility; see `encodeClassicConfig` in `./codec` for the down-convert.
 */
export const configSchema = 2
/** The minimum config schema version this build can read. */
export const configMinSchema = 1
/** The maximum config schema version this build can read. */
export const configMaxSchema = 2

/**
 * Checks whether a parsed config object's `ver` field is within the supported schema range.
 * @param subreddit The subreddit name, used only for error logging.
 * @param config The parsed config object to validate.
 * @returns True if the version is compatible, false otherwise.
 */
export function isConfigValidVersion (subreddit: string, config: any,) {
	if (config.ver < configMinSchema || config.ver > configMaxSchema) {
		log.error(
			`config version ${config.ver} for /r/${subreddit} is outside the supported range `
				+ `${configMinSchema}–${configMaxSchema} (this build writes version ${configSchema})`,
		)
		return false
	}

	return true
}

/** The full shape of the toolbox subreddit config as stored in the wiki. */
export interface ToolboxConfig {
	/** Schema version; used by {@link migrateConfig} to apply pending upgrades. */
	ver: number
	removalReasons: RemovalReasonsConfig
	modMacros: MacroConfig[]
	/**
	 * Default ban form values.
	 * `null` means the subreddit has not configured ban macros.
	 */
	banMacros: BanMacros | null
	/**
	 * When true, retired (tombstoned) usernote shard pages left behind by shard
	 * splits are exposed as raw-editor tabs in the config overlay, alongside the
	 * active shards. Defaults to false (only active shards shown). NXG-only: this
	 * is stripped from the legacy v1 mirror in `encodeClassicConfig`.
	 */
	showRetiredUsernoteShards?: boolean
	/**
	 * When true, a usernote saved in this subreddit must have a type/tag.
	 * Combined with each moderator's personal `requireNoteType` setting per
	 * {@link usernoteRequirementOption}; see `resolveUsernoteRequirements`.
	 * Defaults to false. NXG-only: stripped from the legacy v1 mirror.
	 */
	requireUsernoteType?: boolean
	/**
	 * When true, a usernote saved in this subreddit must have body text.
	 * Combined with each moderator's personal `requireNoteText` setting per
	 * {@link usernoteRequirementOption}. Defaults to true. NXG-only.
	 */
	requireUsernoteText?: boolean
	/**
	 * When true, a usernote saved in this subreddit must include a link to the
	 * content it concerns. Combined with each moderator's personal
	 * `requireNoteLink` setting per {@link usernoteRequirementOption}. Defaults
	 * to false. NXG-only.
	 */
	requireUsernoteLink?: boolean
	/**
	 * How the three `requireUsernote*` flags apply to moderators. Uses the same
	 * token set as removal reasons' `removalOption` (`'suggest'`/`'force'`/
	 * `'leave'`): `'suggest'` and `'force'` both make the subreddit flags a floor
	 * (effective requirement is the more restrictive of the subreddit flag and the
	 * moderator's personal setting); anything else, including absent/`'leave'`,
	 * defers entirely to each moderator's personal settings. Resolved by
	 * `resolveUsernoteRequirements`. NXG-only.
	 */
	usernoteRequirementOption?: string
	/**
	 * Usernames of moderators in training mode for this subreddit. Their in-scope
	 * moderation actions are captured as proposals for review instead of being
	 * performed. Compared case-insensitively. NXG-only; stripped from the legacy
	 * v1 mirror in `encodeClassicConfig`. Defaults to none.
	 */
	trainingMods?: string[]
	/**
	 * Which moderation action types are guarded (captured as proposals) for this
	 * subreddit's trainees. A subreddit-wide set applying to every trainee.
	 * **Absent ⇒ every action is guarded** (the original all-or-nothing behavior),
	 * so existing configs are unaffected; an explicit empty array guards nothing.
	 * Entries are {@link ProposedActionType} discriminants. NXG-only; stripped from
	 * the legacy v1 mirror in `encodeClassicConfig`.
	 */
	guardedActions?: string[]
	/**
	 * How many days a resolved proposal is retained before pruning (unless its
	 * proposer acknowledges it sooner). Integer in [1, 365]. NXG-only. Defaults
	 * to 14.
	 */
	proposalRetentionDays?: number
}

/** Default empty toolbox config used when a subreddit has no existing wiki page. */
export const config: ToolboxConfig = {
	ver: configSchema,
	removalReasons: {reasons: [],},
	modMacros: [],
	banMacros: null,
	showRetiredUsernoteShards: false,
	requireUsernoteType: false,
	requireUsernoteText: true,
	requireUsernoteLink: false,
	trainingMods: [],
	proposalRetentionDays: 14,
}

/**
 * Generates a stable id for a config list entry (removal reason or macro):
 * eight base-36 characters, collision-checked by the caller via `ensureStableIds`.
 */
export function generateConfigId (): string {
	return Math.random().toString(36,).slice(2, 10,).padEnd(8, '0',)
}

/**
 * Ensures every removal reason and mod macro has a unique stable `id`,
 * assigning fresh ones where missing or duplicated. Runs on every normalize
 * (not just the v1->v2 migration) so entries created by older builds, 6.x
 * saves on the legacy page, or manual wiki edits pick up ids transparently.
 * @param config The config to update in-place.
 */
export function ensureStableIds (config: ToolboxConfig,): void {
	const seen = new Set<string>()
	const lists: Array<Array<{id?: string}>> = [
		config.removalReasons.reasons,
		config.modMacros,
		config.removalReasons.suggestedReasons ?? [],
	]
	for (const list of lists) {
		for (const entry of list) {
			if (!entry || typeof entry !== 'object') { continue }
			if (typeof entry.id !== 'string' || entry.id === '' || seen.has(entry.id,)) {
				let id = generateConfigId()
				while (seen.has(id,)) { id = generateConfigId() }
				entry.id = id
			}
			seen.add(entry.id,)
		}
	}
}

/**
 * Coerces a removal reason's `selects` field to a clean shape so hand-edited
 * wiki pages can't crash the render paths: a non-array becomes absent, and
 * entries without a string name or an array of string options are dropped.
 * A missing prompt stays missing and an empty-string prompt is removed -
 * definitions must store the prompt as absent-or-non-empty so reconcile
 * equality with the legacy mirror (where an empty `label` is never written)
 * holds.
 * @param reason The reason whose `selects` field to coerce, mutated in-place.
 */
function coerceSelectDefinitions (reason: {selects?: unknown},): void {
	if (reason.selects === undefined) { return }
	if (!Array.isArray(reason.selects,)) {
		delete reason.selects
		return
	}
	const cleaned: SelectDefinition[] = []
	for (const entry of reason.selects) {
		if (!entry || typeof entry !== 'object') { continue }
		const {name, prompt, options,} = entry as Record<string, unknown>
		if (typeof name !== 'string' || name === '' || !Array.isArray(options,)) { continue }
		const definition: SelectDefinition = {
			name,
			options: options.filter((option,): option is string => typeof option === 'string'),
		}
		if (typeof prompt === 'string' && prompt !== '') { definition.prompt = prompt }
		cleaned.push(definition,)
	}
	if (cleaned.length > 0) {
		reason.selects = cleaned
	} else {
		delete reason.selects
	}
}

/**
 * Sanitizes the `removalReasons.suggestedReasons` mapping list so hand-edited or
 * legacy wiki pages can't crash the matcher: a non-array becomes absent, and each
 * entry must have a non-empty `pattern` and at least one non-empty `reasonIds`
 * string. `matchType` keeps only an explicit `'regex'` (absent ⇒ substring);
 * `reporter` is kept only when a non-empty string; the boolean flags are stored
 * only when true. An empty result drops the field entirely.
 * @param config The config whose `removalReasons.suggestedReasons` to coerce, mutated in-place.
 */
function coerceSuggestedReasons (config: ToolboxConfig,): void {
	const raw = (config.removalReasons as {suggestedReasons?: unknown}).suggestedReasons
	if (raw === undefined) { return }
	if (!Array.isArray(raw,)) {
		delete config.removalReasons.suggestedReasons
		return
	}
	const cleaned: SuggestedReasonMapping[] = []
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') { continue }
		const {id, pattern, matchType, reporter, includeUserReports, reasonIds, oneClick,} = entry as Record<
			string,
			unknown
		>
		if (typeof pattern !== 'string' || pattern === '') { continue }
		const ids = Array.isArray(reasonIds,)
			? reasonIds.filter((value,): value is string => typeof value === 'string' && value !== '')
			: []
		if (ids.length === 0) { continue }
		const mapping: SuggestedReasonMapping = {pattern, reasonIds: ids,}
		if (typeof id === 'string' && id !== '') { mapping.id = id }
		if (matchType === 'regex') { mapping.matchType = 'regex' }
		if (typeof reporter === 'string' && reporter !== '') { mapping.reporter = reporter }
		if (includeUserReports === true) { mapping.includeUserReports = true }
		if (oneClick === true) { mapping.oneClick = true }
		cleaned.push(mapping,)
	}
	if (cleaned.length > 0) {
		config.removalReasons.suggestedReasons = cleaned
	} else {
		delete config.removalReasons.suggestedReasons
	}
}

/**
 * Converts legacy limited-HTML form elements (`<select>`, `<input>`,
 * `<textarea>`) in removal reason text, header, and footer to brace tokens,
 * first decoding any number of layers of HTML-entity-escaped angle brackets.
 * Each legacy `<select>` in reason text is extracted into a structured
 * definition on `reason.selects`, leaving a `{select:name}` reference in the
 * text. Idempotent on token-form text: no HTML remains, so no new
 * definitions are extracted on later passes.
 *
 * This is the v1 -> v2 text conversion, but it runs on every normalize (not
 * just the migration) so it doubles as healing: v2 pages written by earlier
 * builds can still carry the HTML form, and any literal `<`/`>` on those
 * pages accumulated `&amp;` layers from Reddit's content_md entity encoding
 * before `readFromWiki` learned to reverse it. Running the decode +
 * up-convert here repairs such pages on load.
 * @param config The config to update in-place.
 */
function upconvertReasonHtml (config: ToolboxConfig,): void {
	for (const reason of config.removalReasons.reasons) {
		if (!reason || typeof reason !== 'object') { continue }
		coerceSelectDefinitions(reason,)
		if (typeof reason.text !== 'string') { continue }
		const {text, selects,} = htmlFieldsToTokens(
			decodeHtmlAngleBrackets(reason.text,),
			reason.selects ?? [],
		)
		reason.text = text
		if (selects.length > 0) {
			reason.selects = [...reason.selects ?? [], ...selects,]
		}
	}
	// Header and footer have no owning reason to hold select definitions, so
	// only the inline fields are up-converted there.
	if (typeof config.removalReasons.header === 'string') {
		config.removalReasons.header = htmlSimpleFieldsToTokens(
			decodeHtmlAngleBrackets(config.removalReasons.header,),
		)
	}
	if (typeof config.removalReasons.footer === 'string') {
		config.removalReasons.footer = htmlSimpleFieldsToTokens(
			decodeHtmlAngleBrackets(config.removalReasons.footer,),
		)
	}
}

/**
 * Registered per-version config migrations, keyed by the version they upgrade FROM.
 * Add an entry here whenever the schema bumps: `configMigrations[1] = config => { ... }`.
 * Each function mutates the config in-place and the caller bumps `config.ver` afterwards.
 *
 * The v1 -> v2 upgrade has no entry: its string decode happens early in
 * `normalizeConfig` (URI decoding must precede the structural coercions) and
 * its HTML-to-token text conversion runs unconditionally there as
 * {@link upconvertReasonHtml}, because it doubles as healing for v2 pages.
 */
export const configMigrations: Record<number, (config: ToolboxConfig,) => void> = {}

/**
 * Applies all pending schema migrations to a config object in ascending version order,
 * updating `config.ver` after each step.  A no-op when the config is already current.
 * @param config The config to migrate, mutated in-place.
 */
export function migrateConfig (config: ToolboxConfig,): void {
	for (let v = config.ver; v < configSchema; v++) {
		configMigrations[v]?.(config,)
		config.ver = v + 1
	}
}

/**
 * Recursively URL-decodes all string values in an object or array in-place.
 * Old configs (6.1.25 and earlier) stored many text fields as encodeURIComponent
 * strings; this normalizes them to plain text on load so save paths don't need
 * to re-encode.
 */
function decodeAllStrings (target: any,): void {
	if (!target || typeof target !== 'object') { return }
	const items: [string | number, any,][] = Array.isArray(target,)
		? target.map((value, index,) => [index, value,])
		: Object.entries(target,)
	for (const [key, value,] of items) {
		if (typeof value === 'string') {
			;(target as any)[key] = tbDecode(value,)
		} else {
			decodeAllStrings(value,)
		}
	}
}

/**
 * Normalizes a raw (possibly legacy) parsed toolbox config object in-place and asserts
 * that it conforms to {@link ToolboxConfig} afterwards.  Covers:
 * - For classic (ver < 2) configs only, URL-decodes all string values - 6.1.25
 *   and earlier stored them encoded.  v2 configs store plain text, which must
 *   not be decoded again (a literal `%20` in reason text has to survive).
 * - Coerces every array field (`modMacros`) from the legacy empty-string representation to `[]`
 * - Ensures `removalReasons` is an object with a `reasons` array
 * - Removes the `bantitle` field from `removalReasons` (written by 6.1.25, never used)
 * - Coerces `banMacros` to `null` when it is not a non-array object
 * - Applies any pending schema migrations via {@link migrateConfig}
 * - Converts limited-HTML fill-in fields in reason text to brace tokens -
 *   for every config, not just v1, so corrupted v2 pages self-heal (see
 *   {@link upconvertReasonHtml})
 * - Ensures every removal reason and macro has a stable `id`
 */
export function normalizeConfig (config: any,): asserts config is ToolboxConfig {
	// ver: default to the classic version if missing or non-numeric, so the
	// decode gate and migrations below see a concrete version.
	if (typeof config.ver !== 'number') { config.ver = 1 }

	if (config.ver < 2) {
		decodeAllStrings(config,)
	}

	// removalReasons: must be a non-array object with a `reasons` array
	if (
		!config.removalReasons
		|| typeof config.removalReasons !== 'object'
		|| Array.isArray(config.removalReasons,)
	) {
		config.removalReasons = {reasons: [],}
	}
	if (!Array.isArray(config.removalReasons.reasons,)) {
		config.removalReasons.reasons = []
	}
	// bantitle was written by 6.1.25 and is no longer used
	delete config.removalReasons.bantitle
	// suggestedReasons: NXG-only report→reason mapping list; sanitize hand-edited/legacy shapes.
	coerceSuggestedReasons(config as ToolboxConfig,)

	// Array fields: coerce legacy empty-string (and any other non-array) to []
	if (!Array.isArray(config.modMacros,)) { config.modMacros = [] }
	// domainTags and usernoteColors live on their own wiki pages. Delete both
	// fields if present so they don't round-trip back into the config page.
	delete (config as any).domainTags
	delete (config as any).usernoteColors

	// banMacros: must be a non-array object; anything else (including legacy '') -> null
	if (!config.banMacros || typeof config.banMacros !== 'object' || Array.isArray(config.banMacros,)) {
		config.banMacros = null
	}

	// showRetiredUsernoteShards: coerce to a strict boolean so a hand-edited or
	// legacy value can only ever be true/false (absent/garbage -> false).
	config.showRetiredUsernoteShards = config.showRetiredUsernoteShards === true

	// Usernote save-requirement flags: strict booleans honoring per-field
	// defaults. type/link default off (absent/garbage -> false); text defaults on
	// (only an explicit false disables it). The mode string is left as-is; the
	// resolver treats anything but 'suggest'/'require' as 'leave'.
	config.requireUsernoteType = config.requireUsernoteType === true
	config.requireUsernoteText = config.requireUsernoteText !== false
	config.requireUsernoteLink = config.requireUsernoteLink === true

	// trainingMods: keep only non-empty strings; anything else -> empty list.
	config.trainingMods = Array.isArray(config.trainingMods,)
		? config.trainingMods.filter((m: unknown,): m is string => typeof m === 'string' && m.trim() !== '')
		: []

	// guardedActions: an *optional* per-sub allowlist of guarded action types.
	// Leave absent untouched (absent ⇒ all actions guarded); when present, keep only
	// recognized action-type discriminants (dropping garbage/renamed-away entries) so
	// the gateway never has to validate a hand-edited list at action time. An explicit
	// (possibly empty) array stays an array - that's the "guard only these" intent.
	if (config.guardedActions !== undefined) {
		config.guardedActions = Array.isArray(config.guardedActions,)
			? config.guardedActions.filter(
				(a: unknown,): a is string => typeof a === 'string' && a in PROPOSED_ACTION_KINDS,
			)
			: []
	}

	// proposalRetentionDays: clamp to an integer in [1, 365]; default 14 when
	// absent or non-numeric (hand-edited or legacy garbage).
	const retentionRaw = config.proposalRetentionDays
	config.proposalRetentionDays = typeof retentionRaw === 'number' && Number.isFinite(retentionRaw,)
		? Math.min(365, Math.max(1, Math.floor(retentionRaw,),),)
		: 14

	migrateConfig(config as ToolboxConfig,)
	upconvertReasonHtml(config as ToolboxConfig,)
	ensureStableIds(config as ToolboxConfig,)
}

/** Mutable state shared between the config overlay and all tab components for a single open session. */
export interface ConfigState {
	/** The live (possibly mutated) config object loaded from the wiki, or the default if no page exists. */
	config: any
	/** The subreddit whose config is currently loaded, or null/undefined when no overlay is open. */
	subreddit: string | null | undefined
	/** Cached post flair templates for the current subreddit, or null if not yet loaded. */
	postFlairTemplates: any
	/** Cached user flair templates for the current subreddit, or null if not yet loaded. */
	userFlairTemplates: any
}
