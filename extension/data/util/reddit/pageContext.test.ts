/** Tests for URL-derived page-type flags and their refresh on navigation. */

// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi,} from 'vitest'

/** Reloads pageContext.ts fresh with the given path as the current location. */
function loadWithPath (path: string,) {
	vi.resetModules()
	window.history.replaceState({}, '', path,)
	return import('./pageContext')
}

beforeEach(() => {
	window.history.replaceState({}, '', '/',)
},)

describe('page-type flags', () => {
	it('does not treat a subreddit like /r/userexperience as a user page', async () => {
		const ctx = await loadWithPath('/r/userexperience',)
		expect(ctx.isUserPage,).toBeNull()
	})

	it('matches an actual user profile path', async () => {
		const ctx = await loadWithPath('/user/alice',)
		expect(ctx.isUserPage,).not.toBeNull()
	})

	it('recomputes flags and postSite on soft navigation', async () => {
		const ctx = await loadWithPath('/user/alice',)
		expect(ctx.isUserPage,).not.toBeNull()

		ctx.watchForURLChanges()
		window.history.replaceState({}, '', '/r/pics/about/modqueue',)
		window.dispatchEvent(new CustomEvent('toolbox-url-changed',),)

		expect(ctx.isUserPage,).toBeNull()
		expect(ctx.isModQueuePage,).not.toBeNull()
		expect(ctx.postSite,).toBe('pics',)
	})
})
