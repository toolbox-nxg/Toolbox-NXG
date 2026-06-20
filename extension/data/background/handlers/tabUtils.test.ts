/** Tests for tabUtils. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

import {mockJwtCookie,} from './test-helpers'

const cookies = vi.hoisted(() => ({get: vi.fn(),}))
const tabs = vi.hoisted(() => ({query: vi.fn(), sendMessage: vi.fn(),}))

vi.mock('webextension-polyfill', () => ({
	default: {cookies, tabs,},
}),)

import {
	broadcastToRedditTabs,
	decodeJWTPayload,
	getCookieWithFPIFallback,
	getRedditSessionJTI,
	getRedditSessionUserID,
	isAllowedRedditHost,
	sendTabMessageSilently,
} from './tabUtils'

beforeEach(() => {
	cookies.get.mockReset().mockResolvedValue(null,)
	tabs.query.mockReset().mockResolvedValue([],)
	tabs.sendMessage.mockReset().mockResolvedValue(undefined,)
},)

describe('tabUtils', () => {
	it('allows reddit.com and redd.it hosts only', () => {
		expect(isAllowedRedditHost('reddit.com',),).toBe(true,)
		expect(isAllowedRedditHost('old.reddit.com',),).toBe(true,)
		expect(isAllowedRedditHost('redd.it',),).toBe(true,)
		expect(isAllowedRedditHost('v.redd.it',),).toBe(true,)
		expect(isAllowedRedditHost('notreddit.com',),).toBe(false,)
		expect(isAllowedRedditHost('evilredd.it',),).toBe(false,)
	})

	it('decodes JWT payloads', () => {
		expect(decodeJWTPayload(mockJwtCookie({sub: 't2_user',},).value,),).toEqual({sub: 't2_user',},)
	})

	it('decodes base64url JWT payloads without padding', () => {
		const payload = btoa(JSON.stringify({sub: 't2_user-url',},),)
			.replace(/\+/g, '-',)
			.replace(/\//g, '_',)
			.replace(/=+$/, '',)

		expect(decodeJWTPayload(`header.${payload}.sig`,),).toEqual({sub: 't2_user-url',},)
	})

	it('falls back to firstPartyDomain when cookie lookup throws', async () => {
		cookies.get.mockRejectedValueOnce(new Error('first-party isolation',),).mockResolvedValueOnce({
			value: 'cookie',
		},)
		const info = {url: 'https://reddit.com', name: 'reddit_session',}

		await expect(getCookieWithFPIFallback(info,),).resolves.toEqual({value: 'cookie',},)

		expect(cookies.get,).toHaveBeenNthCalledWith(2, {
			url: 'https://reddit.com',
			name: 'reddit_session',
			firstPartyDomain: 'reddit.com',
		},)
	})

	it('extracts the user id from the sender tab session cookie', async () => {
		cookies.get.mockResolvedValue(mockJwtCookie({sub: 't2_user',},),)

		await expect(
			getRedditSessionUserID({
				tab: {url: 'https://old.reddit.com/r/test', cookieStoreId: 'firefox-store',},
			} as any,),
		).resolves.toBe('user',)

		expect(cookies.get,).toHaveBeenCalledWith({
			name: 'reddit_session',
			storeId: 'firefox-store',
			url: 'https://old.reddit.com/r/test',
		},)
	})

	it('falls back when session cookies are malformed', async () => {
		const warn = vi.spyOn(console, 'warn',).mockImplementation(() => {},)
		cookies.get.mockResolvedValue({value: 'not-a-jwt',},)

		await expect(
			getRedditSessionUserID({tab: {url: 'https://old.reddit.com/r/test',},} as any,),
		).resolves.toBe('noSessionFallback',)
		await expect(getRedditSessionJTI(),).resolves.toBe('noSessionFallback',)

		expect(warn,).toHaveBeenCalled()
		warn.mockRestore()
	})

	it('falls back when session cookies do not contain expected claims', async () => {
		cookies.get.mockResolvedValue(mockJwtCookie({sub: 'not-a-user-fullname',},),)

		await expect(
			getRedditSessionUserID({tab: {url: 'https://old.reddit.com/r/test',},} as any,),
		).resolves.toBe('noSessionFallback',)

		cookies.get.mockResolvedValue(mockJwtCookie({sub: 't2_user',},),)
		await expect(getRedditSessionJTI(),).resolves.toBe('noSessionFallback',)
	})

	it('uses the no-session fallback when sender has no tab URL', async () => {
		await expect(getRedditSessionUserID({} as any,),).resolves.toBe('noSessionFallback',)
		await expect(getRedditSessionUserID({tab: {},} as any,),).resolves.toBe('noSessionFallback',)
		expect(cookies.get,).not.toHaveBeenCalled()
	})

	it('reads the session jti from the given cookie store', async () => {
		cookies.get.mockResolvedValue(mockJwtCookie({jti: 'session-id',},),)

		await expect(getRedditSessionJTI('firefox-store',),).resolves.toBe('session-id',)

		expect(cookies.get,).toHaveBeenCalledWith({
			url: 'https://reddit.com',
			name: 'reddit_session',
			storeId: 'firefox-store',
		},)
	})

	it('reads the session jti without a store id by default', async () => {
		cookies.get.mockResolvedValue(mockJwtCookie({jti: 'session-id',},),)

		await expect(getRedditSessionJTI(),).resolves.toBe('session-id',)

		expect(cookies.get,).toHaveBeenCalledWith({url: 'https://reddit.com', name: 'reddit_session',},)
	})

	it('broadcasts to reddit tabs while optionally excluding a tab', async () => {
		tabs.query.mockResolvedValue([{id: 1,}, {id: 2,}, {},],)

		await broadcastToRedditTabs({action: 'ping',}, 'test-broadcast', 1,)

		expect(tabs.query,).toHaveBeenCalledWith({url: 'https://*.reddit.com/*',},)
		expect(tabs.sendMessage,).toHaveBeenCalledOnce()
		expect(tabs.sendMessage,).toHaveBeenCalledWith(2, {action: 'ping',},)
	})

	it('scopes the broadcast to a container when given a cookie store id', async () => {
		tabs.query.mockResolvedValue([{id: 5,},],)

		await broadcastToRedditTabs({action: 'ping',}, 'test-broadcast', undefined, 'firefox-store',)

		expect(tabs.query,).toHaveBeenCalledWith({url: 'https://*.reddit.com/*', cookieStoreId: 'firefox-store',},)
		expect(tabs.sendMessage,).toHaveBeenCalledWith(5, {action: 'ping',},)
	})

	it('logs unexpected tab message errors but ignores missing receivers', async () => {
		const warn = vi.spyOn(console, 'warn',).mockImplementation(() => {},)

		tabs.sendMessage.mockRejectedValueOnce(
			new Error('Could not establish connection. Receiving end does not exist.',),
		)
		sendTabMessageSilently(1, {action: 'ping',}, 'missing',)
		await Promise.resolve()
		expect(warn,).not.toHaveBeenCalled()

		tabs.sendMessage.mockRejectedValueOnce(new Error('boom',),)
		sendTabMessageSilently(1, {action: 'ping',}, 'unexpected',)
		await Promise.resolve()
		expect(warn,).toHaveBeenCalledWith(
			expect.any(String,),
			expect.any(String,),
			expect.any(String,),
			'unexpected: ',
			'boom',
			expect.any(Error,),
		)

		warn.mockRestore()
	})
})
