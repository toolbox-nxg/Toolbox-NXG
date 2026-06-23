/** Core settings read/write API: loads, persists, and anonymizes Toolbox settings in extension storage. */

import browser from 'webextension-polyfill'

import type {TbOverwriteAllSettingsMessage, TbUpdateSettingsMessage,} from '../../background/messages'
import {purifyObject,} from '../data/purify'

/**
 * How a setting is represented in the anonymized output:
 * - `'raw'` - value is included as-is (safe, non-identifying settings).
 * - `'length'` - only the array/string length is included.
 * - `'populated'` - only a boolean indicating whether the value is set.
 *
 * Most settings declare their policy via `sharedPolicy` in their `SettingDefinition`
 * and reach `getAnonymizedSettings()` through the `extraPolicies` parameter.
 * The small set of Utils settings stored outside of `defineSettings()` are kept here as a fallback.
 */
type SharedSettingPolicy = 'raw' | 'length' | 'populated'

/**
 * Fallback policy map for settings that are stored directly via `setSettingAsync`
 * rather than through a module's `defineSettings()` array.
 * All other per-module settings carry their policy via `SettingDefinition.sharedPolicy`.
 */
export const sharedSettingPolicies: Record<string, SharedSettingPolicy> = {
	'Toolbox.Utils.advancedMode': 'raw',
	'Toolbox.Utils.debugMode': 'raw',
	'Toolbox.Utils.devMode': 'raw',
	'Toolbox.Utils.longLength': 'raw',
	'Toolbox.Utils.shortLength': 'raw',
	'Toolbox.Announcements.seenNotes': 'length',
	'Toolbox.Utils.settingSub': 'populated',
	'Toolbox.Achievements.save': 'populated',
}

/**
 * A flat key-value store for all Toolbox settings. Keys are namespaced as
 * `Toolbox.{ModuleID}.{settingName}`. Values are intentionally `any` - each
 * module stores different types (strings, numbers, booleans, arrays, objects)
 * and there is no central registry of what type each key holds.
 */
export interface SettingsObject {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous store: each Toolbox.{module}.{setting} key holds a different type with no central registry; unknown would force a narrowing cast at every read site for no safety gain
	[key: string]: any
}

/** Reads the current settings object straight from extension storage. */
export async function getSettings () {
	const {tbsettings,} = await browser.storage.local.get('tbsettings',)
	return (tbsettings || {}) as SettingsObject
}

/**
 * Overwrites extension storage with a complete settings object.
 * @param newSettings The full settings object to persist.
 */
export async function writeSettings (newSettings: SettingsObject,) {
	await browser.runtime.sendMessage(
		{
			action: 'toolbox-overwrite-all-settings',
			newSettings,
		} satisfies TbOverwriteAllSettingsMessage,
	)
}

/**
 * Applies a batch of setting changes.
 * @param settings Map of setting keys to new values. Omitted keys keep their
 * stored values; keys set to `undefined` are deleted from storage; `null` is
 * not a valid setting value and is skipped.
 */
export async function updateSettings (settings: Partial<SettingsObject>,) {
	await browser.runtime.sendMessage(
		{
			action: 'toolbox-update-settings',
			updatedSettings: Object.fromEntries(Object.entries(settings,).filter(([_key, value,],) => value != null),),
			deletedSettings: Object.keys(settings,).filter((key,) => settings[key] === undefined),
		} satisfies TbUpdateSettingsMessage,
	)
}

/**
 * Reads a single setting's value, using a fallback when it has never been set.
 * @param moduleID ID of the module the setting belongs to.
 * @param setting Key of the setting.
 * @param defaultVal Value returned when the setting is unset.
 */
export async function getSettingAsync (moduleID: string, setting: string, defaultVal: unknown = undefined,) {
	const settings = await getSettings()
	const value = settings[`Toolbox.${moduleID}.${setting}`]

	if (value == null) {
		return defaultVal
	}
	return value
}

/**
 * Typed wrapper for getSettingAsync that uses module ID constants.
 * This reduces stringly-typed setting lookups and provides better type safety.
 * @param moduleID The module ID constant (use imports from moduleIds.ts)
 * @param setting Key of the setting.
 * @param defaultVal Value returned when the setting is unset.
 */
export async function getModuleSettingAsync<T = unknown,> (
	moduleID: string,
	setting: string,
	defaultVal?: T,
): Promise<T> {
	return getSettingAsync(moduleID, setting, defaultVal,)
}

/**
 * Stores a new value for a single setting.
 * @param moduleID ID of the module the setting belongs to.
 * @param setting Key of the setting.
 * @param value New value to store.
 */
export const setSettingAsync = (moduleID: string, setting: string, value: unknown,) =>
	updateSettings({
		[`Toolbox.${moduleID}.${setting}`]: value,
	},)

/**
 * Produces an anonymized copy of the settings object: sensitive entries are
 * dropped and certain others are rewritten into a non-identifying form.
 * @param extraPolicies Additional per-key policies derived from module definitions via
 *   `buildPolicyMap()` (from `framework/module`). Merged with the built-in Utils fallback.
 */
export const getAnonymizedSettings = async (extraPolicies: Record<string, SharedSettingPolicy> = {},) => {
	const settings = await getSettings()
	const sharedSettings: SettingsObject = {}
	const policies = {...sharedSettingPolicies, ...extraPolicies,}

	for (const [key, policy,] of Object.entries(policies,)) {
		const value = settings[key]
		if (policy === 'raw') {
			if (value !== undefined) {
				sharedSettings[key] = structuredClone(value,)
			}
		} else if (policy === 'length') {
			sharedSettings[key] = undefinedOrLength(value,)
		} else {
			sharedSettings[key] = undefinedOrTrue(value,)
		}
	}

	// Settings may contain user-generated content from wiki configs and removal reasons; sanitize before sharing.
	purifyObject(sharedSettings,)

	return sharedSettings

	function undefinedOrLength (setting: unknown,) {
		if (typeof setting === 'string' || Array.isArray(setting,)) {
			return setting.length
		}
		return 0
	}

	function undefinedOrTrue (setting: unknown,) {
		if (!setting) {
			return false
		}
		if (typeof setting === 'string' || Array.isArray(setting,)) {
			return setting.length > 0
		}
		if (typeof setting === 'object') {
			return Object.keys(setting,).length > 0
		}
		return false
	}
}
