/** Tests for URL-derived page-type flags and their refresh on navigation. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

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

describe('link', () => {
	// `currentPlatform` (hence `isShreddit`) is computed once at module load from the
	// DOM, so each case sets up the document and re-imports the module fresh.
	async function loadLink (dom: string,) {
		document.body.innerHTML = dom
		vi.resetModules()
		return (await import('./pageContext')).link
	}

	afterEach(() => {
		document.body.innerHTML = ''
	},)

	it('remaps relative moderation paths to shreddit form on shreddit', async () => {
		const link = await loadLink('<shreddit-app></shreddit-app>',)
		expect(link('/r/mod/about/unmoderated',),).toBe('/mod/queue?queueType=unmoderated',)
	})

	it('passes non-moderation and absolute links through unchanged on shreddit', async () => {
		const link = await loadLink('<shreddit-app></shreddit-app>',)
		expect(link('/user/someone',),).toBe('/user/someone',)
		expect(link('/r/somesub/wiki/index',),).toBe('/r/somesub/wiki/index',)
		expect(link('https://www.reddit.com/mail/all',),).toBe('https://www.reddit.com/mail/all',)
	})

	it('leaves paths untouched on old Reddit', async () => {
		// old Reddit is detected by the `#header` element; no shreddit-app present.
		const link = await loadLink('<div id="header"></div>',)
		expect(link('/r/mod/about/unmoderated',),).toBe('/r/mod/about/unmoderated',)
	})
})
