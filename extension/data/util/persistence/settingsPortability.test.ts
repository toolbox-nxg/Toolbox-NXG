/** Tests for importSettings. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const readFromWiki = vi.hoisted(() => vi.fn())
const postToWiki = vi.hoisted(() => vi.fn())
const writeSettings = vi.hoisted(() => vi.fn())
const updateSettings = vi.hoisted(() => vi.fn())
const getSettings = vi.hoisted(() => vi.fn())
const purifyObject = vi.hoisted(() => vi.fn((obj,) => obj))
const getWikiReadPath = vi.hoisted(() => vi.fn().mockResolvedValue('tbsettings',))
const getWikiWritePaths = vi.hoisted(() => vi.fn().mockResolvedValue(['tbsettings',],))

vi.mock('../../api/resources/wiki', () => ({
	readFromWiki,
	postToWiki,
}),)

vi.mock('./settings', () => ({getSettings, writeSettings, updateSettings,}),)
vi.mock('../ui/purify', () => ({purifyObject,}),)
vi.mock('../wiki/wikiPaths', () => ({getWikiReadPath, getWikiWritePaths,}),)

import {exportSettings, importSettings,} from './settingsPortability'

describe('importSettings', () => {
	beforeEach(() => {
		readFromWiki.mockReset()
		writeSettings.mockReset().mockResolvedValue(undefined,)
		getSettings.mockReset().mockResolvedValue({},)
		purifyObject.mockClear()
	},)

	it('blocks import when Utils.lastversion is missing', async () => {
		readFromWiki.mockResolvedValue({ok: true, data: {'SomeModule.someSetting': 'value',},},)
		await importSettings('testsub',)
		expect(writeSettings,).not.toHaveBeenCalled()
	})

	it('blocks import when Utils.lastversion < 300', async () => {
		readFromWiki.mockResolvedValue({ok: true, data: {'Utils.lastversion': 299,},},)
		await importSettings('testsub',)
		expect(writeSettings,).not.toHaveBeenCalled()
	})

	it('imports settings and adds Toolbox. prefix when version >= 300', async () => {
		readFromWiki.mockResolvedValue({
			ok: true,
			data: {
				'Utils.lastversion': 300,
				'Utils.debugMode': false,
			},
		},)
		await importSettings('testsub',)
		expect(writeSettings,).toHaveBeenCalledWith({
			'Toolbox.Utils.lastversion': 300,
			'Toolbox.Utils.debugMode': false,
		},)
	})

	it('filters out keys in the doNotImport list', async () => {
		readFromWiki.mockResolvedValue({
			ok: true,
			data: {
				'Utils.lastversion': 400,
				'oldreddit.enabled': true,
				'Utils.advancedMode': true,
			},
		},)
		await importSettings('testsub',)
		const written = writeSettings.mock.calls[0]![0]
		expect(written,).not.toHaveProperty('Toolbox.oldreddit.enabled',)
		expect(written,).toHaveProperty('Toolbox.Utils.advancedMode', true,)
	})

	it('preserves current values for doNotImport keys instead of dropping them', async () => {
		getSettings.mockResolvedValue({
			'Toolbox.oldreddit.enabled': true,
			'Toolbox.Utils.settingSub': 'mybackupsub',
		},)
		readFromWiki.mockResolvedValue({
			ok: true,
			data: {
				'Utils.lastversion': 400,
				'oldreddit.enabled': false,
				'Utils.settingSub': 'someothersub',
				'Utils.advancedMode': true,
			},
		},)
		await importSettings('testsub',)
		const written = writeSettings.mock.calls[0]![0]
		// Backed-up doNotImport values are ignored; the current values survive the overwrite.
		expect(written,).toHaveProperty('Toolbox.oldreddit.enabled', true,)
		expect(written,).toHaveProperty('Toolbox.Utils.settingSub', 'mybackupsub',)
		expect(written,).toHaveProperty('Toolbox.Utils.advancedMode', true,)
	})

	it.each(
		[
			{ok: false, reason: 'no_page',},
			{ok: false, reason: 'unknown_error',},
			{ok: false, reason: 'invalid_json',},
		] as const,
	)('returns early without writing when wiki returns $reason', async (sentinel,) => {
		readFromWiki.mockResolvedValue(sentinel,)
		await importSettings('testsub',)
		expect(writeSettings,).not.toHaveBeenCalled()
	},)
})

describe('exportSettings', () => {
	beforeEach(() => {
		getSettings.mockReset()
		updateSettings.mockReset().mockResolvedValue(undefined,)
		postToWiki.mockReset().mockResolvedValue(undefined,)
	},)

	it('persists the backup sub and a last-export timestamp without overwriting all settings', async () => {
		getSettings.mockResolvedValue({'Toolbox.Utils.debugMode': true,},)
		await exportSettings('testsub',)
		const [persisted,] = updateSettings.mock.calls[0]!
		expect(persisted,).toHaveProperty('Toolbox.Utils.settingSub', 'testsub',)
		expect(typeof persisted['Toolbox.Modbar.lastExport'],).toBe('number',)
	})

	it('strips Toolbox. prefix from exported keys', async () => {
		getSettings.mockResolvedValue({
			'Toolbox.Utils.debugMode': true,
			'Toolbox.Modbar.shortcuts': [],
		},)
		await exportSettings('testsub',)
		const [, , exported,] = postToWiki.mock.calls[0]!
		expect(exported,).toHaveProperty('Utils.debugMode', true,)
		expect(exported,).toHaveProperty('Modbar.shortcuts',)
		expect(exported,).not.toHaveProperty('Toolbox.Utils.debugMode',)
	})

	it('excludes the Storage.setting key', async () => {
		getSettings.mockResolvedValue({
			'Toolbox.Utils.debugMode': false,
			'Toolbox.Storage.setting': 'internal',
		},)
		await exportSettings('testsub',)
		const [, , exported,] = postToWiki.mock.calls[0]!
		expect(exported,).not.toHaveProperty('Storage.setting',)
		expect(exported,).toHaveProperty('Utils.debugMode',)
	})

	it('fans out to both wiki paths when 6.x compatibility is on', async () => {
		getSettings.mockResolvedValue({'Toolbox.Utils.debugMode': true,},)
		getWikiWritePaths.mockResolvedValueOnce(['tbsettings', 'toolbox-nxg/user-settings',],)
		await exportSettings('testsub',)
		const pages = postToWiki.mock.calls.map((call,) => call[1])
		expect(pages,).toEqual(['tbsettings', 'toolbox-nxg/user-settings',],)
	})

	it('excludes null and undefined values', async () => {
		getSettings.mockResolvedValue({
			'Toolbox.Utils.debugMode': false,
			'Toolbox.Utils.nullSetting': null,
			'Toolbox.Utils.undefSetting': undefined,
		},)
		await exportSettings('testsub',)
		const [, , exported,] = postToWiki.mock.calls[0]!
		expect(exported,).not.toHaveProperty('Utils.nullSetting',)
		expect(exported,).not.toHaveProperty('Utils.undefSetting',)
		expect(exported,).toHaveProperty('Utils.debugMode',)
	})
})
