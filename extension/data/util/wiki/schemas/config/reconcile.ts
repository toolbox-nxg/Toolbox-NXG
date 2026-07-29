/**
 * Config reconciliation between the canonical `toolbox-nxg` page and the
 * legacy `toolbox` mirror.
 *
 * With 6.x compatibility on, 6.x builds read and rewrite the legacy page
 * wholesale, knowing nothing about the NXG page. The NXG page is canonical,
 * so those edits have to be detected and folded back in - the config analog
 * of the usernotes reconcile path.
 *
 * Adopting the mirror discards whatever the NXG page held, so it happens only
 * behind two guards, cheapest first:
 *
 * 1. **Content.** The mirror is a deterministic down-convert of the NXG
 *    config, so the comparison is against the mirror we *would* write
 *    ({@link mirrorViewOfConfig}), not against the NXG config directly. Both
 *    sides then pass through identical transforms, which makes an unedited
 *    mirror compare equal by construction - however lossy the v1 round trip
 *    is for any particular field. (It is lossy: the mirror is written `ver: 1`
 *    and `normalizeConfig` URI-decodes every string on a v1 page, including
 *    the ones `encodeClassicConfig` never escaped.) The NXG config is still
 *    compared first, since that is the common case and costs nothing.
 * 2. **Recency.** A remaining difference is only adopted when the legacy
 *    page's newest revision is strictly newer than the canonical page's.
 *    Without this, a mirror left stale by a failed write - or by a save path
 *    that does not fan out - silently reverts the moderator's change on every
 *    subsequent read, forever, since the merged result is never written back.
 *
 * Both guards fail toward the canonical page: an unreadable revision listing
 * keeps the NXG values. Not adopting is recoverable (the next successful read
 * arbitrates again); adopting on a guess is silent data loss.
 */

import {getWikiRevisions, readFromWiki,} from '../../../../api/resources/wiki'
import {purifyObject,} from '../../../data/purify'
import createLogger from '../../../infra/logging'
import {isTombstone, OLD_WIKI_PATHS,} from '../../wikiConstants'
import {encodeClassicConfig,} from './codec'
import {ensureStableIds, normalizeConfig,} from './schema'
import type {ToolboxConfig,} from './schema'

const log = createLogger('TBConfigReconcile',)

/**
 * The config fields 6.x owns and may edit on the legacy page. Everything
 * else (`ver`, the NXG metadata keys, stable `id`s) is NXG-only and never
 * adopted from the mirror.
 */
export const LEGACY_OWNED_FIELDS = [
	'removalReasons',
	'modMacros',
	'banMacros',
] as const satisfies ReadonlyArray<keyof ToolboxConfig>

/**
 * Deep structural equality for plain JSON-ish values, ignoring object key
 * order and any `id` properties (the legacy v1 mirror strips ids, so they
 * can never participate in a meaningful comparison).
 */
function deepEqualIgnoringIds (a: unknown, b: unknown,): boolean {
	if (a === b) { return true }
	if (Array.isArray(a,) || Array.isArray(b,)) {
		if (!Array.isArray(a,) || !Array.isArray(b,) || a.length !== b.length) { return false }
		return a.every((item, i,) => deepEqualIgnoringIds(item, b[i],))
	}
	if (a && b && typeof a === 'object' && typeof b === 'object') {
		// `suggestedReasons` and `nativeSync` are NXG-only and the legacy mirror never carries them, so
		// they must not count as a difference (otherwise the NXG config always "differs" from the
		// mirror and the reconcile fires on every read, clobbering it). `id`s are stripped by the
		// legacy round-trip. Synced reasons are excluded from the mirror too, but they are whole array
		// entries rather than keys - `legacyOwnedFieldsEqual` filters those out before comparing.
		const ignored = (key: string,) => key === 'id' || key === 'suggestedReasons' || key === 'nativeSync'
		const aKeys = Object.keys(a,).filter((key,) => !ignored(key,))
		const bKeys = Object.keys(b,).filter((key,) => !ignored(key,))
		if (aKeys.length !== bKeys.length) { return false }
		return aKeys.every((key,) =>
			Object.prototype.hasOwnProperty.call(b, key,)
			&& deepEqualIgnoringIds((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key],)
		)
	}
	return false
}

/**
 * Returns the NXG value of a 6.x-owned field as the mirror would carry it, so the two
 * sides are compared like for like. Only `removalReasons` needs adjusting: reasons
 * synced from Reddit are excluded from the mirror by `encodeClassicConfig`, so they
 * have to come out of the comparison too - otherwise every read sees a difference the
 * mirror can never account for and the reconcile clobbers them.
 */
function comparableLegacyField (config: ToolboxConfig, field: typeof LEGACY_OWNED_FIELDS[number],): unknown {
	if (field !== 'removalReasons') { return config[field] }
	return {
		...config.removalReasons,
		reasons: config.removalReasons.reasons.filter((reason,) => !reason.nativeReasonId),
	}
}

