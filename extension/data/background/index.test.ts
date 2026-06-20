/** Tests for background entrypoint. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const registerCacheHandlers = vi.hoisted(() => vi.fn())
const registerCookieStoreHandlers = vi.hoisted(() => vi.fn())
const registerGlobalMessageHandlers = vi.hoisted(() => vi.fn())
const registerModqueueHandlers = vi.hoisted(() => vi.fn())
const registerNotificationHandlers = vi.hoisted(() => vi.fn())
const registerReloadHandlers = vi.hoisted(() => vi.fn())
const registerSettingsHandlers = vi.hoisted(() => vi.fn())
const registerUrlChangedListeners = vi.hoisted(() => vi.fn())
const registerUsernoteHandlers = vi.hoisted(() => vi.fn())
const registerWebrequestHandlers = vi.hoisted(() => vi.fn())

vi.mock('./handlers/cache', () => ({registerCacheHandlers,}),)
vi.mock('./handlers/cookieStore', () => ({registerCookieStoreHandlers,}),)
vi.mock('./handlers/globalmessage', () => ({registerGlobalMessageHandlers,}),)
vi.mock('./handlers/modqueue', () => ({registerModqueueHandlers,}),)
vi.mock('./handlers/notifications', () => ({registerNotificationHandlers,}),)
vi.mock('./handlers/reload', () => ({registerReloadHandlers,}),)
vi.mock('./handlers/settings', () => ({registerSettingsHandlers,}),)
vi.mock('./handlers/url_changed', () => ({registerUrlChangedListeners,}),)
vi.mock('./handlers/usernotes', () => ({registerUsernoteHandlers,}),)
vi.mock('./handlers/webrequest', () => ({registerWebrequestHandlers,}),)

beforeEach(() => {
	vi.resetModules()
	registerCacheHandlers.mockClear()
	registerCookieStoreHandlers.mockClear()
	registerGlobalMessageHandlers.mockClear()
	registerModqueueHandlers.mockClear()
	registerNotificationHandlers.mockClear()
	registerReloadHandlers.mockClear()
	registerSettingsHandlers.mockClear()
	registerUrlChangedListeners.mockClear()
	registerUsernoteHandlers.mockClear()
	registerWebrequestHandlers.mockClear()
},)

describe('background entrypoint', () => {
	it('registers every background handler on import', async () => {
		await import('./index')

		expect(registerCacheHandlers,).toHaveBeenCalledOnce()
		expect(registerCookieStoreHandlers,).toHaveBeenCalledOnce()
		expect(registerGlobalMessageHandlers,).toHaveBeenCalledOnce()
		expect(registerModqueueHandlers,).toHaveBeenCalledOnce()
		expect(registerNotificationHandlers,).toHaveBeenCalledOnce()
		expect(registerReloadHandlers,).toHaveBeenCalledOnce()
		expect(registerSettingsHandlers,).toHaveBeenCalledOnce()
		expect(registerUsernoteHandlers,).toHaveBeenCalledOnce()
		expect(registerWebrequestHandlers,).toHaveBeenCalledOnce()
		expect(registerUrlChangedListeners,).toHaveBeenCalledOnce()
	})
})
