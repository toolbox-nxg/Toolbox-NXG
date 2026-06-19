/** Tests for settings utilities. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const storageLocal = vi.hoisted(() => ({get: vi.fn(),}))
const runtime = vi.hoisted(() => ({sendMessage: vi.fn(),}))
const purifyObject = vi.hoisted(() => vi.fn())

vi.mock('webextension-polyfill', () => ({
	default: {runtime, storage: {local: storageLocal,},},
}),)

vi.mock('../data/purify', () => ({purifyObject,}),)

import {getAnonymizedSettings, sharedSettingPolicies,} from './settings'

describe('settings utilities', () => {
	beforeEach(() => {
		storageLocal.get.mockReset().mockResolvedValue({tbsettings: {},},)
		runtime.sendMessage.mockReset()
		purifyObject.mockClear()
	},)

	it('only exports settings with explicit sharing policies', async () => {
		storageLocal.get.mockResolvedValue({
			tbsettings: {
				'Toolbox.Utils.debugMode': true,
				'Toolbox.Future.sensitiveThing': 'do not share',
				'Toolbox.Modbar.customCSS': 'body { background: red; }',
			},
		},)

		await expect(getAnonymizedSettings(),).resolves.toEqual(
			expect.objectContaining({
				'Toolbox.Utils.debugMode': true,
			},),
		)
		const result = await getAnonymizedSettings()
		expect(result,).not.toHaveProperty('Toolbox.Future.sensitiveThing',)
		expect(result,).not.toHaveProperty('Toolbox.Modbar.customCSS',)
	})

	it('summarizes length-only and populated-only settings', async () => {
		storageLocal.get.mockResolvedValue({
			tbsettings: {
				'Toolbox.Comments.highlighted': ['alice', 'bob',],
				'Toolbox.ModButton.savedSubs': 'abc',
				'Toolbox.ModButton.lastAction': 'approve',
				'Toolbox.Notifier.modSubreddits': [],
			},
		},)

		// Module-defined settings carry their policies via extraPolicies (normally via buildPolicyMap)
		const extraPolicies = {
			'Toolbox.Comments.highlighted': 'length' as const,
			'Toolbox.ModButton.savedSubs': 'length' as const,
			'Toolbox.ModButton.lastAction': 'populated' as const,
			'Toolbox.Notifier.modSubreddits': 'populated' as const,
		}
		await expect(getAnonymizedSettings(extraPolicies,),).resolves.toMatchObject({
			'Toolbox.Comments.highlighted': 2,
			'Toolbox.ModButton.savedSubs': 3,
			'Toolbox.ModButton.lastAction': true,
			'Toolbox.Notifier.modSubreddits': false,
		},)
	})

	it('sanitizes the shared result rather than the full stored settings object', async () => {
		storageLocal.get.mockResolvedValue({
			tbsettings: {
				'Toolbox.UserNotes.defaultNoteLabel': '<b>note</b>',
				'Toolbox.Future.sensitiveThing': '<script>alert(1)</script>',
			},
		},)

		const result = await getAnonymizedSettings()

		expect(purifyObject,).toHaveBeenCalledWith(result,)
		expect(purifyObject.mock.calls[0]![0],).not.toHaveProperty('Toolbox.Future.sensitiveThing',)
	})

	it('keeps fallback Utils policies available for direct review', () => {
		expect(sharedSettingPolicies['Toolbox.Utils.debugMode'],).toBe('raw',)
		expect(sharedSettingPolicies['Toolbox.Utils.settingSub'],).toBe('populated',)
		expect(sharedSettingPolicies['Toolbox.Announcements.seenNotes'],).toBe('length',)
	})
})
