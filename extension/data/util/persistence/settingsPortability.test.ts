/** Tests for importSettings. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const readFromWiki = vi.hoisted(() => vi.fn())
const postToWiki = vi.hoisted(() => vi.fn())
const writeSettings = vi.hoisted(() => vi.fn())
const getSettings = vi.hoisted(() => vi.fn())
const purifyObject = vi.hoisted(() => vi.fn((obj,) => obj))
const getWikiReadPath = vi.hoisted(() => vi.fn().mockResolvedValue('tbsettings',))
const getWikiWritePaths = vi.hoisted(() => vi.fn().mockResolvedValue(['tbsettings',],))

vi.mock('../../api/resources/wiki', () => ({
	readFromWiki,
	postToWiki,
}),)

vi.mock('./settings', () => ({getSettings, writeSettings,}),)
vi.mock('../ui/purify', () => ({purifyObject,}),)
vi.mock('../wiki/wikiPaths', () => ({getWikiReadPath, getWikiWritePaths,}),)

import {exportSettings, importSettings,} from './settingsPortability'

describe('importSettings', () => {
	beforeEach(() => {
		readFromWiki.mockReset()
		writeSettings.mockReset().mockResolvedValue(undefined,)
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
		postToWiki.mockReset().mockResolvedValue(undefined,)
	},)

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
