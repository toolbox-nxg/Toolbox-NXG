/** Utilities for dispatching and listening to Toolbox CustomEvents on the window. */

import browser from 'webextension-polyfill'

import createLogger from '../infra/logging'

const log = createLogger('TBPageContext',)

/** Dispatches a CustomEvent with the given name on the window. */
export function sendEvent (tbuEvent: string,) {
	log.debug('Sending event:', tbuEvent,)
	window.dispatchEvent(new CustomEvent(tbuEvent,),)
}

/**
 * Bridges incoming background messages to window CustomEvents so that modules
 * can use window.addEventListener for cross-tab events (e.g. TB_UPDATE_COUNTERS)
 * and navigation signals (e.g. toolbox-url-changed) without knowing about the
 * browser messaging layer. Each message's `action` becomes the event type and
 * its `payload` (if any) becomes `event.detail`.
 */
let bridgeActive = false

export function setupMessageBridge () {
	if (bridgeActive) {
		return
	}
	bridgeActive = true
	browser.runtime.onMessage.addListener((message: unknown,) => {
		if (
			message == null
			|| typeof message !== 'object'
			|| !('action' in message)
			|| typeof (message as {action: unknown}).action !== 'string'
		) {
			return undefined
		}
		const {action, payload,} = message as {action: string; payload?: unknown}
		window.dispatchEvent(new CustomEvent(action, {detail: payload,},),)
		return undefined
	},)
}

/** Well-known Toolbox event names dispatched on the window. */
export const events = {
	TB_APPROVE_THING: 'TB_APPROVE_THING',
	TB_PROPOSALS_CHANGED: 'TB_PROPOSALS_CHANGED',
	TB_SAMPLE_SOUND: 'TB_SAMPLE_SOUND',
	TB_SYNTAX_SETTINGS: 'TB_SYNTAX_SETTINGS',
	TB_UPDATE_COUNTERS: 'TB_UPDATE_COUNTERS',
}
