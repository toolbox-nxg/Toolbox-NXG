/** Wiki and API operations for the Removal Reasons module. */

import type {ToolboxConfig,} from '../../util/wiki/schemas/config/schema'
import {getConfig, saveToolboxConfig,} from '../config/moduleapi'
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
 * Saves the full toolbox wiki config for a subreddit.
 * @param subreddit The bare subreddit name.
 * @param config The full toolbox config object.
 * @param reason The wiki revision note.
 */
export function saveRemovalConfig (subreddit: string, config: ToolboxConfig, reason: string,): void {
	void saveToolboxConfig(subreddit, config, reason,)
}
