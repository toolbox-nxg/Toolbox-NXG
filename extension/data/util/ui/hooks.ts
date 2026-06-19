/** Custom React hooks for Toolbox: promise resolution and settings access. */

import {useCallback, useEffect, useRef, useState,} from 'react'
import {useSelector,} from 'react-redux'

import {RootState,} from '../../store'

/** A ref whose `.current` a parent calls to trigger a child's save. */
export type SaveRef = {current: (() => void) | null}

/**
 * Wires a child component's save handler up to a parent-provided {@link SaveRef}
 * so the parent (e.g. a config overlay's footer button) can trigger the save.
 * The latest `handleSave` is always invoked via an internal ref, so callers may
 * pass a fresh closure each render without re-running the effect.
 * @param saveRef The parent's ref to populate, or `undefined` to opt out.
 * @param handleSave The component's current save handler.
 */
export const useSaveRef = (saveRef: SaveRef | undefined, handleSave: () => void,) => {
	const handleSaveRef = useRef(handleSave,)
	handleSaveRef.current = handleSave
	useEffect(() => {
		if (!saveRef) { return }
		saveRef.current = () => handleSaveRef.current()
		return () => {
			saveRef.current = null
		}
	}, [],) // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Registers a document-level `keydown` listener that invokes `callback` when the
 * Escape key is pressed. The latest `callback` is always called via an internal
 * ref, so callers may pass a fresh closure each render without re-registering
 * the listener.
 * @param callback Invoked on Escape; pass `undefined` to do nothing.
 */
export const useEscapeKey = (callback: (() => void) | undefined,) => {
	const callbackRef = useRef(callback,)
	callbackRef.current = callback
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent,) => {
			if (event.key === 'Escape') { callbackRef.current?.() }
		}
		document.addEventListener('keydown', onKeyDown,)
		return () => document.removeEventListener('keydown', onKeyDown,)
	}, [],)
}

/**
 * Tracks a single in-flight async operation behind a boolean busy flag.
 *
 * Returns the current busy state plus a `runBusy` wrapper that sets the flag
 * `true` before awaiting the supplied operation and resets it in a `finally`, so
 * the flag is always cleared even if the operation throws. The flag is reset
 * before `runBusy`'s returned promise resolves, so any follow-up work the caller
 * chains after `await runBusy(...)` runs with the flag already cleared.
 * @returns A `[busy, runBusy]` tuple.
 */
export const useBusyState = (): [boolean, <T,>(operation: () => Promise<T>,) => Promise<T>,] => {
	const [busy, setBusy,] = useState(false,)
	const runBusy = useCallback(async <T,>(operation: () => Promise<T>,): Promise<T> => {
		setBusy(true,)
		try {
			return await operation()
		} finally {
			setBusy(false,)
		}
	}, [],)
	return [busy, runBusy,]
}

/** React hook that resolves a promise and returns its value. */
export const useFetched = <T,>(promise: Promise<T>,) => {
	const [value, setValue,] = useState<T | undefined>(undefined,)

	useEffect(() => {
		let valid = true
		promise.then((result,) => {
			if (valid) {
				setValue(result,)
			}
		},)

		return () => {
			valid = false
		}
	}, [],)

	return value
}

/**
 * React hook that reads a Toolbox setting from the store.
 * @template T The setting value's type.
 * @param moduleName Module ID that owns the setting.
 * @param settingName Key of the setting.
 * @param defaultValue Fallback returned while the setting is unset or settings
 * data hasn't loaded yet.
 * @returns The setting's current value, or the fallback.
 */
export const useSetting = <T,>(moduleName: string, settingName: string, defaultValue: T,): T => {
	const savedValue = useSelector((state: RootState,) => state.settings.values[`Toolbox.${moduleName}.${settingName}`])

	// Return the given default value if the setting doesn't have a value (i.e.
	// is `undefined`) *or* if the setting's value is `null` (mirroring the old
	// implementation of `getSetting` from the old `tbstorage.js`, which says
	// that `null` is never a valid value for any setting)
	if (savedValue == null) {
		return defaultValue
	}

	return savedValue
}
