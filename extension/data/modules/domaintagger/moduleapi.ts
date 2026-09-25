/**
 * API helpers for reading and writing domain tag data to a subreddit's dedicated
 * `toolbox-nxg/domain-tags` wiki page, separate from the main toolbox config.
 */
import {isModSub,} from '../../api/resources/modSubs'
import {getWikiRevisions, readFromWiki,} from '../../api/resources/wiki'
import {negativeTextFeedback, neutralTextFeedback, positiveTextFeedback,} from '../../store/feedback'
import {purifyObject,} from '../../util/data/purify'
import createLogger from '../../util/infra/logging'
import {clearCache,} from '../../util/persistence/cache'
import {mutateWikiPage, type WikiMutator,} from '../../util/wiki/mutateWikiPage'
import type {LegacyDomainTag,} from '../../util/wiki/schemas/config/schema'
import {
	decodeDomainTagsPage,
	domainTagsCodec,
	makeDefaultDomainTagsData,
} from '../../util/wiki/schemas/domaintags/codec'
import {legacyDomainTagsRepair,} from '../../util/wiki/schemas/domaintags/schema'
import type {DomainTag, DomainTagsData,} from '../../util/wiki/schemas/domaintags/schema'
import {DOMAIN_TAGS_PAGE,} from '../../util/wiki/wikiConstants'
import {recoverLegacyDomainTags,} from '../../util/wiki/wikiMigration'

import {findTagForDomain,} from './matching'

export type {DomainTag, DomainTagsData,}

const log = createLogger('DTagger',)

/** Session-scoped in-memory cache: subreddit -> loaded DomainTagsData. */
const dataCache = new Map<string, DomainTagsData>()

/**
 * Builds a {@link DomainTag} from a source tag with its approval/removal counts zeroed.
 * Copies `note` only when the source defines one. The `removalThreshold` is dropped unless
 * `keepThreshold` is set, since counts and thresholds are subreddit-local metadata that must
 * not carry across imports or legacy-config migrations.
 * @param source The tag to copy name/color (and optionally note/threshold) from.
 * @param keepThreshold When true, copies `removalThreshold` if the source defines one.
 * @returns A new tag with `approvalCount`/`removalCount` set to 0.
 */
function makeZeroedTag (
	source: {name: string; color: string; note?: string; removalThreshold?: number},
	keepThreshold = false,
): DomainTag {
	const tag: DomainTag = {name: source.name, color: source.color, approvalCount: 0, removalCount: 0,}
	if (source.note !== undefined) { tag.note = source.note }
	if (keepThreshold && source.removalThreshold !== undefined) { tag.removalThreshold = source.removalThreshold }
	return tag
}

/**
 * Reads the domain tags data for a subreddit from its dedicated wiki page,
 * with migration from the legacy `ToolboxConfig.domainTags` field on first access.
 * Returns a fresh default object when no wiki page exists yet.
 * @param subreddit The subreddit name.
 */
