/**
 * Shared types and session/persistent cache for wiki layout resolution.
 *
 * Kept in a module separate from {@link wikiPaths} so that
 * {@link wikiMigration} can record a resolved layout without importing from
 * `wikiPaths`, which in turn imports the migration helpers - breaking what
 * would otherwise be a module cycle.
 */

import {utils,} from '../../framework/moduleIds'
import {getCache, setCache,} from '../persistence/cache'

/**
 * Which wiki layout a subreddit is in:
 * - `'nxg'` - the NXG paths are canonical: read from them, write them first.
 *   Covers bootstrapped subs and data-less subs alike (pages are created on
 *   bootstrap or first save).
 * - `'legacyFallback'` - legacy data exists but the NXG pages could not be
 *   created (non-mod, bootstrap failure, or a transient resolve error); reads
 *   and writes stay on the legacy paths so data lands somewhere 6.x-visible.
 */
export type WikiLayoutState = 'nxg' | 'legacyFallback'

/**
 * Resolved wiki layout for a subreddit. The local cache of these is a
 * performance hint only - the authority is the wiki itself.
 */
export type WikiLayout = {
	subreddit: string
	state: WikiLayoutState
	/** Whether the legacy 6.x mirror is maintained (write fan-out + read-time reconciliation). */
	compatibilityWrites: boolean
	/**
	 * Set when the sub is marked as bootstrapped (tombstone in `toolbox`) but
	 * the NXG pages are missing - deleted externally. Reads will fail until
	 * the user runs a repair migration; we never silently fall back to legacy.
	 */
	nxgMissing?: boolean
	/** Why this sub is stuck on legacy reads (only when state is `'legacyFallback'`). */
	fallbackReason?: 'notMod' | 'bootstrapFailed' | 'resolveError'
	/**
	 * Set when the viewer does not moderate the sub: layout resolution skipped all
	 * wiki reads (Toolbox has no business reading a non-moderated sub's config /
	 * usernotes). Readers treat this exactly like "no config / no notes". Held
	 * session-only so getting modded later re-resolves on the next page session.
	 */
	notModerated?: true
}

/** Persistent layout cache key. */
export const LAYOUT_CACHE_KEY = 'wikiLayoutCache'

/**
 * Session-scoped layout state. The persistent TTL cache only ever holds
 * layouts we are confident about (fresh/legacy/migrated); transient or error
 * states (read failures, nxgMissing) live here only, so they are re-evaluated
 * on the next page session rather than sticking around.
 */
export const sessionLayouts = new Map<string, WikiLayout>()

/**
 * Clears the cached wiki layout for a subreddit (or all subreddits), both
 * in-session and persistent. Call after compat toggles or repair migrations
 * so the next resolution re-reads the wiki.
 * @param subreddit The subreddit to clear, or undefined to clear everything.
 */
export async function clearWikiLayoutCache (subreddit?: string,): Promise<void> {
	if (subreddit === undefined) {
		sessionLayouts.clear()
		await setCache(utils, LAYOUT_CACHE_KEY, {},)
		return
	}
	sessionLayouts.delete(subreddit,)
	const persisted = await getCache(utils, LAYOUT_CACHE_KEY, {},) as Record<string, WikiLayout>
	if (persisted[subreddit] !== undefined) {
		delete persisted[subreddit]
		await setCache(utils, LAYOUT_CACHE_KEY, persisted,)
	}
}

/**
 * Records a subreddit's resolved layout in the session cache and, for
 * confidently-known states (no read errors or missing pages), the persistent
 * TTL cache. Called by both the resolver and the migration module on success.
 * @param layout The layout to record.
 * @param persist Whether to also write the persistent cache entry.
 */
export async function setCachedWikiLayout (layout: WikiLayout, persist: boolean,): Promise<void> {
	sessionLayouts.set(layout.subreddit, layout,)
	if (!persist) { return }
	const persisted = await getCache(utils, LAYOUT_CACHE_KEY, {},) as Record<string, WikiLayout>
	persisted[layout.subreddit] = layout
	await setCache(utils, LAYOUT_CACHE_KEY, persisted,)
}

/**
 * Returns every locally known layout (session + persistent cache), keyed by
 * subreddit. A display hint only - entries may be missing or stale.
 */
export async function getCachedWikiLayouts (): Promise<Record<string, WikiLayout>> {
	const persisted = await getCache(utils, LAYOUT_CACHE_KEY, {},) as Record<string, WikiLayout>
	return {...persisted, ...Object.fromEntries(sessionLayouts,),}
}
