/** Tests for reload handler. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const reload = vi.hoisted(() => vi.fn())
const registerMessageHandler = vi.hoisted(() => vi.fn())

vi.mock('webextension-polyfill', () => ({
	default: {runtime: {reload,},},
}),)
vi.mock('../messageHandling', () => ({registerMessageHandler,}),)

import {registerReloadHandlers,} from './reload'

beforeEach(() => {
	reload.mockClear()
	registerMessageHandler.mockClear()
},)

describe('reload handler', () => {
	it('registers toolbox-reload and reloads the extension', () => {
		registerReloadHandlers()
		const handler = registerMessageHandler.mock.calls[0]![1]

		handler()

		expect(registerMessageHandler,).toHaveBeenCalledWith('toolbox-reload', expect.any(Function,),)
		expect(reload,).toHaveBeenCalledOnce()
	})
})
