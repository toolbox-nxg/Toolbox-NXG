/**
 * Redux slice that holds a live copy of all Toolbox settings values.
 * State shape: `{ initialLoadState, values }` where `values` is a flat key->any map
 * of `Toolbox.{ModuleID}.{settingName}` keys.
 */

import {createSlice, type PayloadAction,} from '@reduxjs/toolkit'
import browser from 'webextension-polyfill'

import createLogger from '../util/infra/logging'
import {getSettings, SettingsObject,} from '../util/persistence/settings'
import {type AppThunk,} from './index'

enum SettingsInitialLoadState {
	Pending,
	Loaded,
	Failed,
}

/**
 * Change-detection equality for setting values. `storage.onChanged` hands us
 * freshly deserialized objects, so array/map settings are always new references
 * even when unchanged; a `!==` comparison would fire `tb-setting-changed` on
 * every write. Compare objects/arrays by content (values are JSON-serializable,
 * and both sides come from the same storage serialization so key order matches).
 */
function settingValuesEqual (a: unknown, b: unknown,): boolean {
	if (a === b) { return true }
	if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
		return JSON.stringify(a,) === JSON.stringify(b,)
	}
	return false
}

interface SettingsState {
	initialLoadState: SettingsInitialLoadState
	values: SettingsObject
}

const settingsSlice = createSlice({
	name: 'settings',
	initialState: {
		initialLoadState: SettingsInitialLoadState.Pending,
		values: {},
	} satisfies SettingsState as SettingsState,
	reducers: {
		/**
		 * The entire settings state is overwritten with a snapshot of the
		 * actual saved state from extension storage
		 */
		settingsLoaded (_state, action: PayloadAction<{values: SettingsObject}>,) {
			// overwrite state completely
			return {
				initialLoadState: SettingsInitialLoadState.Loaded,
				values: action.payload.values,
			}
		},

		/** We failed to load settings somehow?? */
		settingsLoadFailed () {
			return {
				initialLoadState: SettingsInitialLoadState.Failed,
				values: {},
			}
		},
	},
},)
export default settingsSlice.reducer

const {
	settingsLoaded,
	settingsLoadFailed,
} = settingsSlice.actions

/** Guards against registering the storage listener more than once. */
let settingsListenerRegistered = false

/** Resets the listener registration guard. For use in tests only. */
export function resetSettingsListenerForTesting () {
	settingsListenerRegistered = false
}

/** Loads the initial settings values into the Redux store. */
export const loadSettings = (): AppThunk<Promise<void>> => async (dispatch,) => {
	let settings: SettingsObject
	try {
		settings = await getSettings()
	} catch (error) {
		// it should be impossible for this initial load to fail - should either
		// load correctly or just never resolve. but I'm adding an error handler
		// for it anyway, because toolbox has a strange knack for failing in
		// ways that developers think should be impossible
		const log = createLogger('store:settings',)
		log.error('Failed to load initial settings', error,)
		dispatch(settingsLoadFailed(),)
		return
	}

	// fill in the store with initial settings
	dispatch(settingsLoaded({values: settings,},),)

	// update the store in response to all future settings updates
	if (!settingsListenerRegistered) {
		settingsListenerRegistered = true
		browser.storage.onChanged.addListener((changes, storageArea,) => {
			// settings are stored locally, we don't care about anything else
			if (storageArea !== 'local') {
				return
			}
			for (const [key, {oldValue, newValue,},] of Object.entries(changes,)) {
				// we only care about the storage key where settings are stored
				if (key !== 'tbsettings') {
					continue
				}

				// Dispatch an update to the store with the new settings values
				dispatch(settingsLoaded({values: newValue as SettingsObject,},),)

				// Notify module onChange() listeners about each individual key that changed.
				// Guard for content-script context - window is not available in background scripts.
				if (typeof window !== 'undefined') {
					const prev = (oldValue ?? {}) as SettingsObject
					const next = (newValue ?? {}) as SettingsObject
					const allKeys = new Set([...Object.keys(prev,), ...Object.keys(next,),],)
					for (const settingKey of allKeys) {
						if (!settingValuesEqual(prev[settingKey], next[settingKey],)) {
							window.dispatchEvent(
								new CustomEvent('tb-setting-changed', {
									detail: {key: settingKey, newValue: next[settingKey],},
								},),
							)
						}
					}
				}
			}
		},)
	}
}
