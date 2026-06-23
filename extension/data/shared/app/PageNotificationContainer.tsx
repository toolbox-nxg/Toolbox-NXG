/** Component that displays and manages page notifications broadcast from the
 * background page. */

import {useEffect, useState,} from 'react'
import browser from 'webextension-polyfill'

import type {TbPageNotificationClearMessage, TbPageNotificationClickMessage,} from '../../background/messages'
import {genSettings,} from '../../framework/moduleIds'
import {AnnouncementCard,} from '../../modules/announcements/components/AnnouncementCard'
import {useSetting,} from '../../util/ui/hooks'
import {classes,} from '../../util/ui/reactMount'
import css from './PageNotificationContainer.module.css'

interface Notification {
	id: string
	title: string
	body: string
}

type BackgroundMessage =
	| {action: 'toolbox-show-page-notification'; details: Notification}
	| {action: 'toolbox-clear-page-notification'; id: string}

/**
 * Renders and tracks every notification broadcast from the background page.
 */
export function PageNotificationContainer () {
	// Notifications active on the page
	const [notifications, setNotifications,] = useState([] as Notification[],)

	// We need to know the location of the context menu to know how to style the
	// notification area
	const contextMenuLocation = useSetting<'left' | 'right'>(genSettings, 'contextMenuLocation', 'left',)

	// Register listener for messages from the background page
	useEffect(() => {
		const messageListener = (message: unknown,) => {
			const msg = message as BackgroundMessage
			if (msg.action === 'toolbox-show-page-notification') {
				// Add to beginning of list so it shows up on top.
				// NOTE: This setter can be called multiple times between
				//       renders, which results in incoming notifications
				//       overwriting each other; we have to use the "update
				//       function" form of the `useState` setter for safety.
				//       https://react.dev/reference/react/useState#updating-state-based-on-the-previous-state
				setNotifications((currentNotifications,) => [msg.details, ...currentNotifications,])
			} else if (msg.action === 'toolbox-clear-page-notification') {
				setNotifications((currentNotifications,) =>
					currentNotifications.filter((notif,) => notif.id !== msg.id)
				)
			}

			// `@types/webextension-polyfill` wants us to explicitly return
			// `undefined` from synchronous listeners to indicate that we're not
			// doing any async stuff relying on the `sendResponse` param
			return undefined
		}

		browser.runtime.onMessage.addListener(messageListener,)
		return () => {
			browser.runtime.onMessage.removeListener(messageListener,)
		}
	}, [],)

	// Handle clicks on the close button of notifications
	function handleClose (id: string,) {
		// pre-emptively remove the notification from display. Use the "update
		// function" form of the setter (see the listener above) so rapid
		// successive closes between renders don't clobber each other's removals.
		setNotifications((currentNotifications,) => currentNotifications.filter((notif,) => notif.id !== id))

		// notify the background page that the notification should also be
		// removed from other tabs
		void browser.runtime.sendMessage(
			{action: 'toolbox-page-notification-clear', id,} satisfies TbPageNotificationClearMessage,
		)
	}

	// Handle clicks elsewhere on the notification
	function handleClick (id: string,) {
		void browser.runtime.sendMessage(
			{action: 'toolbox-page-notification-click', id,} satisfies TbPageNotificationClickMessage,
		)
	}

	if (!contextMenuLocation) {
		return <></>
	}

	return (
		<div
			className={classes(
				css.wrapper,
				contextMenuLocation === 'right' && css.hasRightContextMenu,
			)}
		>
			{notifications.map((notification,) => (
				// The whole card is the click-to-open target; AnnouncementCard's
				// corner ✕ stops propagation so closing doesn't also open the item.
				<div
					key={notification.id}
					className={css.notification}
					onClick={() => handleClick(notification.id,)}
				>
					<AnnouncementCard
						note={{title: notification.title, body: notification.body,}}
						onClose={() => handleClose(notification.id,)}
					/>
				</div>
			))}
		</div>
	)
}
