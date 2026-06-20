/** Tests for notification handlers. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

import {makeHandlerFinder,} from './test-helpers'

const registerMessageHandler = vi.hoisted(() => vi.fn())
const storageSession = vi.hoisted(() => ({get: vi.fn(), set: vi.fn(), remove: vi.fn(),}))
const notifications = vi.hoisted(() => ({
	create: vi.fn(),
	clear: vi.fn(),
	getPermissionLevel: vi.fn(),
	onClicked: {addListener: vi.fn(),},
	onClosed: {addListener: vi.fn(),},
}))
const tabs = vi.hoisted(() => ({query: vi.fn(), sendMessage: vi.fn(), create: vi.fn(),}))
const alarms = vi.hoisted(() => ({create: vi.fn(), onAlarm: {addListener: vi.fn(),},}))
const windows = vi.hoisted(() => ({getLastFocused: vi.fn(),}))
const runtime = vi.hoisted(() => ({getURL: vi.fn((path: string,) => `chrome-extension://fake/${path}`),}))
const contextualIdentities = vi.hoisted(() => ({get: vi.fn(),}))

vi.mock('webextension-polyfill', () => ({
	default: {
		storage: {session: storageSession,},
		notifications,
		tabs,
		alarms,
		windows,
		runtime,
		contextualIdentities,
	},
}),)
vi.mock('../messageHandling', () => ({registerMessageHandler,}),)

import {registerNotificationHandlers,} from './notifications'

const handlerFor = makeHandlerFinder(registerMessageHandler,)

const details = {
	title: 'Title',
	body: 'Body',
	url: 'https://old.reddit.com/r/test',
}

/** Builds a message sender, optionally in a specific Firefox container. */
function sender (cookieStoreId?: string,) {
	return {tab: {url: details.url, ...(cookieStoreId ? {cookieStoreId,} : {}),},} as any
}

beforeEach(() => {
	registerMessageHandler.mockClear()
	storageSession.get.mockReset().mockResolvedValue({},)
	storageSession.set.mockReset().mockResolvedValue(undefined,)
	storageSession.remove.mockReset().mockResolvedValue(undefined,)
	notifications.create.mockReset().mockResolvedValue('native-id',)
	notifications.clear.mockReset().mockResolvedValue(true,)
	notifications.getPermissionLevel.mockReset().mockResolvedValue('granted',)
	notifications.onClicked.addListener.mockClear()
	notifications.onClosed.addListener.mockClear()
	tabs.query.mockReset().mockResolvedValue([{id: 1,}, {id: 2,},],)
	tabs.sendMessage.mockReset().mockResolvedValue(undefined,)
	tabs.create.mockReset().mockResolvedValue({id: 10,},)
	alarms.create.mockReset().mockResolvedValue(undefined,)
	alarms.onAlarm.addListener.mockClear()
	windows.getLastFocused.mockReset().mockResolvedValue({id: 5,},)
	contextualIdentities.get.mockReset().mockResolvedValue({name: 'Container',},)
	vi.stubGlobal('crypto', {randomUUID: vi.fn(() => 'uuid'),},)
},)

