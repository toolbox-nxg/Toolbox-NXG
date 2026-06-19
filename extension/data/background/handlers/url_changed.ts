/**
 * Background listeners that notify content scripts when a tab's URL changes via
 * `history.pushState` or hash updates - navigation events that don't trigger a
 * full page load and thus aren't visible to the content script on their own.
 */

import browser from 'webextension-polyfill'

import {sendTabMessageSilently,} from './tabUtils'

type WebNavigationDetails = browser.WebNavigation.OnHistoryStateUpdatedDetailsType

/**
 * Sends a `toolbox-url-changed` message to the given tab/frame.
 * Silently ignores "receiving end does not exist" errors, which are expected
 * for iframes where Toolbox is not active.
 */
function handleWebNavigation ({tabId, frameId,}: WebNavigationDetails,) {
	sendTabMessageSilently(tabId, {action: 'toolbox-url-changed',}, 'toolbox-url-changed', {frameId,},)
}

/** Attaches `webNavigation` listeners for fragment and history-state updates on reddit.com. */
export function registerUrlChangedListeners () {
	const filter = {url: [{hostSuffix: 'reddit.com',},],}
	browser.webNavigation.onReferenceFragmentUpdated.addListener(handleWebNavigation, filter,)
	browser.webNavigation.onHistoryStateUpdated.addListener(handleWebNavigation, filter,)
}
