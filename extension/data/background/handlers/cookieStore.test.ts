/** Tests for the Firefox cookie-store rewrite handler. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const cookies = vi.hoisted(() => ({getAll: vi.fn(),}))
const onBeforeSendHeaders = vi.hoisted(() => ({addListener: vi.fn(),}))

vi.mock('webextension-polyfill', () => ({
	default: {cookies, webRequest: {onBeforeSendHeaders,},},
}),)

import {cookieRewriteActive, registerCookieStoreHandlers, tmpStoreHeaders,} from './cookieStore'

const TMP_HEADER = 'x-toolbox-tmp-cookiestore'

/** Registers the handler and returns the blocking listener that was attached. */
function getListener () {
	registerCookieStoreHandlers()
	return onBeforeSendHeaders.addListener.mock.calls.at(-1,)![0] as (
		details: any,
	) => Promise<any>
}

beforeEach(() => {
	cookies.getAll.mockReset().mockResolvedValue([],)
	onBeforeSendHeaders.addListener.mockClear()
},)

describe('tmpStoreHeaders', () => {
	it('is active when blocking webRequest is available', () => {
		expect(cookieRewriteActive,).toBe(true,)
	})

	it('tags non-default containers', () => {
		expect(tmpStoreHeaders('firefox-container-1',),).toEqual({[TMP_HEADER]: 'firefox-container-1',},)
	})

	it('does not tag the default store or missing store', () => {
		expect(tmpStoreHeaders('firefox-default',),).toBeUndefined()
		expect(tmpStoreHeaders(undefined,),).toBeUndefined()
	})
})

describe('cookie rewrite listener', () => {
	it('registers a blocking listener scoped to reddit', () => {
		registerCookieStoreHandlers()
		expect(onBeforeSendHeaders.addListener,).toHaveBeenCalledWith(
			expect.any(Function,),
			{urls: ['https://*.reddit.com/*',],},
			['blocking', 'requestHeaders',],
		)
	})

	it('leaves untagged requests unchanged', async () => {
		const listener = getListener()

		const result = await listener({
			url: 'https://old.reddit.com/api/me',
			requestHeaders: [{name: 'Cookie', value: 'a=1',},],
		},)

		expect(result,).toEqual({},)
		expect(cookies.getAll,).not.toHaveBeenCalled()
	})

	it('rewrites the Cookie header from the tagged store and strips the temp header', async () => {
		cookies.getAll.mockResolvedValue([{name: 'reddit_session', value: 'abc',}, {name: 'token', value: 'xyz',},],)
		const listener = getListener()

		const result = await listener({
			url: 'https://old.reddit.com/api/me',
			requestHeaders: [
				{name: TMP_HEADER, value: 'firefox-container-1',},
				{name: 'Cookie', value: 'default=1',},
				{name: 'X-Other', value: 'keep',},
			],
		},)

		expect(cookies.getAll,).toHaveBeenCalledWith({
			url: 'https://old.reddit.com/api/me',
			storeId: 'firefox-container-1',
		},)
		expect(result.requestHeaders,).toEqual([
			{name: 'X-Other', value: 'keep',},
			{name: 'Cookie', value: 'reddit_session=abc; token=xyz',},
		],)
	})

	it('strips the temp header even when the store has no cookies', async () => {
		cookies.getAll.mockResolvedValue([],)
		const listener = getListener()

		const result = await listener({
			url: 'https://old.reddit.com/api/me',
			requestHeaders: [
				{name: TMP_HEADER, value: 'firefox-container-1',},
				{name: 'Cookie', value: 'default=1',},
			],
		},)

		expect(result.requestHeaders,).toEqual([],)
	})

	it('leaves the request unchanged but strips the temp header when cookie read fails', async () => {
		const warn = vi.spyOn(console, 'warn',).mockImplementation(() => {},)
		cookies.getAll.mockRejectedValue(new Error('boom',),)
		const listener = getListener()

		const result = await listener({
			url: 'https://old.reddit.com/api/me',
			requestHeaders: [
				{name: TMP_HEADER, value: 'firefox-container-1',},
				{name: 'Cookie', value: 'default=1',},
			],
		},)

		expect(result.requestHeaders,).toEqual([{name: 'Cookie', value: 'default=1',},],)
		warn.mockRestore()
	})
})