export async function getDomainTagsData (subreddit: string,): Promise<DomainTagsData> {
	const cached = dataCache.get(subreddit,)
	if (cached !== undefined) { return cached }

	const response = await readFromWiki<Record<string, unknown>>(subreddit, DOMAIN_TAGS_PAGE, true,)

	if (response.ok) {
		purifyObject(response.data,)
		const decoded = decodeDomainTagsPage(response.data, subreddit,)
		if (decoded) {
			dataCache.set(subreddit, decoded,)
			if (!decoded.tags.length && !decoded.repairs?.includes(legacyDomainTagsRepair,)) {
				// Background, one-time: the read itself never waits on the repair.
				void repairLegacyDomainTags(subreddit,)
			}
			return decoded
		}
	}

	if (response.ok === false && response.reason !== 'no_page') {
		// Transient error - don't cache, return a default so the page still renders.
		log.warn(`Could not read domain tags for /r/${subreddit} (${response.reason}); using defaults`,)
		return makeDefaultDomainTagsData()
	}

	// Page doesn't exist yet. Domain tags are part of the expected NXG config, so
	// we persist a stub - a default, or one seeded with the legacy config's inline
	// domainTags - so subsequent reads find a real page instead of 404ing (which
	// logs a noisy TBApi error on every load otherwise).
	const freshData = makeDefaultDomainTagsData()

	// Only create the page for subs the viewer moderates: the write needs wiki
	// perms, so persisting to a foreign sub (e.g. the import-tags feature reading
	// another sub's tags) would 403 and pop an error toast. Non-mod reads just
	// return the in-memory default without writing anything.
	let moderatesSub = false
	try {
		moderatesSub = await isModSub(subreddit,)
	} catch (err: unknown) {
		log.warn(`Could not determine mod status for /r/${subreddit}; skipping domain-tags page creation`, err,)
	}
	if (moderatesSub) {
		let legacyTags: LegacyDomainTag[] = []
		try {
			legacyTags = await recoverLegacyDomainTags(subreddit,)
			// Seeded from the legacy history already, so the repair for early empty
			// stubs has nothing left to do here.
			freshData.repairs = [legacyDomainTagsRepair,]
		} catch (err: unknown) {
			log.warn(`Could not read legacy domain tags for /r/${subreddit}; the repair will retry`, err,)
		}
		if (legacyTags.length > 0) {
			log.debug(`Migrating ${legacyTags.length} legacy domain tags for /r/${subreddit}`,)
			freshData.tags = legacyTags.map((t,) => makeZeroedTag(t,))
		}
		// Persist immediately so subsequent reads don't re-migrate or re-404.
		const reason = legacyTags.length > 0
			? 'domain tagger: migrate tags to dedicated page'
			: 'domain tagger: initialize domain tags page'
		// No classic-page refresh: this data was just read from it.
		await replaceDomainTagsData(subreddit, freshData, reason, false,)
	}

	dataCache.set(subreddit, freshData,)
	return freshData
}

/** Subreddits with a {@link repairLegacyDomainTags} run in flight, so concurrent reads don't each scan the history. */
const legacyDomainTagsRepairsInFlight = new Set<string>()

/**
 * Restores domain tags that early builds lost by creating this page as an
 * empty stub instead of seeding it from the legacy config, recovering them
 * from the legacy config's revision history. Only an untouched stub (a single
 * revision) is restored - a page edited since may have been emptied on
 * purpose. The repair marker is recorded either way, so it runs once per
 * subreddit; a failure is logged and retried on a later session.
 *
 * Writes directly rather than through {@link mutateDomainTags}: it runs
 * unprompted, so it must not toast or clear caches.
 */
async function repairLegacyDomainTags (subreddit: string,): Promise<void> {
	if (legacyDomainTagsRepairsInFlight.has(subreddit,)) { return }
	legacyDomainTagsRepairsInFlight.add(subreddit,)
	try {
		if (!await isModSub(subreddit,)) { return }
		const revisions = await getWikiRevisions(subreddit, DOMAIN_TAGS_PAGE, 2,)
		const recovered = revisions.length === 1 ? await recoverLegacyDomainTags(subreddit,) : []
		await mutateWikiPage<DomainTagsData, void>({
			subreddit,
			page: DOMAIN_TAGS_PAGE,
			codec: domainTagsCodec,
			reason: 'domain tagger: restore tags lost in migration',
			writeOptions: {listed: 'true',},
			mutator: (current,) => {
				if (current.repairs?.includes(legacyDomainTagsRepair,)) { return {write: false, result: undefined,} }
				// Re-checked against fresh data: never overwrite tags added meanwhile.
				if (!current.tags.length) { current.tags = recovered.map((t,) => makeZeroedTag(t,)) }
				current.repairs = [...current.repairs ?? [], legacyDomainTagsRepair,]
				return {write: true, result: undefined,}
			},
			onCommit: (subreddit, data,) => {
				dataCache.set(subreddit, structuredClone(data,),)
			},
		},)
		log.info(`Restored ${recovered.length} domain tags for /r/${subreddit}`,)
		if (recovered.length > 0) {
			const {refreshClassicConfigInlineFields,} = await import('../config/moduleapi')
			await refreshClassicConfigInlineFields(subreddit, 'domain tagger: restore tags lost in migration',)
		}
	} catch (err: unknown) {
		log.warn(`Could not repair domain tags for /r/${subreddit}:`, err,)
	} finally {
		legacyDomainTagsRepairsInFlight.delete(subreddit,)
	}
}

