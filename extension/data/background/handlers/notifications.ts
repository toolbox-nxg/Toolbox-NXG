/**
 * Background handlers for Toolbox notifications. Supports both native browser
 * notifications and in-page notifications displayed via content-script overlays.
 * Notification metadata (URL and type) is stored in session storage so click
 * and dismiss events can be handled after the originating tab closes.
 */

import browser from 'webextension-polyfill'

import createLogger from '../../util/infra/logging'
import {registerMessageHandler,} from '../messageHandling'
import type {TbNotificationDetails,} from '../messages'
import {KeyedStore,} from './keyedStore'
import {broadcastToRedditTabs,} from './tabUtils'

const log = createLogger('TBNotifications',)

/** Persisted metadata associated with a pending notification. */
interface NotificationMetaData {
	/** Whether this is a native browser notification or an in-page overlay. */
	type: 'native' | 'page'
	/** URL to open when the notification is clicked. */
	url: string
}

/** Stores and retrieves per-notification metadata in session storage. */
const notificationMetaStore = new KeyedStore<NotificationMetaData>('session', 'notifmeta',)

/**
 * Raises a native OS/browser notification.
 */
async function sendNativeNotification ({title, body, url,}: TbNotificationDetails,): Promise<string> {
	// If we have the getPermissionLevel function, check if we have permission
	// to send notifications. This function doesn't currently exist on Firefox
	// for some reason. (https://bugzilla.mozilla.org/show_bug.cgi?id=1213455)
	if (typeof (browser.notifications as any).getPermissionLevel !== 'undefined') {
		const permission = await (browser.notifications as any).getPermissionLevel()
		if (permission !== 'granted') {
			throw new Error('No permission to send native notifications',)
		}
	}
	const notificationID = await browser.notifications.create(crypto.randomUUID(), {
		type: 'basic',
		iconUrl: browser.runtime.getURL('data/images/icon48.png',),
		title,
		message: body,
	},)

	await notificationMetaStore.set(notificationID, {type: 'native', url,},)
	return notificationID
}

/**
 * Pushes an in-page notification to every open Reddit tab.
 */
async function sendPageNotification ({title, body, url,}: TbNotificationDetails,): Promise<string> {
	const notificationID = crypto.randomUUID()
	await notificationMetaStore.set(notificationID, {type: 'page', url,},)
	const message = {
		action: 'toolbox-show-page-notification',
		details: {
			id: notificationID,
			title,
			body,
		},
	}
	await broadcastToRedditTabs(message, 'toolbox-show-page-notification',)
	return notificationID
}

/**
 * Clears a notification and removes its stored metadata.
 * For native notifications, calls `browser.notifications.clear`; for in-page
 * notifications, broadcasts a dismiss message to all Reddit tabs.
 */
async function clearNotification (notificationID: string,) {
	const metadata = await notificationMetaStore.get(notificationID,)
	if (!metadata) {
		return
	}
	if (metadata.type === 'native') {
		await browser.notifications.clear(notificationID,)
	} else {
		const message = {
			action: 'toolbox-clear-page-notification',
			id: notificationID,
		}
		await broadcastToRedditTabs(message, 'toolbox-clear-page-notification',)
	}
	await notificationMetaStore.delete(notificationID,)
}

/** Handles a notification click: opens the URL in a new tab and clears the notification. */
async function onClickNotification (notificationID: string,) {
	const metadata = await notificationMetaStore.get(notificationID,)
	if (!metadata?.url) {
		log.warn('Notification metadata missing for click:', notificationID,)
		return
	}

	const window = await browser.windows.getLastFocused()
	await browser.tabs.create({
		url: metadata.url,
		...(window.id !== undefined ? {windowId: window.id,} : {}),
	},)

	// fire-and-forget: cleanup is best-effort
	clearNotification(notificationID,).catch((error,) => {
		log.error('onClickNotification cleanup:', error,)
	},)
}

/** Registers notification message handlers and browser notification event listeners. */
export function registerNotificationHandlers () {
	browser.alarms.onAlarm.addListener((alarmInfo,) => {
		const name = alarmInfo.name
		if (name.startsWith('toolbox-notification-',)) {
			const notificationID = name.replace('toolbox-notification-', '',)
			clearNotification(notificationID,).catch((error,) => {
				log.error('alarm clearNotification:', error,)
			},)
		}
	},)

	registerMessageHandler('toolbox-notification', async (request,) => {
		const sendNotification = request.native ? sendNativeNotification : sendPageNotification
		const notificationID = await sendNotification(request.details,)
		// Notification dismissal is handled by a tab-side setTimeout, but tabs can
		// close before it fires. The alarm acts as a background failsafe for that case.
		// (The Alarms API only supports minute granularity, hence the 1-minute backup.)
		browser.alarms.create(`toolbox-notification-${notificationID}`, {
			delayInMinutes: 1,
		},).catch((error,) => {
			log.error('Failed to create notification cleanup alarm:', error,)
		},)
		return notificationID
	},)

	registerMessageHandler('toolbox-page-notification-click', (request,) => {
		return onClickNotification(request.id,)
	},)

	registerMessageHandler('toolbox-page-notification-clear', (request,) => {
		return clearNotification(request.id,)
	},)

	browser.notifications.onClicked.addListener(onClickNotification,)
	browser.notifications.onClosed.addListener((id,) => {
		// Clearing native notifications is done for us, so we don't need to call
		// clearNotification, but we do still need to clean up metadata.
		notificationMetaStore.delete(id,).catch((error,) => {
			log.error('notification metadata cleanup:', error,)
		},)
	},)
}
