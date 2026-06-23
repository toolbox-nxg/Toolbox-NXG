/** Tests for registerMessageHandler / handleMessage. */

// @vitest-environment node
import {describe, expect, it, vi,} from 'vitest'
import browser from 'webextension-polyfill'

vi.mock('webextension-polyfill', () => ({
	default: {
		runtime: {
			onMessage: {addListener: vi.fn(),},
		},
	},
}),)

// vi.mock is hoisted above imports by vitest, so the mock is in place when
// messageHandling.ts runs its module-level addListener call.
import {handleMessage, registerMessageHandler,} from './messageHandling'

const fakeSender = {} as unknown as browser.Runtime.MessageSender

describe('registerMessageHandler / handleMessage', () => {
	it('registers handleMessage as the runtime onMessage listener', () => {
		expect(browser.runtime.onMessage.addListener,).toHaveBeenCalledWith(handleMessage,)
	})

	it('calls the registered handler for a matching action', async () => {
		const handler = vi.fn().mockResolvedValue('ok',)
		registerMessageHandler('toolbox-reload', handler,)

		const result = await handleMessage({action: 'toolbox-reload',}, fakeSender,)
		expect(handler,).toHaveBeenCalledWith({action: 'toolbox-reload',}, fakeSender,)
		expect(result,).toBe('ok',)
	})

	it('returns undefined and warns for an unknown action', async () => {
		const warn = vi.spyOn(console, 'warn',).mockImplementation(() => {},)
		const result = await handleMessage({action: 'toolbox-unknown-action',}, fakeSender,)
		expect(result,).toBeUndefined()
		expect(warn,).toHaveBeenCalled()
		warn.mockRestore()
	})

	it('returns undefined and warns for malformed messages', () => {
		const warn = vi.spyOn(console, 'warn',).mockImplementation(() => {},)

		expect(handleMessage(null, fakeSender,),).toBeUndefined()
		expect(handleMessage({action: 123,}, fakeSender,),).toBeUndefined()
		expect(handleMessage({payload: true,}, fakeSender,),).toBeUndefined()

		expect(warn,).toHaveBeenCalledTimes(3,)
		warn.mockRestore()
	})

	it('returns undefined and warns for malformed known message payloads', () => {
		const warn = vi.spyOn(console, 'warn',).mockImplementation(() => {},)
		const handler = vi.fn()
		registerMessageHandler('toolbox-request', handler,)

		expect(handleMessage({action: 'toolbox-request', method: 'GET',}, fakeSender,),).toBeUndefined()

		expect(handler,).not.toHaveBeenCalled()
		expect(warn,).toHaveBeenCalledWith(
			expect.any(String,),
			expect.any(String,),
			expect.any(String,),
			'Malformed toolbox message payload:',
			expect.any(Object,),
			fakeSender,
		)
		warn.mockRestore()
	})

	it('rejects tab-originated messages from non-Reddit senders', () => {
		const warn = vi.spyOn(console, 'warn',).mockImplementation(() => {},)
		const handler = vi.fn()
		const sender = {tab: {url: 'https://notreddit.com/r/toolbox',},} as unknown as browser.Runtime.MessageSender
		registerMessageHandler('toolbox-reload', handler,)

		expect(handleMessage({action: 'toolbox-reload',}, sender,),).toBeUndefined()

		expect(handler,).not.toHaveBeenCalled()
		expect(warn,).toHaveBeenCalledWith(
			expect.any(String,),
			expect.any(String,),
			expect.any(String,),
			'Rejected toolbox message from invalid sender:',
			'toolbox-reload',
			sender,
		)
		warn.mockRestore()
	})

	it('accepts tab-originated messages from HTTPS Reddit senders', async () => {
		const handler = vi.fn().mockReturnValue('ok',)
		const sender = {tab: {url: 'https://old.reddit.com/r/toolbox',},} as unknown as browser.Runtime.MessageSender
		registerMessageHandler('toolbox-reload', handler,)

		const result = await handleMessage({action: 'toolbox-reload',}, sender,)

		expect(handler,).toHaveBeenCalledWith({action: 'toolbox-reload',}, sender,)
		expect(result,).toBe('ok',)
	})

	it('replaces an existing handler when registering the same action again', async () => {
		const first = vi.fn()
		const second = vi.fn().mockReturnValue('second',)

		registerMessageHandler('toolbox-reload', first,)
		registerMessageHandler('toolbox-reload', second,)

		await expect(handleMessage({action: 'toolbox-reload',}, fakeSender,),).resolves.toBe('second',)
		expect(first,).not.toHaveBeenCalled()
		expect(second,).toHaveBeenCalledOnce()
	})

	it('logs handler failures and rethrows them to the caller', async () => {
		const error = vi.spyOn(console, 'error',).mockImplementation(() => {},)
		const handlerError = new Error('boom',)
		registerMessageHandler('toolbox-reload', vi.fn().mockRejectedValue(handlerError,),)

		await expect(handleMessage({action: 'toolbox-reload',}, fakeSender,),).rejects.toThrow('boom',)

		expect(error,).toHaveBeenCalledWith(
			expect.any(String,),
			expect.any(String,),
			expect.any(String,),
			'Toolbox background handler failed:',
			'toolbox-reload',
			handlerError,
		)
		error.mockRestore()
	})

	it('accepts messages from HTTPS redd.it senders', async () => {
		const handler = vi.fn().mockReturnValue('ok',)
		const reddItSender = {tab: {url: 'https://v.redd.it/embed/abc',},} as unknown as browser.Runtime.MessageSender
		registerMessageHandler('toolbox-reload', handler,)

		const result = await handleMessage({action: 'toolbox-reload',}, reddItSender,)

		expect(handler,).toHaveBeenCalled()
		expect(result,).toBe('ok',)
	})

	it('rejects messages from HTTP reddit.com senders', () => {
		const warn = vi.spyOn(console, 'warn',).mockImplementation(() => {},)
		const handler = vi.fn()
		const httpSender = {tab: {url: 'http://old.reddit.com/r/toolbox',},} as unknown as browser.Runtime.MessageSender
		registerMessageHandler('toolbox-reload', handler,)

		expect(handleMessage({action: 'toolbox-reload',}, httpSender,),).toBeUndefined()

		expect(handler,).not.toHaveBeenCalled()
		warn.mockRestore()
	})

	it('narrows the request type to the registered action', async () => {
		// Compile-time test: handler receives a TbModqueueMessage, not `any`.
		let receivedSubreddit = ''
		registerMessageHandler('toolbox-modqueue', (request,) => {
			receivedSubreddit = request.subreddit
		},)

		await handleMessage(
			{action: 'toolbox-modqueue', subreddit: 'memes', thingName: 't3_abc', thingTimestamp: 0,},
			fakeSender,
		)
		expect(receivedSubreddit,).toBe('memes',)
	})
})
