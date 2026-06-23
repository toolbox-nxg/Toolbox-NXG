/** Shows a Toolbox notification via the background page, with automatic dismissal after a timeout. */

import browser from 'webextension-polyfill'

import type {TbNotificationMessage, TbPageNotificationClearMessage,} from '../../background/messages'
import {genSettings,} from '../../framework/moduleIds'
import {getSettingAsync,} from '../persistence/settings'

/**
 * Sends a notification through the background page and auto-clears it after 6 seconds.
 * @param title Notification title.
 * @param body Notification body text.
 * @param path URL path the notification links to (relative to `location.origin`).
 */
export async function notification (title: string, body: string, path: string,) {
	const notificationTimeout = 6000
	const notificationID = await browser.runtime.sendMessage(
		{
			action: 'toolbox-notification',
			native: await getSettingAsync(genSettings, 'nativeNotifications', true,) as boolean,
			details: {
				title,
				body,
				url: `${location.origin}${path}`,
			},
		} satisfies TbNotificationMessage,
	) as string

	setTimeout(() => {
		void browser.runtime.sendMessage(
			{
				action: 'toolbox-page-notification-clear',
				id: notificationID,
			} satisfies TbPageNotificationClearMessage,
		)
	}, notificationTimeout,)
}
