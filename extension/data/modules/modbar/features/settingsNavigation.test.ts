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

	it('highlights the requested setting and opens settings after the delay', async () => {
		const lifecycle = createLifecycle()
		const {handleHashParams,} = createSettingsNavigationHandlers()
		lifecycle.on(window, 'TBHashParams', handleHashParams,)

		window.dispatchEvent(
			new CustomEvent('TBHashParams', {
				detail: {tbsettings: 'ModBar', setting: 'Enabled',},
			},),
		)
		await vi.advanceTimersByTimeAsync(500,)

		expect(document.head.querySelector('style',)?.textContent,).toContain('#toolbox-modbar-enabled',)
		expect(document.head.querySelector('style',)?.textContent,).toContain('.toolbox-setting-link-enabled',)
		expect(showSettings,).toHaveBeenCalledOnce()

		await lifecycle.cleanup()
	})

	it('opens settings without adding highlight CSS when only a module is requested', async () => {
		const lifecycle = createLifecycle()
		const {handleHashParams,} = createSettingsNavigationHandlers()
		lifecycle.on(window, 'TBHashParams', handleHashParams,)

		window.dispatchEvent(
			new CustomEvent('TBHashParams', {
				detail: {tbsettings: 'Notifier',},
			},),
		)
		await vi.advanceTimersByTimeAsync(500,)

		expect(document.head.querySelector('style',),).toBeNull()
		expect(showSettings,).toHaveBeenCalledOnce()

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
