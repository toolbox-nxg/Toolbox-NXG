/** Tests for global message handler. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'
import type browser from 'webextension-polyfill'

const registerMessageHandler = vi.hoisted(() => vi.fn())
const handleMessage = vi.hoisted(() => vi.fn())
const tabs = vi.hoisted(() => ({
	query: vi.fn(),
	sendMessage: vi.fn(),
}))

vi.mock('webextension-polyfill', () => ({
	default: {tabs,},
}),)
vi.mock('../messageHandling', () => ({registerMessageHandler, handleMessage,}),)

import {registerGlobalMessageHandlers,} from './globalmessage'

beforeEach(() => {
	registerMessageHandler.mockClear()
	handleMessage.mockClear()
	// Simulate the browser filtering tabs by the URL pattern passed to tabs.query.
	// broadcastToRedditTabs queries {url: 'https://*.reddit.com/*'}, so only
	// reddit.com tabs are returned; example.com tabs are not.
	tabs.query.mockReset().mockResolvedValue([
		{id: 1, url: 'https://old.reddit.com/r/test',},
		{id: 2, url: 'https://www.reddit.com/r/test',},
	],)
	tabs.sendMessage.mockReset().mockResolvedValue(undefined,)
},)

describe('global message handler', () => {
	it('broadcasts to other reddit tabs and the background handler', async () => {
		registerGlobalMessageHandlers()
		const handler = registerMessageHandler.mock.calls[0]![1]
		const sender = {tab: {id: 1,},} as unknown as browser.Runtime.MessageSender

		await handler({globalEvent: 'TBGlobal', payload: {ok: true,},}, sender,)

		const message = {action: 'TBGlobal', payload: {ok: true,},}
		expect(tabs.query,).toHaveBeenCalledWith({url: 'https://*.reddit.com/*',},)
		expect(tabs.sendMessage,).toHaveBeenCalledWith(2, message,)
		expect(tabs.sendMessage,).not.toHaveBeenCalledWith(1, message,)
		expect(handleMessage,).toHaveBeenCalledWith(message, sender,)
	})

	it('scopes the broadcast to the sender container', async () => {
		registerGlobalMessageHandlers()
		const handler = registerMessageHandler.mock.calls[0]![1]
		const sender = {
			tab: {id: 1, cookieStoreId: 'firefox-container-1',},
		} as unknown as browser.Runtime.MessageSender

		await handler({globalEvent: 'TBGlobal', excludeBackground: true,}, sender,)

		expect(tabs.query,).toHaveBeenCalledWith({
			url: 'https://*.reddit.com/*',
			cookieStoreId: 'firefox-container-1',
		},)
	})

	it('can skip the background handler', async () => {
		registerGlobalMessageHandlers()
		const handler = registerMessageHandler.mock.calls[0]![1]

		await handler(
			{globalEvent: 'TBGlobal', excludeBackground: true,},
			{tab: {id: 1,},} as unknown as browser.Runtime.MessageSender,
		)

		expect(handleMessage,).not.toHaveBeenCalled()
	})

	it('warns on unexpected tab messaging failures', async () => {
		const warn = vi.spyOn(console, 'warn',).mockImplementation(() => {},)
		tabs.sendMessage.mockReturnValue(Promise.reject(new Error('boom',),),)
		registerGlobalMessageHandlers()
		const handler = registerMessageHandler.mock.calls[0]![1]

		await handler({globalEvent: 'TBGlobal',}, {tab: {id: 1,},} as unknown as browser.Runtime.MessageSender,)
		await Promise.resolve()

		expect(warn,).toHaveBeenCalledWith(
			expect.any(String,),
			expect.any(String,),
			expect.any(String,),
			'toolbox-global: ',
			'boom',
			expect.any(Error,),
		)
		warn.mockRestore()
	})
})
