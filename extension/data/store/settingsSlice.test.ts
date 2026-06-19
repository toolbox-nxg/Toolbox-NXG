/** Tests for settingsSlice. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const addListener = vi.hoisted(() => vi.fn())
const getSettings = vi.hoisted(() => vi.fn())
const logError = vi.hoisted(() => vi.fn())

vi.mock('webextension-polyfill', () => ({
	default: {storage: {onChanged: {addListener,},},},
}),)
vi.mock('../util/persistence/settings', () => ({getSettings,}),)
vi.mock('../util/infra/logging', () => ({default: () => ({error: logError,}),}),)

import reducer, {loadSettings, resetSettingsListenerForTesting,} from './settingsSlice'

describe('settingsSlice', () => {
	beforeEach(() => {
		addListener.mockClear()
		getSettings.mockReset()
		logError.mockClear()
		resetSettingsListenerForTesting()
	},)

	it('starts pending with empty values', () => {
		expect(reducer(undefined, {type: 'init',},),).toEqual({
			initialLoadState: 0,
			values: {},
		},)
	})

	it('loads settings and registers a local storage change listener', async () => {
		getSettings.mockResolvedValue({modbar: {enabled: true,},},)
		const dispatch = vi.fn()

		await loadSettings()(dispatch, () => ({}), undefined,)

		expect(dispatch,).toHaveBeenCalledWith({
			type: 'settings/settingsLoaded',
			payload: {values: {modbar: {enabled: true,},},},
		},)
		expect(addListener,).toHaveBeenCalledOnce()
	})

	it('dispatches settings updates from local tbsettings storage changes', async () => {
		getSettings.mockResolvedValue({},)
		const dispatch = vi.fn()
		await loadSettings()(dispatch, () => ({}), undefined,)
		const listener = addListener.mock.calls[0]![0]

		listener({tbsettings: {newValue: {notifier: {enabled: false,},},},}, 'local',)
		listener({tbsettings: {newValue: {ignored: true,},},}, 'sync',)
		listener({other: {newValue: {ignored: true,},},}, 'local',)

		expect(dispatch,).toHaveBeenCalledTimes(2,)
		expect(dispatch,).toHaveBeenLastCalledWith({
			type: 'settings/settingsLoaded',
			payload: {values: {notifier: {enabled: false,},},},
		},)
	})

	it('dispatches a failure action when initial settings load rejects', async () => {
		getSettings.mockRejectedValue(new Error('boom',),)
		const dispatch = vi.fn()

		await loadSettings()(dispatch, () => ({}), undefined,)

		expect(logError,).toHaveBeenCalled()
		expect(dispatch,).toHaveBeenCalledWith({type: 'settings/settingsLoadFailed', payload: undefined,},)
	})
})
