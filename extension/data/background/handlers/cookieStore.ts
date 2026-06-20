/**
 * Firefox-only background handler that makes Toolbox API requests use the cookie
 * store (Multi-Account Container) of the tab that triggered them.
 *
 * The background service worker's `fetch()` always sends the *default* container's
 * cookies, and `Cookie` is a forbidden fetch header so it cannot be set manually.
 * To send another container's cookies, outgoing Toolbox requests are tagged with a
 * temporary header carrying the target `cookieStoreId`; this blocking webRequest
 * listener then rewrites the `Cookie` header from that store before the request
 * leaves the browser.
 *
 * This only does anything in Firefox: Chrome MV3 has no containers (split
 * incognito already isolates contexts) and no blocking webRequest, and its
 * manifest does not request the `webRequest` permission, so `browser.webRequest`
 * is undefined there and {@link cookieRewriteActive} is `false`.
 */

import browser from 'webextension-polyfill'

import createLogger from '../../util/infra/logging'

const log = createLogger('TBCookieStore',)

/** Temporary request header carrying the target cookie store ID. Stripped before the request is sent. */
const TMP_STORE_HEADER = 'x-toolbox-tmp-cookiestore'

/** Firefox's default cookie store; requests there already use the right cookies, so no rewrite is needed. */
const DEFAULT_STORE_ID = 'firefox-default'

/**
 * `true` when the blocking webRequest cookie-rewrite listener is available
 * (Firefox only). When `false`, requests are not tagged and behave as before.
 */
export const cookieRewriteActive = typeof browser.webRequest?.onBeforeSendHeaders?.addListener === 'function'

/**
 * Returns the temporary tagging header for a request that should use the cookies
 * of `cookieStoreId`, or `undefined` when tagging is unnecessary (rewrite
 * inactive, no store, or the default store).
 */
export function tmpStoreHeaders (cookieStoreId: string | undefined,): Record<string, string> | undefined {
	if (!cookieRewriteActive || !cookieStoreId || cookieStoreId === DEFAULT_STORE_ID) {
		return undefined
	}
	return {[TMP_STORE_HEADER]: cookieStoreId,}
}

/**
 * Rewrites the `Cookie` header of a tagged Toolbox request to the cookies of the
 * store named in its temp header, so the request is sent as the account logged in
 * to that container. Untagged requests (normal browsing, other extensions) are
 * returned unchanged.
 */
async function rewriteCookieHeader (
	details: browser.WebRequest.OnBeforeSendHeadersDetailsType,
): Promise<browser.WebRequest.BlockingResponse> {
	const headers = details.requestHeaders
	if (!headers) {
		return {}
	}
	const tagged = headers.find((header,) => header.name.toLowerCase() === TMP_STORE_HEADER)
	if (!tagged?.value) {
		return {}
	}
	const storeId = tagged.value

	// Always strip the temp header so it never leaves the browser.
	const stripped = headers.filter((header,) => header.name.toLowerCase() !== TMP_STORE_HEADER)

	let cookies: browser.Cookies.Cookie[]
	try {
		cookies = await browser.cookies.getAll({url: details.url, storeId,},)
	} catch (error) {
		log.warn('Failed to read cookies for store', storeId, error,)
		return {requestHeaders: stripped,}
	}

	// Replace any existing Cookie header with the target store's cookies.
	const requestHeaders = stripped.filter((header,) => header.name.toLowerCase() !== 'cookie')
	if (cookies.length > 0) {
		requestHeaders.push({
			name: 'Cookie',
			value: cookies.map((cookie,) => `${cookie.name}=${cookie.value}`).join('; ',),
		},)
	}
	return {requestHeaders,}
}

/** Registers the Firefox cookie-store rewrite listener. No-op where blocking webRequest is unavailable. */
export function registerCookieStoreHandlers () {
	if (!cookieRewriteActive) {
		return
	}
	browser.webRequest.onBeforeSendHeaders.addListener(
		rewriteCookieHeader,
		{urls: ['https://*.reddit.com/*',],},
		['blocking', 'requestHeaders',],
	)
}