/**
 * Conflict-safe mutation of a subreddit's domain tags page. Reads the current page,
 * applies `mutator` to it, and writes conditioned on that revision - a concurrent
 * writer elsewhere causes a re-apply against fresh data rather than a silent clobber.
 * 6.x reads domain tags inline from the classic config page, so a tag edit also
 * rewrites that page on subs that keep it (compat mirror or legacy fallback). Owns
 * the standard save feedback + cache invalidation; never rejects (failures surface
 * as a toast), matching the old fire-and-forget save.
 * @param subreddit The subreddit whose domain tags to mutate.
 * @param mutator Applies the change to the current data (re-run on every conflict retry).
 * @param reason The wiki revision note.
 * @param refreshClassic Whether to rewrite the classic config page after a write.
 *   Off for changes it doesn't carry (stat counters) or data read from it.
 */
async function mutateDomainTags (
	subreddit: string,
	mutator: WikiMutator<DomainTagsData, void>,
	reason: string,
	refreshClassic: boolean,
): Promise<void> {
	log.debug('saving domain tags to wiki',)
	// Dynamic import: config/moduleapi imports this module (for its down-convert),
	// so a static import would form a cycle.
	const configApi = refreshClassic ? await import('../config/moduleapi') : undefined
	// Checked before the write, which bumps the page it compares against.
	const overwriteWarning = await configApi?.unsyncedClassicEditsWarning(subreddit, 'domainTags',)
	neutralTextFeedback('saving to wiki',)
	let committed = false
	try {
		await mutateWikiPage<DomainTagsData, void>({
			subreddit,
			page: DOMAIN_TAGS_PAGE,
			codec: domainTagsCodec,
			reason,
			mutator,
			writeOptions: {listed: 'true',},
			onCommit: (subreddit, data,) => {
				// Keep the in-memory cache in step with the freshly written page.
				dataCache.set(subreddit, structuredClone(data,),)
				committed = true
			},
		},)
		if (committed) {
			// Only invalidate caches and report success when a write actually landed
			// (a no-op mutation neither wrote nor needs a "saved" toast).
			await clearCache()
			// 6.x reads domain tags inline from the classic config page.
			const classic = await configApi?.refreshClassicConfigInlineFields(subreddit, reason,)
			if (classic && !classic.ok) {
				negativeTextFeedback(
					`Domain tags saved, but the toolbox config page was not updated - mods on Toolbox 6.x will see `
						+ `the old tags: ${classic.message}`,
				)
			} else if (overwriteWarning) {
				// Shown after the save so its own feedback can't replace it.
				negativeTextFeedback(overwriteWarning, {duration: 10_000,},)
			} else {
				positiveTextFeedback('wiki page saved',)
			}
		}
	} catch (err: unknown) {
		log.error(err,)
		const responseText = err && typeof err === 'object' && 'responseText' in err
			? String(err.responseText,)
			: String(err,)
		negativeTextFeedback(responseText,)
	}
}

/**
 * Replaces a subreddit's entire domain tags page with `data` (the bulk-editor save).
 * Goes through the same conflict-safe path as the per-tag edits so writes to the page
 * stay serialized; a full replace intentionally supersedes whatever is there.
 * @param subreddit The subreddit name.
 * @param data The complete domain tags data to persist.
 * @param reason The wiki revision note.
 */
export function saveDomainTagsData (subreddit: string, data: DomainTagsData, reason: string,): Promise<void> {
	return replaceDomainTagsData(subreddit, data, reason, true,)
}

/** Implements {@link saveDomainTagsData}; see {@link mutateDomainTags} for `refreshClassic`. */
function replaceDomainTagsData (
	subreddit: string,
	data: DomainTagsData,
	reason: string,
	refreshClassic: boolean,
): Promise<void> {
	return mutateDomainTags(
		subreddit,
		(current,) => {
			// Overwrite the canonical fields in place so the loop persists this exact data.
			current.ver = data.ver
			current.showCounts = data.showCounts
			current.tags = structuredClone(data.tags,)
			if (data.repairs?.length) { current.repairs = [...data.repairs,] }
			return {write: true, result: undefined,}
		},
		reason,
		refreshClassic,
	)
}

/**
 * Adds, updates, or removes a single domain tag. A tag with `color: 'none'` removes it.
 * Preserves existing `approvalCount`, `removalCount`, and `note` values on update.
 * @param subreddit The subreddit whose domain tags to update.
 * @param domainTag The tag to add, update, or remove. `approvalCount`/`removalCount` default to 0 for new tags.
 */
