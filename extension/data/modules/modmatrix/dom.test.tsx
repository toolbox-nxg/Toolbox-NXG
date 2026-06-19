/** Tests for modmatrix DOM helpers. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

vi.mock('webextension-polyfill', () => ({
	default: {runtime: {getURL: (path: string,) => `chrome-extension://fake/${path}`,},},
}),)
vi.mock('react-dom/client', () => ({
	createRoot: () => ({render: vi.fn(), unmount: vi.fn(),}),
}),)
vi.mock('../../store/index', () => ({default: {dispatch: vi.fn(), getState: vi.fn(), subscribe: vi.fn(),},}),)
vi.mock(
	'./components/MatrixStyleProvider',
	() => ({MatrixStyleProvider: ({children,}: {children: React.ReactNode},) => children,}),
)
vi.mock('./components/ModMatrixApp', () => ({ModMatrixApp: () => null,}),)
vi.mock('../../util/ui/reactMount', () => ({
	reactRenderer: () => document.createElement('div',),
	mountPopup: (factory: (onClose: () => void,) => unknown,) => {
		factory(() => {},)
		return () => {}
	},
}),)

import {getSubredditName, getSubredditUrl, showMatrixPopup,} from './dom'

beforeEach(() => {
	document.body.innerHTML = ''
},)

describe('modmatrix DOM helpers', () => {
	it('gets the subreddit URL and normalizes a trailing slash', () => {
		document.body.innerHTML =
			'<div id="header"><span class="hover pagename redditname"><a href="https://reddit.com/r/toolbox">toolbox</a></span></div>'

		expect(getSubredditUrl(),).toBe('https://reddit.com/r/toolbox/',)
	})

	it('returns null when no subreddit URL is present', () => {
		expect(getSubredditUrl(),).toBeNull()
	})

	it('extracts subreddit names from reddit URLs', () => {
		expect(getSubredditName('https://old.reddit.com/r/toolbox/',),).toBe('toolbox',)
		expect(getSubredditName('https://www.reddit.com/r/ToolboxTest/about/log/',),).toBe('ToolboxTest',)
	})

	it('returns null for missing or non-subreddit URLs', () => {
		expect(getSubredditName(null,),).toBeNull()
		expect(getSubredditName('https://reddit.com/user/example/',),).toBeNull()
	})
})

describe('showMatrixPopup', () => {
	it('calls mountPopup and returns a cleanup function', () => {
		const cleanup = showMatrixPopup('https://old.reddit.com/r/toolbox/', 'toolbox',)
		expect(typeof cleanup,).toBe('function',)
	})

	it('works with null subreddit info', () => {
		const cleanup = showMatrixPopup(null, null,)
		expect(typeof cleanup,).toBe('function',)
	})
})
