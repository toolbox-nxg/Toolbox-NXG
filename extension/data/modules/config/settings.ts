/** Setting definitions and inferred settings type for the Config module. */
import {defineSettings, InferSettings,} from '../../framework/module'

// The Config module has no global user settings: the only former setting
// (whether to show retired usernote shard pages) is now a per-subreddit field
// in the wiki config (`showRetiredUsernoteShards`), toggled from the config
// overlay's Settings Home tab.
export const settings = defineSettings([] as const,)

/** Inferred settings type for the Config module. */
export type ConfigSettings = InferSettings<typeof settings>
