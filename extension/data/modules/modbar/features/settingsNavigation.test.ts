/** Tests for settings navigation. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

const showSettings = vi.hoisted(() => vi.fn().mockResolvedValue(undefined,))

vi.mock('../../../framework/moduleRegistry', () => ({
	default: {showSettings,},
}),)

import {createLifecycle,} from '../../../framework/lifecycle'
import {createSettingsNavigationHandlers,} from './settingsNavigation'

describe('settings navigation', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		document.head.innerHTML = ''
		history.replaceState(null, '', '/r/test/about/toolbox',)
		showSettings.mockClear()
	},)

	afterEach(() => {
		vi.useRealTimers()
	},)

	it('opens settings on the requested module and setting after the delay', async () => {
		const lifecycle = createLifecycle()
		const {handleHashParams,} = createSettingsNavigationHandlers()
		lifecycle.on(window, 'TBHashParams', handleHashParams,)

		window.dispatchEvent(
			new CustomEvent('TBHashParams', {
				detail: {tbsettings: 'ModBar', setting: 'Enabled',},
			},),
		)
		await vi.advanceTimersByTimeAsync(500,)

		expect(showSettings,).toHaveBeenCalledExactlyOnceWith({module: 'ModBar', setting: 'Enabled',},)

		await lifecycle.cleanup()
	})

	it('opens settings with no setting target when only a module is requested', async () => {
		const lifecycle = createLifecycle()
		const {handleHashParams,} = createSettingsNavigationHandlers()
		lifecycle.on(window, 'TBHashParams', handleHashParams,)

		window.dispatchEvent(
			new CustomEvent('TBHashParams', {
				detail: {tbsettings: 'Notifier',},
			},),
		)
		await vi.advanceTimersByTimeAsync(500,)

		expect(showSettings,).toHaveBeenCalledExactlyOnceWith({module: 'Notifier',},)

		await lifecycle.cleanup()
	})

	it('ignores hash events without a toolbox settings module', async () => {
		const lifecycle = createLifecycle()
		const {handleHashParams,} = createSettingsNavigationHandlers()
		lifecycle.on(window, 'TBHashParams', handleHashParams,)

		window.dispatchEvent(new CustomEvent('TBHashParams', {detail: {setting: 'enabled',},},),)
		await vi.advanceTimersByTimeAsync(500,)

		expect(showSettings,).not.toHaveBeenCalled()

		await lifecycle.cleanup()
	})

	it('removes its listener when the lifecycle is cleaned up', async () => {
		const lifecycle = createLifecycle()
		const {handleHashParams,} = createSettingsNavigationHandlers()
		lifecycle.on(window, 'TBHashParams', handleHashParams,)
		await lifecycle.cleanup()

		window.dispatchEvent(new CustomEvent('TBHashParams', {detail: {tbsettings: 'modbar',},},),)
		await vi.advanceTimersByTimeAsync(500,)

		expect(showSettings,).not.toHaveBeenCalled()
	})
})