describe('notification handlers', () => {
	it('creates native notifications and stores metadata', async () => {
		registerNotificationHandlers()

		await expect(handlerFor('toolbox-notification',)({native: true, details,}, sender(),),).resolves.toBe(
			'native-id',
		)

		expect(notifications.create,).toHaveBeenCalledWith('uuid', {
			type: 'basic',
			iconUrl: 'chrome-extension://fake/data/images/icon48.png',
			title: 'Title',
			message: 'Body',
		},)
		expect(storageSession.set,).toHaveBeenCalledWith({
			'notifmeta-native-id': {type: 'native', url: details.url,},
		},)
		expect(alarms.create,).toHaveBeenCalledWith('toolbox-notification-native-id', {delayInMinutes: 1,},)
	})

	it('creates page notifications on reddit tabs', async () => {
		registerNotificationHandlers()

		await expect(handlerFor('toolbox-notification',)({native: false, details,}, sender(),),).resolves.toBe('uuid',)

		expect(storageSession.set,).toHaveBeenCalledWith({
			'notifmeta-uuid': {type: 'page', url: details.url,},
		},)
		expect(tabs.query,).toHaveBeenCalledWith({url: 'https://*.reddit.com/*',},)
		expect(tabs.sendMessage,).toHaveBeenCalledWith(1, {
			action: 'toolbox-show-page-notification',
			details: {id: 'uuid', title: 'Title', body: 'Body',},
		},)
	})

	it('labels native notifications with the container and stores its cookie store', async () => {
		contextualIdentities.get.mockResolvedValue({name: 'Work',},)
		registerNotificationHandlers()

		await handlerFor('toolbox-notification',)({native: true, details,}, sender('firefox-container-1',),)

		expect(contextualIdentities.get,).toHaveBeenCalledWith('firefox-container-1',)
		expect(notifications.create,).toHaveBeenCalledWith('uuid', expect.objectContaining({title: 'Title (Work)',},),)
		expect(storageSession.set,).toHaveBeenCalledWith({
			'notifmeta-native-id': {type: 'native', url: details.url, cookieStoreId: 'firefox-container-1',},
		},)
	})

	it('scopes page notifications to the originating container', async () => {
		registerNotificationHandlers()

		await handlerFor('toolbox-notification',)({native: false, details,}, sender('firefox-container-1',),)

		expect(tabs.query,).toHaveBeenCalledWith({
			url: 'https://*.reddit.com/*',
			cookieStoreId: 'firefox-container-1',
		},)
	})

	it('opens the click-through tab in the originating container', async () => {
		storageSession.get.mockResolvedValue({
			'notifmeta-page-id': {type: 'page', ...details, cookieStoreId: 'firefox-container-1',},
		},)
		registerNotificationHandlers()

		await handlerFor('toolbox-page-notification-click',)({id: 'page-id',},)

		expect(tabs.create,).toHaveBeenCalledWith({
			url: details.url,
			windowId: 5,
			cookieStoreId: 'firefox-container-1',
		},)
	})

	it('clicking notifications opens the metadata URL in a new tab', async () => {
		storageSession.get.mockResolvedValue({'notifmeta-page-id': {type: 'page', ...details,},},)
		registerNotificationHandlers()

		await handlerFor('toolbox-page-notification-click',)({id: 'page-id',},)

		expect(tabs.create,).toHaveBeenCalledWith({url: details.url, windowId: 5,},)
	})

	it('does not open a tab when notification metadata is missing', async () => {
		const warn = vi.spyOn(console, 'warn',).mockImplementation(() => {},)
		registerNotificationHandlers()

		await handlerFor('toolbox-page-notification-click',)({id: 'missing-id',},)

		expect(tabs.create,).not.toHaveBeenCalled()
		expect(warn,).toHaveBeenCalledWith(
			expect.any(String,),
			expect.any(String,),
			expect.any(String,),
			'Notification metadata missing for click:',
			'missing-id',
		)
		warn.mockRestore()
	})

	it('clears page notifications on all reddit tabs and deletes metadata', async () => {
		storageSession.get.mockResolvedValue({'notifmeta-page-id': {type: 'page', ...details,},},)
		registerNotificationHandlers()

		handlerFor('toolbox-page-notification-clear',)({id: 'page-id',},)

		await vi.waitFor(() => {
			expect(tabs.sendMessage,).toHaveBeenCalledWith(1, {
				action: 'toolbox-clear-page-notification',
				id: 'page-id',
			},)
		},)
		expect(storageSession.remove,).toHaveBeenCalledWith('notifmeta-page-id',)
	})

	it('clears native notifications from alarms', async () => {
		storageSession.get.mockResolvedValue({'notifmeta-native-id': {type: 'native', ...details,},},)
		registerNotificationHandlers()
		const alarmHandler = alarms.onAlarm.addListener.mock.calls[0]![0]

		alarmHandler({name: 'toolbox-notification-native-id',},)

		await vi.waitFor(() => {
			expect(notifications.clear,).toHaveBeenCalledWith('native-id',)
		},)
	})

	it('removes native notification metadata after clearing from alarms', async () => {
		storageSession.get.mockResolvedValue({'notifmeta-native-id': {type: 'native', ...details,},},)
		registerNotificationHandlers()
		const alarmHandler = alarms.onAlarm.addListener.mock.calls[0]![0]

		alarmHandler({name: 'toolbox-notification-native-id',},)

		await vi.waitFor(() => {
			expect(storageSession.remove,).toHaveBeenCalledWith('notifmeta-native-id',)
		},)
	})

	it('removes native notification metadata when the browser reports it closed', () => {
		registerNotificationHandlers()
		const closedHandler = notifications.onClosed.addListener.mock.calls[0]![0]

		closedHandler('native-id',)

		expect(storageSession.remove,).toHaveBeenCalledWith('notifmeta-native-id',)
	})

	it('logs alarm creation failures without failing notification creation', async () => {
		const error = vi.spyOn(console, 'error',).mockImplementation(() => {},)
		alarms.create.mockRejectedValue(new Error('alarm failed',),)
		registerNotificationHandlers()

		await expect(handlerFor('toolbox-notification',)({native: true, details,}, sender(),),).resolves.toBe(
			'native-id',
		)
		await Promise.resolve()

		expect(error,).toHaveBeenCalledWith(
			expect.any(String,),
			expect.any(String,),
			expect.any(String,),
			'Failed to create notification cleanup alarm:',
			expect.any(Error,),
		)
		error.mockRestore()
	})
})
