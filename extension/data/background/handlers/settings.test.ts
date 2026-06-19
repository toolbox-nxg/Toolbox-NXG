/** Tests for settings handlers. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

import {makeHandlerFinder,} from './test-helpers'

const registerMessageHandler = vi.hoisted(() => vi.fn())
const storageLocal = vi.hoisted(() => ({
	get: vi.fn(),
	set: vi.fn(),
}))

vi.mock('webextension-polyfill', () => ({
	default: {storage: {local: storageLocal,},},
}),)
vi.mock('../messageHandling', () => ({registerMessageHandler,}),)

import {registerSettingsHandlers,} from './settings'

const handlerFor = makeHandlerFinder(registerMessageHandler,)

beforeEach(() => {
	registerMessageHandler.mockClear()
	storageLocal.get.mockReset().mockResolvedValue({tbsettings: {existing: true, removeMe: 'bye',},},)
	storageLocal.set.mockReset().mockResolvedValue(undefined,)
},)

describe('settings handlers', () => {
	it('updates and deletes settings while ignoring null updates', async () => {
		registerSettingsHandlers()

		await handlerFor('toolbox-update-settings',)({
			updatedSettings: {newSetting: 1, nullSetting: null,},
			deletedSettings: ['removeMe',],
		},)

		expect(storageLocal.set,).toHaveBeenCalledWith({
			tbsettings: {existing: true, newSetting: 1,},
		},)
	})

	it('overwrites all settings with a valid settings object', async () => {
		registerSettingsHandlers()

		await handlerFor('toolbox-overwrite-all-settings',)({newSettings: {fresh: true,},},)

		expect(storageLocal.set,).toHaveBeenCalledWith({tbsettings: {fresh: true,},},)
	})

	it('rejects invalid overwrite payloads', async () => {
		const error = vi.spyOn(console, 'error',).mockImplementation(() => {},)
		registerSettingsHandlers()

		await handlerFor('toolbox-overwrite-all-settings',)({newSettings: [],},)

		expect(storageLocal.set,).not.toHaveBeenCalled()
		expect(error,).toHaveBeenCalledWith(
			expect.any(String,),
			expect.any(String,),
			expect.any(String,),
			'toolbox-overwrite-all-settings: newSettings must be a plain object',
		)
		error.mockRestore()
	})
})
