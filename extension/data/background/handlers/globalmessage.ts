/**
 * Background handler for `toolbox-global` messages, which fan out a single event
 * to all open Reddit tabs and optionally to the background page itself.
 */

import {handleMessage, registerMessageHandler,} from '../messageHandling'
import {broadcastToRedditTabs,} from './tabUtils'

/** Registers the `toolbox-global` message handler that broadcasts events to all Reddit tabs. */
export function registerGlobalMessageHandlers () {
	registerMessageHandler('toolbox-global', async (request, sender,) => {
		const message = {
			action: request.globalEvent,
			payload: request.payload,
		}

		// Send to all tabs in the same container as the sender, so global events
		// (e.g. toolbar counters) don't leak across Firefox containers.
		await broadcastToRedditTabs(message, 'toolbox-global', sender.tab?.id, sender.tab?.cookieStoreId,)

		// Also send to the background page, unless it only applies to tabs
		if (!request.excludeBackground) {
			await handleMessage(message, sender,)
		}
	},)
}
