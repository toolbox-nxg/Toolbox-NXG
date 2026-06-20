/** Background-page helpers for Reddit host validation, JWT payload decoding, and
 * messaging tabs. */

import browser from 'webextension-polyfill'

import createLogger from '../../util/infra/logging'

const log = createLogger('TBTabUtils',)

const noReceiver = 'Could not establish connection. Receiving end does not exist.'

/** Returns `true` if `hostname` is `reddit.com`, `redd.it`, or any subdomain thereof. */
export function isAllowedRedditHost (hostname: string,): boolean {
	return hostname === 'reddit.com'
		|| hostname.endsWith('.reddit.com',)
		|| hostname === 'redd.it'
		|| hostname.endsWith('.redd.it',)
}

/**
 * Decodes the payload of a JWT token without verifying the signature.
 * @param token A dot-separated JWT string
 */
export function decodeJWTPayload (token: string,): Record<string, unknown> {
	const payload = token.split('.',)[1]
	if (!payload) {
		throw new Error('JWT missing payload',)
	}
	const normalized = payload.replace(/-/g, '+',).replace(/_/g, '/',)
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4,) * 4, '=',)
	return JSON.parse(atob(padded,),) as Record<string, unknown>
}

function safeDecodeJWTPayload (token: string,): Record<string, unknown> | null {
	try {
		return decodeJWTPayload(token,)
	} catch (error) {
		log.warn('Failed to decode reddit_session cookie:', error,)
		return null
	}
}

/**
 * Sends a message to a tab and silently swallows "no receiving end" errors,
 * which are expected for iframes and pages where Toolbox is not active.
 * Unexpected errors are logged via `console.warn` with the given `label`.
 */
export function sendTabMessageSilently (
	tabId: number,
	message: unknown,
	label: string,
	options?: browser.Tabs.SendMessageOptionsType,
): void {
	const promise = options !== undefined
		? browser.tabs.sendMessage(tabId, message, options,)
		: browser.tabs.sendMessage(tabId, message,)
	promise.catch((error: Error,) => {
		if (error.message !== noReceiver) {
			log.warn(`${label}: `, error.message, error,)
		}
	},)
}

/**
 * Sends a message to every open Reddit tab, optionally excluding one tab by ID.
 * When `cookieStoreId` is given, only tabs in that Firefox container receive the
 * message, so events stay scoped to the container they originated from. Omitting
 * it preserves the all-containers behavior.
 */
export async function broadcastToRedditTabs (
	message: unknown,
	label: string,
	excludeTabId?: number,
	cookieStoreId?: string,
): Promise<void> {
	const tabs = await browser.tabs.query({
		url: 'https://*.reddit.com/*',
		...(cookieStoreId ? {cookieStoreId,} : {}),
	},)
	for (const tab of tabs) {
		if (tab.id == null || tab.id === excludeTabId) {
			continue
		}
		sendTabMessageSilently(tab.id, message, label,)
	}
}

/**
 * Fetches a cookie, retrying with `firstPartyDomain: 'reddit.com'` if Firefox's
 * first-party isolation throws on the initial attempt.
 */
export async function getCookieWithFPIFallback (
	info: browser.Cookies.GetDetailsType,
): Promise<browser.Cookies.Cookie | null> {
	try {
		return await browser.cookies.get(info,)
	} catch {
		;(info as any).firstPartyDomain = 'reddit.com'
		return browser.cookies.get(info,)
	}
}

/**
 * Extracts the base36 Reddit user ID from the `reddit_session` JWT cookie for
 * the tab identified by `sender`. The `sub` claim has the form `t2_<base36id>`;
 * the `t2_` prefix is stripped before returning.
 * Returns `'noSessionFallback'` when no session cookie is present.
 */
export async function getRedditSessionUserID (sender: browser.Runtime.MessageSender,): Promise<string> {
	if (!sender.tab?.url) {
		return 'noSessionFallback'
	}
	const info: browser.Cookies.GetDetailsType = {
		...(sender.tab.cookieStoreId !== undefined ? {storeId: sender.tab.cookieStoreId,} : {}),
		name: 'reddit_session',
		url: sender.tab.url,
	}
	const cookie = await getCookieWithFPIFallback(info,)
	if (cookie) {
		const payload = safeDecodeJWTPayload(cookie.value,)
		if (typeof payload?.sub === 'string' && payload.sub.startsWith('t2_',)) {
			return payload.sub.slice(3,)
		}
	}
	return 'noSessionFallback'
}

/**
 * Returns the `jti` (JWT ID) claim from the `reddit_session` cookie, which
 * changes on account switch and is used to namespace cached OAuth tokens per
 * session. When `storeId` is given, reads from that Firefox container's cookie
 * store so tokens are namespaced per container.
 * Returns `'noSessionFallback'` when no session cookie is present.
 */
export async function getRedditSessionJTI (storeId?: string,): Promise<string> {
	const cookie = await getCookieWithFPIFallback({
		url: 'https://reddit.com',
		name: 'reddit_session',
		...(storeId ? {storeId,} : {}),
	},)
	if (cookie) {
		const payload = safeDecodeJWTPayload(cookie.value,)
		if (typeof payload?.jti === 'string') {
			return payload.jti
		}
	}
	return 'noSessionFallback'
}