/**
 * Returns `true` when the 6.x-owned fields of two normalized configs agree,
 * ignoring stable `id`s (which the legacy round-trip strips) and reasons synced
 * from Reddit (which the mirror never carries).
 */
export function legacyOwnedFieldsEqual (nxg: ToolboxConfig, legacy: ToolboxConfig,): boolean {
	return LEGACY_OWNED_FIELDS.every((field,) =>
		deepEqualIgnoringIds(comparableLegacyField(nxg, field,), legacy[field],)
	)
}

/**
 * Copies the matched NXG entry's `id` onto each adopted entry, matching by
 * content (title + text). Each NXG id is used at most once so duplicated
 * content can't produce duplicated ids; unmatched entries are left id-less
 * for `ensureStableIds` to fill in.
 */
function preserveIdsByContent (
	adopted: Array<{id?: string; title?: string; text?: string}>,
	existing: Array<{id?: string; title?: string; text?: string}>,
): void {
	const unclaimed = [...existing,]
	for (const entry of adopted) {
		const match = unclaimed.findIndex((candidate,) =>
			candidate.title === entry.title && candidate.text === entry.text
		)
		if (match !== -1) {
			const id = unclaimed[match]!.id
			if (id !== undefined) { entry.id = id }
			unclaimed.splice(match, 1,)
		} else {
			delete entry.id
		}
	}
}

/**
 * Returns a copy of the NXG config with the 6.x-owned fields replaced by the
 * legacy config's values. Stable ids on removal reasons and macros are
 * preserved by content-matching against the NXG entries (the legacy mirror
 * carries no ids); genuinely new entries get fresh ids. NXG-only keys (`ver`,
 * layout metadata, anything outside the owned fields) are untouched.
 * @param nxg The canonical normalized NXG config.
 * @param legacy The normalized legacy config to adopt 6.x edits from.
 */
export function adoptLegacyConfigFields (nxg: ToolboxConfig, legacy: ToolboxConfig,): ToolboxConfig {
	const adopted: ToolboxConfig = {...nxg,}
	for (const field of LEGACY_OWNED_FIELDS) {
		;(adopted as unknown as Record<string, unknown>)[field] = structuredClone(legacy[field],)
	}
	// `suggestedReasons` lives inside the legacy-owned `removalReasons` block but is NXG-only and
	// stripped from the mirror, so the wholesale replace above would drop it. Carry it back over
	// from the NXG config so 6.x edits to the reasons themselves don't erase the report→reason map.
	if (nxg.removalReasons.suggestedReasons) {
		adopted.removalReasons.suggestedReasons = structuredClone(nxg.removalReasons.suggestedReasons,)
	}
	// Same for the native-reason sync state, which the mirror also never carries.
	if (nxg.removalReasons.nativeSync) {
		adopted.removalReasons.nativeSync = structuredClone(nxg.removalReasons.nativeSync,)
	}
	// Reasons synced from Reddit are excluded from the mirror, so the wholesale replace dropped
	// them; they are re-appended below and keep the ids they already have. They must therefore be
	// held out of the id pool as well: a legacy-adopted reason whose title and text happen to
	// match a synced one would otherwise claim its id and leave two entries carrying it, which
	// breaks every lookup keyed on a reason id (`suggestedReasons`, proposal re-seeding).
	const synced = nxg.removalReasons.reasons.filter((reason,) => reason.nativeReasonId)
	preserveIdsByContent(
		adopted.removalReasons.reasons,
		nxg.removalReasons.reasons.filter((reason,) => !reason.nativeReasonId),
	)
	// Re-append the synced reasons, or a single 6.x save would wipe every one of them and the next
	// sync would re-import the lot as duplicates. They land at the end: their original interleaving
	// is not recoverable from a mirror that never held them.
	if (synced.length) {
		adopted.removalReasons.reasons.push(...structuredClone(synced,),)
	}
	preserveIdsByContent(adopted.modMacros, nxg.modMacros,)
	ensureStableIds(adopted,)
	return adopted
}

/**
 * Returns the config as the legacy mirror would carry it: down-converted to the
 * classic v1 wire shape and read back through the same normalization every
 * legacy read runs. Comparing this against the mirror on the wiki - rather than
 * comparing the NXG config directly - makes an unedited mirror equal by
 * construction, so a lossy v1 round trip can never be mistaken for a 6.x edit.
 *
 * Domain tags and usernote colors are deliberately not passed to the
 * down-convert: they live on their own NXG pages, and `normalizeConfig` deletes
 * both fields on read, so they can never participate in the comparison.
 * @param config The canonical normalized NXG config.
 */
export function mirrorViewOfConfig (config: ToolboxConfig,): ToolboxConfig {
	const view = encodeClassicConfig(config,) as unknown as Record<string, unknown>
	purifyObject(view,)
	normalizeConfig(view,)
	return view
}

