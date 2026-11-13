/** Tests for settings migrations. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const runtime = vi.hoisted(() => ({sendMessage: vi.fn(),}))
const getCurrentUser = vi.hoisted(() => vi.fn())
const setWikiPageSettings = vi.hoisted(() => vi.fn())
const getCache = vi.hoisted(() => vi.fn())
const setCache = vi.hoisted(() => vi.fn())
const store = vi.hoisted(() => new Map<string, unknown>())

vi.mock('webextension-polyfill', () => ({
	default: {runtime,},
}),)
vi.mock('../../store/feedback', () => ({negativeTextFeedback: vi.fn(),}),)

vi.mock('../../api/resources/me', () => ({getCurrentUser,}),)
vi.mock('../../api/resources/wiki', () => ({setWikiPageSettings,}),)
vi.mock('./cache', () => ({getCache, setCache,}),)
vi.mock('../infra/version', () => ({
	getLastVersion: vi.fn().mockResolvedValue(60124,),
	versionNumber: 80000,
}),)
vi.mock('./settings', () => ({
	getSettingAsync: vi.fn(async (module: string, setting: string, defaultValue: unknown,) => {
		const key = `Toolbox.${module}.${setting}`
		return store.has(key,) ? store.get(key,) : defaultValue
	},),
	getSettings: vi.fn(async () => Object.fromEntries(store.entries(),)),
	setSettingAsync: vi.fn(async (module: string, setting: string, value: unknown,) => {
		const key = `Toolbox.${module}.${setting}`
		if (value === undefined) {
			store.delete(key,)
		} else {
			store.set(key, value,)
		}
		return value
	},),
	updateSettings: vi.fn(async (updates: Record<string, unknown>,) => {
		for (const [key, value,] of Object.entries(updates,)) {
			if (value === undefined) {
				store.delete(key,)
			} else {
				store.set(key, value,)
			}
		}
	},),
}),)

import {doSettingsUpdates,} from './settingsMigrations'

describe('settings migrations', () => {
	beforeEach(() => {
		store.clear()
		runtime.sendMessage.mockReset()
		getCurrentUser.mockReset().mockResolvedValue('mod',)
		setWikiPageSettings.mockReset().mockResolvedValue(undefined,)
		getCache.mockReset().mockResolvedValue('mod',)
		setCache.mockReset().mockResolvedValue(undefined,)
	},)

	it('migrates settings from the old QueueTools module split', async () => {
		store.set('Toolbox.QueueTools.enabled', false,)
		store.set('Toolbox.QueueTools.autoActivate', false,)
		store.set('Toolbox.QueueTools.reportsThreshold', 3,)
		store.set('Toolbox.QueueTools.subredditColor', true,)
		store.set('Toolbox.QueueTools.showAutomodActionReason', false,)
		store.set('Toolbox.QueueTools.showActionReason', false,)

		await doSettingsUpdates()

		expect(store.get('Toolbox.QueueTools.enabled',),).toBe(false,)
		// showActionReason was replaced by the per-item-state recent-actions toggles; an explicit
		// "off" carries over to both new toggles and the old key is dropped.
		expect(store.has('Toolbox.QueueTools.showActionReason',),).toBe(false,)
		expect(store.get('Toolbox.QueueTools.showRecentActionsOnApproved',),).toBe(false,)
		expect(store.get('Toolbox.QueueTools.showRecentActionsOnRemoved',),).toBe(false,)

		expect(store.get('Toolbox.MassModeration.enabled',),).toBe(false,)
		expect(store.get('Toolbox.MassModeration.autoActivate',),).toBe(false,)
		expect(store.get('Toolbox.MassModeration.reportsThreshold',),).toBe(3,)

		// QueueEnhancements was later renamed to ModViewEnhancements, so legacy QueueTools
		// installs migrate straight to the current module id.
		expect(store.get('Toolbox.ModViewEnhancements.enabled',),).toBe(false,)
		expect(store.get('Toolbox.ModViewEnhancements.subredditColor',),).toBe(true,)
		expect(store.get('Toolbox.ModViewEnhancements.showAutomodActionReason',),).toBe(false,)

		expect(store.has('Toolbox.QueueTools.autoActivate',),).toBe(false,)
		expect(store.has('Toolbox.QueueTools.reportsThreshold',),).toBe(false,)
		expect(store.has('Toolbox.QueueTools.subredditColor',),).toBe(false,)
		expect(store.has('Toolbox.QueueTools.showAutomodActionReason',),).toBe(false,)
	})

	it('carries a disabled Notifier over to showNotifications off', async () => {
		store.set('Toolbox.Notifier.enabled', false,)

		await doSettingsUpdates()

		// The Notifier is always enabled now, so the old toggle is dropped; the user's "off"
		// survives as notifications-off while the modbar counters keep updating.
		expect(store.has('Toolbox.Notifier.enabled',),).toBe(false,)
		expect(store.get('Toolbox.Notifier.showNotifications',),).toBe(false,)
	})

	it('drops an enabled Notifier toggle without touching showNotifications', async () => {
		store.set('Toolbox.Notifier.enabled', true,)

		await doSettingsUpdates()

		expect(store.has('Toolbox.Notifier.enabled',),).toBe(false,)
		// Unset -> the default (on) applies, matching the previous behavior.
		expect(store.has('Toolbox.Notifier.showNotifications',),).toBe(false,)
	})

	it('does not overwrite an existing showNotifications choice', async () => {
		store.set('Toolbox.Notifier.enabled', false,)
		store.set('Toolbox.Notifier.showNotifications', true,)

		await doSettingsUpdates()

		expect(store.get('Toolbox.Notifier.showNotifications',),).toBe(true,)
	})

	it('moves the native note label default from Usernotes to Native Mod Log', async () => {
		store.set('Toolbox.UserNotes.defaultNoteLabel', 'spam_watch',)

		await doSettingsUpdates()

		expect(store.has('Toolbox.UserNotes.defaultNoteLabel',),).toBe(false,)
		expect(store.get('Toolbox.NativeModLog.defaultNoteLabel',),).toBe('spam_watch',)
	})

	it('moves custom CSS from the Modbar into the Custom CSS module and switches it on', async () => {
		store.set('Toolbox.Modbar.customCSS', '.toolbox-counter-badge { font-weight: bold; }',)

		await doSettingsUpdates()

		expect(store.has('Toolbox.Modbar.customCSS',),).toBe(false,)
		expect(store.get('Toolbox.CustomCSS.css',),).toBe('.toolbox-counter-badge { font-weight: bold; }',)
		expect(store.get('Toolbox.CustomCSS.enabled',),).toBe(true,)
	})

	it('leaves an explicit Custom CSS module toggle alone when moving the CSS', async () => {
		store.set('Toolbox.Modbar.customCSS', 'a { color: red; }',)
		store.set('Toolbox.CustomCSS.enabled', false,)

		await doSettingsUpdates()

		expect(store.get('Toolbox.CustomCSS.css',),).toBe('a { color: red; }',)
		expect(store.get('Toolbox.CustomCSS.enabled',),).toBe(false,)
	})

	it('drops an empty Modbar custom CSS without enabling the Custom CSS module', async () => {
		store.set('Toolbox.Modbar.customCSS', '',)

		await doSettingsUpdates()

		expect(store.has('Toolbox.Modbar.customCSS',),).toBe(false,)
		expect(store.has('Toolbox.CustomCSS.css',),).toBe(false,)
		expect(store.has('Toolbox.CustomCSS.enabled',),).toBe(false,)
	})

	it('does not overwrite existing Custom CSS module CSS', async () => {
		store.set('Toolbox.Modbar.customCSS', 'a { color: red; }',)
		store.set('Toolbox.CustomCSS.css', 'b { color: blue; }',)

		await doSettingsUpdates()

		expect(store.has('Toolbox.Modbar.customCSS',),).toBe(false,)
		expect(store.get('Toolbox.CustomCSS.css',),).toBe('b { color: blue; }',)
	})

	it('seeds the NN tag character limit from the Usernotes one without removing it', async () => {
		store.set('Toolbox.UserNotes.maxChars', 50,)

		await doSettingsUpdates()

		expect(store.get('Toolbox.NativeModLog.maxChars',),).toBe(50,)
		expect(store.get('Toolbox.UserNotes.maxChars',),).toBe(50,)
	})

	it('does not overwrite an existing NN tag character limit', async () => {
		store.set('Toolbox.UserNotes.maxChars', 50,)
		store.set('Toolbox.NativeModLog.maxChars', 30,)

		await doSettingsUpdates()

		expect(store.get('Toolbox.NativeModLog.maxChars',),).toBe(30,)
	})

	it.each([
		['native_notes', 'reddit_mod_note',],
		['Native Notes', 'reddit_mod_note',],
		['toolbox_notes', 'toolbox_note',],
	],)('turns a %s default notes tab into the %s removal note destination', async (oldTab, destination,) => {
		store.set('Toolbox.UserNotes.defaultNotesTab', oldTab,)

		await doSettingsUpdates()

		expect(store.has('Toolbox.UserNotes.defaultNotesTab',),).toBe(false,)
		expect(store.get('Toolbox.RemovalReasons.defaultNoteDestination',),).toBe(destination,)
	},)

	it('does not overwrite an existing removal note destination', async () => {
		store.set('Toolbox.UserNotes.defaultNotesTab', 'native_notes',)
		store.set('Toolbox.RemovalReasons.defaultNoteDestination', 'toolbox_note',)

		await doSettingsUpdates()

		expect(store.get('Toolbox.RemovalReasons.defaultNoteDestination',),).toBe('toolbox_note',)
		expect(store.has('Toolbox.UserNotes.defaultNotesTab',),).toBe(false,)
	})

	it('carries restored Toolbox 7.x Mod Notes settings over to Native Mod Log', async () => {
		store.set('Toolbox.ModNotes.enabled', true,)
		store.set('Toolbox.ModNotes.defaultTabName', 'actions',)
		store.set('Toolbox.ModNotes.defaultNoteLabel', 'ban',)

		await doSettingsUpdates()

		expect(store.get('Toolbox.NativeModLog.enabled',),).toBe(true,)
		// 7.x keyed the mod-actions tab "actions"; it is "mod_actions" now.
		expect(store.get('Toolbox.NativeModLog.defaultTabName',),).toBe('mod_actions',)
		expect(store.get('Toolbox.NativeModLog.defaultNoteLabel',),).toBe('ban',)
		expect(store.has('Toolbox.ModNotes.enabled',),).toBe(false,)
		expect(store.has('Toolbox.ModNotes.defaultTabName',),).toBe(false,)
		expect(store.has('Toolbox.ModNotes.defaultNoteLabel',),).toBe(false,)
	})

	it('drops showActionReason without forcing the per-state toggles off when it was on', async () => {
		store.set('Toolbox.QueueTools.showActionReason', true,)

		await doSettingsUpdates()

		// The old key is removed; the new per-state toggles keep their defaults (unset -> on).
		expect(store.has('Toolbox.QueueTools.showActionReason',),).toBe(false,)
		expect(store.has('Toolbox.QueueTools.showRecentActionsOnApproved',),).toBe(false,)
		expect(store.has('Toolbox.QueueTools.showRecentActionsOnRemoved',),).toBe(false,)
	})

	it('renames QueueEnhancements settings to ModViewEnhancements', async () => {
		store.set('Toolbox.QueueEnhancements.enabled', false,)
		store.set('Toolbox.QueueEnhancements.botCheckmark', ['AutoModerator', 'OtherBot',],)
		store.set('Toolbox.QueueEnhancements.highlightAutomodMatches', false,)

		await doSettingsUpdates()

		expect(store.get('Toolbox.ModViewEnhancements.enabled',),).toBe(false,)
		expect(store.get('Toolbox.ModViewEnhancements.botCheckmark',),).toEqual(['AutoModerator', 'OtherBot',],)
		expect(store.get('Toolbox.ModViewEnhancements.highlightAutomodMatches',),).toBe(false,)

		expect(store.has('Toolbox.QueueEnhancements.enabled',),).toBe(false,)
		expect(store.has('Toolbox.QueueEnhancements.botCheckmark',),).toBe(false,)
		expect(store.has('Toolbox.QueueEnhancements.highlightAutomodMatches',),).toBe(false,)
	})
})