export async function saveDomainTag (subreddit: string, domainTag: DomainTag,): Promise<void> {
	if (!domainTag.name) { return }

	// The reason is decided up front for the revision note; the authoritative
	// add/update/delete decision is re-derived inside the mutator against fresh data.
	const reason = domainTag.color === 'none' ? `delete tag "${domainTag.name}"` : `save tag "${domainTag.name}"`

	await mutateDomainTags(
		subreddit,
		(current,) => {
			const existingIndex = current.tags.findIndex((t,) => t.name === domainTag.name)

			if (domainTag.color === 'none') {
				// Nothing to remove (already gone, possibly via a concurrent writer): no-op.
				if (existingIndex === -1) { return {write: false, result: undefined,} }
				current.tags.splice(existingIndex, 1,)
				return {write: true, result: undefined,}
			}

			if (existingIndex !== -1) {
				// Preserve counts; only update editable fields.
				const existing = current.tags[existingIndex]!
				const merged: DomainTag = {
					name: existing.name,
					color: domainTag.color,
					approvalCount: existing.approvalCount,
					removalCount: existing.removalCount,
				}
				if (domainTag.note !== undefined) { merged.note = domainTag.note }
				if (domainTag.removalThreshold !== undefined) { merged.removalThreshold = domainTag.removalThreshold }
				current.tags[existingIndex] = merged
			} else {
				current.tags.push(makeZeroedTag(domainTag, true,),)
			}
			return {write: true, result: undefined,}
		},
		reason,
		true,
	)
}

/**
 * Increments the approval or removal counter for the domain tag that matches the given domain.
 * No-ops silently if no tag matches (untagged domains are not tracked).
 * Uses a read->mutate->write cycle with the per-subreddit save queue.
 * @param subreddit The subreddit where the mod action occurred.
 * @param domain The domain string extracted from the post.
 * @param action Whether the post was approved or removed.
 */
export async function incrementDomainStat (
	subreddit: string,
	domain: string,
	action: 'approve' | 'remove',
): Promise<void> {
	// Cheap cached pre-check: most mod actions are on untagged domains, and this is
	// called on every approve/remove. Skip the whole save path (and its "saving..."
	// toast) when the cached view has no matching tag; the mutator re-checks fresh
	// data for correctness when there is one.
	const cached = await getDomainTagsData(subreddit,)
	if (!findTagForDomain(domain, cached.tags,)) { return }

	await mutateDomainTags(
		subreddit,
		(current,) => {
			// Find the tag matching this domain (exact -> glob -> suffix), then locate its
			// index so we can bump the stat counter. Shares the matcher with the DOM layer.
			const matched = findTagForDomain(domain, current.tags,)
			if (!matched) { return {write: false, result: undefined,} }
			const index = current.tags.indexOf(matched,)
			if (action === 'approve') {
				current.tags[index]!.approvalCount++
			} else {
				current.tags[index]!.removalCount++
			}
			return {write: true, result: undefined,}
		},
		`domain tagger: recorded ${action} for ${domain}`,
		false,
	)
}

/**
 * Reads the domain tags from a foreign subreddit for the import feature.
 * Returns only the tag definitions (name, color, note) - counts are never imported.
 * @param sourceSubreddit The subreddit to read domain tags from.
 * @returns The tag array stripped of counts, or `null` if the subreddit has none configured.
 */
export async function fetchDomainTagsFromSubreddit (sourceSubreddit: string,): Promise<DomainTag[] | null> {
	const data = await getDomainTagsData(sourceSubreddit,)
	if (!data.tags.length) { return null }
	// Strip counts and thresholds - those are subreddit-local metadata.
	return data.tags.map((t,) => makeZeroedTag(t,))
}

/**
 * Invalidates the in-memory cache for a subreddit so the next read fetches fresh data.
 * Called automatically after successful saves; callers may also call it on demand.
 * @param subreddit The subreddit to invalidate, or omit to clear the entire cache.
 */
export function invalidateDomainTagsCache (subreddit?: string,): void {
	if (subreddit === undefined) {
		dataCache.clear()
	} else {
		dataCache.delete(subreddit,)
	}
}