/**
 * The newest revision timestamp (unix seconds) of a subreddit's legacy config
 * page, or `undefined` when the listing could not be read or carries no usable
 * timestamp. Never throws: an unavailable timestamp means "cannot arbitrate",
 * which the caller resolves in favor of the canonical page.
 */
async function newestLegacyRevisionTimestamp (subreddit: string,): Promise<number | undefined> {
	try {
		const revisions = await getWikiRevisions(subreddit, OLD_WIKI_PATHS.settings, 1,)
		const timestamp = revisions[0]?.timestamp
		return typeof timestamp === 'number' && Number.isFinite(timestamp,) && timestamp > 0 ? timestamp : undefined
	} catch (error) {
		log.warn(`Could not read the legacy config revisions for /r/${subreddit}:`, error,)
		return undefined
	}
}

/** What a reconcile decided, for callers that log or surface the reason. */
export type ReconcileOutcome =
	/** The mirror carries no 6.x edit (either directly equal, or equal to the mirror we would write). */
	| 'equal'
	/** The mirror was newer and its 6.x-owned fields were folded in. */
	| 'adopted'
	/** The mirror differs but is older than the canonical page, so the NXG values were kept. */
	| 'keptCanonical'
	/** The mirror differs but recency could not be established, so the NXG values were kept. */
	| 'unarbitrable'

/** Options for {@link reconcileConfigFromLegacy}. */
export interface ReconcileConfigOptions {
	/**
	 * Unix timestamp (seconds) of the canonical page revision `nxgConfig` was read
	 * from, used to arbitrate against the mirror's newest revision. Omitted when the
	 * caller could not determine it, which keeps the canonical config unchanged.
	 */
	nxgRevisionTimestamp?: number
}

/**
 * Reads the legacy `toolbox` page and folds any 6.x edits into the given NXG
 * config in memory, subject to the content and recency guards described at the
 * top of this file. The wiki is not written here - callers cache the merged
 * result and the next save persists it. Missing pages, tombstones, and
 * read/parse failures are all no-ops: a flaky mirror must never break config
 * reads, nor overwrite canonical data.
 * @param subreddit The subreddit whose legacy page to check.
 * @param nxgConfig The canonical normalized NXG config.
 * @param options Arbitration inputs (see {@link ReconcileConfigOptions}).
 * @returns The (possibly merged) config, whether anything was adopted, and why.
 */
export async function reconcileConfigFromLegacy (
	subreddit: string,
	nxgConfig: ToolboxConfig,
	options: ReconcileConfigOptions = {},
): Promise<{config: ToolboxConfig; changed: boolean; outcome: ReconcileOutcome}> {
	let legacy: ToolboxConfig
	try {
		const response = await readFromWiki<Record<string, unknown>>(subreddit, OLD_WIKI_PATHS.settings, true,)
		if (!response.ok || isTombstone(response.data,)) {
			return {config: nxgConfig, changed: false, outcome: 'equal',}
		}
		purifyObject(response.data,)
		normalizeConfig(response.data,)
		legacy = response.data
	} catch (error) {
		log.warn(`Could not read the legacy config mirror for /r/${subreddit}:`, error,)
		return {config: nxgConfig, changed: false, outcome: 'equal',}
	}

	if (legacyOwnedFieldsEqual(nxgConfig, legacy,)) {
		return {config: nxgConfig, changed: false, outcome: 'equal',}
	}

	// Guard 1: the difference may be an artifact of the v1 down-convert rather than a
	// 6.x edit. Compare against the mirror this config would produce, which round-trips
	// identically to the one on the wiki.
	if (legacyOwnedFieldsEqual(mirrorViewOfConfig(nxgConfig,), legacy,)) {
		return {config: nxgConfig, changed: false, outcome: 'equal',}
	}

	// Guard 2: a real difference. Adopt only when 6.x wrote the mirror *after* the
	// canonical page was last written - otherwise this is a stale mirror about to
	// revert an edit the moderator made in NXG.
	const legacyTimestamp = await newestLegacyRevisionTimestamp(subreddit,)
	const nxgTimestamp = options.nxgRevisionTimestamp
	if (legacyTimestamp === undefined || nxgTimestamp === undefined) {
		log.warn(
			`The 6.x mirror for /r/${subreddit} differs but could not be dated; keeping the canonical config.`,
		)
		return {config: nxgConfig, changed: false, outcome: 'unarbitrable',}
	}
	if (legacyTimestamp <= nxgTimestamp) {
		log.warn(
			`The 6.x mirror for /r/${subreddit} is older than the canonical config; keeping the NXG values `
				+ '(the next save refreshes the mirror).',
		)
		return {config: nxgConfig, changed: false, outcome: 'keptCanonical',}
	}

	log.debug(`Adopting 6.x config edits from the legacy page for /r/${subreddit}`,)
	return {config: adoptLegacyConfigFields(nxgConfig, legacy,), changed: true, outcome: 'adopted',}
}
