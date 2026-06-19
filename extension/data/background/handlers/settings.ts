/**
 * Background handlers for writing Toolbox settings into extension storage.
 *
 * The entire settings object is stored as a single JSON value under `tbsettings`,
 * so concurrent writes must be serialized. A mutex ensures all writes - from any
 * content script or background context - are applied one at a time, preventing
 * lost-update races that would otherwise occur when two callers both read before
 * either has written.
 */

import {Mutex,} from 'async-mutex'
import browser from 'webextension-polyfill'

import createLogger from '../../util/infra/logging'
import {registerMessageHandler,} from '../messageHandling'

const log = createLogger('TBSettings',)

// Safe to import here: these rely solely on `browser.storage` and hold no
// content-script state.
/** Serializes writes to the `tbsettings` key in `browser.storage.local`. */
const settingsWriteMutex = new Mutex()

/** Reads the full `tbsettings` object from storage, returning an empty object if not yet set. */
export const getSettings = async (): Promise<Record<string, any>> =>
	((await browser.storage.local.get('tbsettings',) as Record<string, any>).tbsettings ?? {}) as Record<string, any>

/** Persists a complete settings object to storage. */
const writeSettings = (newSettings: Record<string, any>,) => browser.storage.local.set({tbsettings: newSettings,},)

/** Registers `toolbox-update-settings` and `toolbox-overwrite-all-settings` message handlers. */
export function registerSettingsHandlers () {
	// JSON serialization drops `undefined` values, so deletions can't be encoded
	// as key-present-but-undefined. We use a separate `deletedSettings` array
	// rather than a null sentinel because null values would crash the
	// `.length`-accessing paths in the anonymized-settings export.
	// Merges updatedSettings into the stored object and removes all deletedSettings keys atomically.
	registerMessageHandler('toolbox-update-settings', async ({updatedSettings, deletedSettings,},) => {
		await settingsWriteMutex.runExclusive(async () => {
			const settings = await getSettings()
			for (const [key, value,] of Object.entries(updatedSettings ?? {},)) {
				if (value == null) {
					continue
				}
				settings[key] = value
			}
			for (const key of deletedSettings ?? []) {
				delete settings[key]
			}
			await writeSettings(settings,)
		},)
	},)

	// Replaces the entire tbsettings object; used for imports and full resets.
	registerMessageHandler('toolbox-overwrite-all-settings', async ({newSettings,},) => {
		if (newSettings == null || typeof newSettings !== 'object' || Array.isArray(newSettings,)) {
			log.error('toolbox-overwrite-all-settings: newSettings must be a plain object',)
			return
		}
		await settingsWriteMutex.runExclusive(async () => {
			await writeSettings(newSettings as Record<string, any>,)
		},)
	},)
}
