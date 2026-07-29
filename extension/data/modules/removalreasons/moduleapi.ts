/** Wiki and API operations for the Removal Reasons module. */

import {getNativeRemovalReasons, type NativeRemovalReason,} from '../../api/resources/removalReasons'
import type {ToolboxConfig,} from '../../util/wiki/schemas/config/schema'
import {type ConfigSaveResult, getConfig, saveToolboxConfig,} from '../config/moduleapi'
import type {RemovalReasonsConfig,} from './schema'

/**
 * Recursively resolves removal reasons for a subreddit, following `getfrom` redirects.
 * Returns the `removalReasons` config object, or `false` if not configured.
 * @param subreddit The bare subreddit name.
 * @param allowNonModerated Read even when the viewer doesn't moderate the sub. A `getfrom`
 *   redirect can point at a *different* subreddit the viewer doesn't moderate (shared removal
 *   reasons), which must still resolve; the acting sub keeps the default mod-gate.
 */
export async function getRemovalReasons (
	subreddit: string,
	allowNonModerated = false,
): Promise<RemovalReasonsConfig | false> {
	const config = await getConfig(subreddit, {allowNonModerated,},)
	if (!config || !config.removalReasons) {
		return false
	}
	// Follow getfrom redirect, guarding against self-referential configs. The source sub
	// may be one the viewer doesn't moderate, so opt that read out of the mod-gate.
	if (config.removalReasons.getfrom && config.removalReasons.getfrom !== subreddit) {
		return getRemovalReasons(config.removalReasons.getfrom, true,)
	}
	return config.removalReasons
}

/**
 * Fetches a subreddit's native (Reddit-configured) removal reasons, used both as a
 * fallback for the removal overlay when the subreddit has no Toolbox reasons configured
 * and as the source for the opt-in native reason sync. Kept here so `dom.tsx` and the
 * sync runner read native reasons through the module's api layer rather than importing
 * an `api/resources` module directly.
 * @param subreddit The bare subreddit name.
 * @param options Fetch options. `fresh` bypasses the cache and refreshes it.
 */
export function getNativeReasons (
	subreddit: string,
	options?: {fresh?: boolean},
): Promise<NativeRemovalReason[]> {
	return getNativeRemovalReasons(subreddit, options,)
}

/**
 * Saves the full toolbox wiki config for a subreddit.
 * @param subreddit The bare subreddit name.
 * @param config The full toolbox config object.
 * @param reason The wiki revision note.
 */
export function saveRemovalConfig (
	subreddit: string,
	config: ToolboxConfig,
	reason: string,
): Promise<ConfigSaveResult> {
	// Returns the promise rather than discarding it: a caller that must act only once the
	// write has landed - the sync toggle, whose sync re-reads the config it just changed -
	// has no other way to sequence itself. Fire-and-forget callers can still ignore it.
	return saveToolboxConfig(subreddit, config, reason,)
}
