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
	/**
	 * Cookie store of the tab that triggered the notification, so click-through and
	 * dismissal stay in the originating Firefox container. Absent off Firefox.
	 */
	cookieStoreId?: string | undefined
}

/** Stores and retrieves per-notification metadata in session storage. */
const notificationMetaStore = new KeyedStore<NotificationMetaData>('session', 'notifmeta',)

/** Firefox's default cookie store, which needs no container-specific handling. */
const DEFAULT_STORE_ID = 'firefox-default'

/**
 * Returns the human-readable name of the Firefox container identified by
 * `cookieStoreId`, or `undefined` when there is no distinct container to label
 * (default store, non-Firefox, or lookup failure). Used to tell notifications
 * from different containers apart.
 */
async function containerLabel (cookieStoreId: string | undefined,): Promise<string | undefined> {
	if (!cookieStoreId || cookieStoreId === DEFAULT_STORE_ID || !browser.contextualIdentities) {
		return undefined
	}
	try {
		const identity = await browser.contextualIdentities.get(cookieStoreId,)
		return identity?.name ?? undefined
	} catch (error) {
		log.warn('Failed to look up container identity:', cookieStoreId, error,)
		return undefined
	}
}

/**
 * Raises a native OS/browser notification.
 */
async function sendNativeNotification (
	{title, body, url, dedupeKey,}: TbNotificationDetails,
	cookieStoreId?: string,
): Promise<string> {
	// If we have the getPermissionLevel function, check if we have permission
	// to send notifications. This function doesn't currently exist on Firefox
	// for some reason. (https://bugzilla.mozilla.org/show_bug.cgi?id=1213455)
	const notifications = browser.notifications as typeof browser.notifications & {
		getPermissionLevel?: () => Promise<string>
	}
	if (typeof notifications.getPermissionLevel !== 'undefined') {
		const permission = await notifications.getPermissionLevel()
		if (permission !== 'granted') {
			throw new Error('No permission to send native notifications',)
		}
	}
	// Differentiate notifications coming from different containers, since the user
	// may be logged into a different account in each.
	const label = await containerLabel(cookieStoreId,)
	// A shared dedupeKey reuses the same notification id, so a second tab raising
	// the same notification updates the existing one instead of stacking a duplicate.
	const notificationID = await browser.notifications.create(dedupeKey ?? crypto.randomUUID(), {
		type: 'basic',
		iconUrl: browser.runtime.getURL('data/images/icon48.png',),
		title: label ? `${title} (${label})` : title,
		message: body,
	},)

	await notificationMetaStore.set(notificationID, {type: 'native', url, cookieStoreId,},)
	return notificationID
}

/**
 * Pushes an in-page notification to every open Reddit tab.
 */
async function sendPageNotification (
	{title, body, url, dedupeKey,}: TbNotificationDetails,
	cookieStoreId?: string,
): Promise<string> {
	// Reuse the dedupeKey as the in-page id so the container can drop a duplicate
	// broadcast for the same item (see PageNotificationContainer's dedup on show).
	const notificationID = dedupeKey ?? crypto.randomUUID()
	await notificationMetaStore.set(notificationID, {type: 'page', url, cookieStoreId,},)
	const message = {
		action: 'toolbox-show-page-notification',
		details: {
			id: notificationID,
			title,
			body,
		},
	}
	// Only show in tabs of the originating container so notifications don't appear
	// in tabs logged into a different account.
	await broadcastToRedditTabs(message, 'toolbox-show-page-notification', undefined, cookieStoreId,)
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
		await broadcastToRedditTabs(message, 'toolbox-clear-page-notification', undefined, metadata.cookieStoreId,)
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
		// Open in the same container the notification came from, so the thread
		// loads as the right account. Ignored where containers aren't supported.
		...(metadata.cookieStoreId ? {cookieStoreId: metadata.cookieStoreId,} : {}),
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

	registerMessageHandler('toolbox-notification', async (request, sender,) => {
		const sendNotification = request.native ? sendNativeNotification : sendPageNotification
		const notificationID = await sendNotification(request.details, sender.tab?.cookieStoreId,)
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

	registerMessageHandler('toolbox-page-notification-click', (request,) => onClickNotification(request.id,),)

	registerMessageHandler('toolbox-page-notification-clear', (request,) => clearNotification(request.id,),)

	browser.notifications.onClicked.addListener((id,) => void onClickNotification(id,))
	browser.notifications.onClosed.addListener((id,) => {
		// Clearing native notifications is done for us, so we don't need to call
		// clearNotification, but we do still need to clean up metadata.
		notificationMetaStore.delete(id,).catch((error,) => {
			log.error('notification metadata cleanup:', error,)
		},)
	},)
}
