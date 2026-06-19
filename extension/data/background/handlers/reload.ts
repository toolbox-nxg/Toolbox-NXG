/** Background handler for `toolbox-reload` messages, which trigger an extension runtime reload. */

import browser from 'webextension-polyfill'

import {registerMessageHandler,} from '../messageHandling'

/** Registers the `toolbox-reload` message handler. */
export function registerReloadHandlers () {
	registerMessageHandler('toolbox-reload', () => {
		browser.runtime.reload()
	},)
}
