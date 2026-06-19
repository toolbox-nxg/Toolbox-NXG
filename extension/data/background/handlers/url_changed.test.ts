/** Tests for url changed handler. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const sendMessage = vi.hoisted(() => vi.fn())
const onReferenceFragmentUpdated = vi.hoisted(() => ({addListener: vi.fn(),}))
const onHistoryStateUpdated = vi.hoisted(() => ({addListener: vi.fn(),}))

vi.mock('webextension-polyfill', () => ({
	default: {
		tabs: {sendMessage,},
		webNavigation: {onReferenceFragmentUpdated, onHistoryStateUpdated,},
	},
}),)

import {registerUrlChangedListeners,} from './url_changed'

beforeEach(() => {
	sendMessage.mockReset().mockResolvedValue(undefined,)
	onReferenceFragmentUpdated.addListener.mockClear()
	onHistoryStateUpdated.addListener.mockClear()
},)

describe('url changed handler', () => {
	it('registers reddit webNavigation listeners', () => {
		registerUrlChangedListeners()

		const filter = {url: [{hostSuffix: 'reddit.com',},],}
		expect(onReferenceFragmentUpdated.addListener,).toHaveBeenCalledWith(expect.any(Function,), filter,)
		expect(onHistoryStateUpdated.addListener,).toHaveBeenCalledWith(expect.any(Function,), filter,)
	})

	it('sends toolbox-url-changed to the changed frame', async () => {
		registerUrlChangedListeners()
		const handler = onHistoryStateUpdated.addListener.mock.calls[0]![0]

		handler({tabId: 7, frameId: 3,},)
		await Promise.resolve()

		expect(sendMessage,).toHaveBeenCalledWith(7, {action: 'toolbox-url-changed',}, {frameId: 3,},)
	})

	it('warns for unexpected sendMessage failures', async () => {
		const warn = vi.spyOn(console, 'warn',).mockImplementation(() => {},)
		sendMessage.mockReturnValue(Promise.reject(new Error('boom',),),)
		registerUrlChangedListeners()
		const handler = onHistoryStateUpdated.addListener.mock.calls[0]![0]

		handler({tabId: 7, frameId: 3,},)
		await Promise.resolve()
		await Promise.resolve()

		expect(warn,).toHaveBeenCalledWith(
			expect.any(String,),
			expect.any(String,),
			expect.any(String,),
			'toolbox-url-changed: ',
			'boom',
			expect.any(Error,),
		)
		warn.mockRestore()
	})
})
