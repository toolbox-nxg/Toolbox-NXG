/** Public API helpers for the Mod Macros module, used by other modules to access macro data. */

import type {ToolboxConfig,} from '../../util/wiki/schemas/config/schema'
import {getConfig, reloadConfigFromWiki, saveToolboxConfig,} from '../config/moduleapi'
import {MacroConfig,} from './schema'

/**
 * Retrieves the macro list for the given subreddit from its toolbox wiki config.
 * @param subreddit The subreddit name (without the `r/` prefix).
 * @returns The array of macro configs, or `undefined` if no macros are configured.
 */
export async function getMacroConfig (subreddit: string,): Promise<MacroConfig[] | undefined> {
	const config = await getConfig(subreddit,)
	if (!config || !config.modMacros || config.modMacros.length < 1) {
		return undefined
	}
	return config.modMacros
}

/**
 * Reads and purifies the freshest toolbox config from the subreddit wiki. Used by the
 * macro settings tabs to refresh their list after an external wiki edit.
 * @param subreddit The subreddit name (without the `r/` prefix).
 * @returns The normalized config object, or `null` if the wiki read failed.
 */
export async function reloadToolboxConfig (subreddit: string,): Promise<ToolboxConfig | null> {
	return reloadConfigFromWiki(subreddit,)
}

/**
 * Persists the full toolbox config (including updated mod macros) to the subreddit wiki.
 * @param subreddit The subreddit name (without the `r/` prefix).
 * @param config The full toolbox config object to write.
 * @param note The wiki revision note.
 */
export function saveMacroConfig (subreddit: string, config: ToolboxConfig, note: string,): void {
	saveToolboxConfig(subreddit, config, note,)
}
