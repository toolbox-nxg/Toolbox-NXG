/** Tests for the StickyButton sticky/unsticky listing control. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

// Sticky/unsticky route through the proposals gateway; mock it (the real module pulls in
// the wiki transport + webextension polyfill, which throws outside a browser).
vi.mock('../../shared/proposals/gateway', () => ({
	proposeOrSticky: vi.fn(() => Promise.resolve('performed',)),
	proposeOrUnsticky: vi.fn(() => Promise.resolve('performed',)),
}),)
vi.mock('../../../api/resources/subreddits', () => ({
	getSubredditListing: vi.fn(),
}),)
// uiLocations transitively loads the webextension polyfill, which throws outside a
// browser. StickyButton itself never touches it, so a stub keeps the import graph clean.
vi.mock('../../../dom/uiLocations', () => ({renderAtLocation: vi.fn(),}),)
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import {getSubredditListing,} from '../../../api/resources/subreddits'
import {proposeOrSticky, proposeOrUnsticky,} from '../../shared/proposals/gateway'
import {StickyButton,} from './stickyButtons'

const mockGetSubredditListing = vi.mocked(getSubredditListing,)
const mockProposeOrSticky = vi.mocked(proposeOrSticky,)
const mockProposeOrUnsticky = vi.mocked(proposeOrUnsticky,)

const roots: Root[] = []
let subCounter = 0

/**
 * Builds an old-Reddit `div.thing.link` element. Each call gets a unique subreddit so the
 * module-level sticky cache (keyed by subreddit) never bleeds between tests.
 */
function makeThing ({stickied = false,}: {stickied?: boolean} = {},) {
	const thing = document.createElement('div',)
	thing.className = stickied ? 'thing link stickied' : 'thing link'
	thing.setAttribute('data-fullname', 't3_abc',)
	thing.setAttribute('data-subreddit', `testsub${subCounter++}`,)
	return thing
}

/** Renders StickyButton for a thing and flushes pending effects/promises. */
async function renderButton (thing: Element,) {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)
	await act(async () => {
		root.render(<StickyButton thing={thing} />,)
	},)
	return host
}

/** Clicks the anchor whose text matches `label`. */
async function clickLink (host: HTMLElement, label: string,) {
	const link = Array.from(host.querySelectorAll('a',),).find((a,) => a.textContent === label)
	expect(link, `expected link "${label}"`,).toBeTruthy()
	await act(async () => {
		link!.dispatchEvent(new MouseEvent('click', {bubbles: true,},),)
	},)
}

beforeEach(() => {
	vi.clearAllMocks()
},)

afterEach(() => {
	roots.forEach((root,) => act(() => root.unmount()))
	roots.length = 0
	document.body.innerHTML = ''
},)

describe('StickyButton', () => {
	it('hides "sticky slot 2" when the subreddit has no sticky', async () => {
		mockGetSubredditListing.mockRejectedValue(new Error('404',),)
		const host = await renderButton(makeThing(),)

		expect(host.textContent,).toContain('sticky slot 1',)
		expect(host.textContent,).not.toContain('sticky slot 2',)
	})

	it('shows "sticky slot 2" when the subreddit already has a sticky', async () => {
		mockGetSubredditListing.mockResolvedValue(
			{kind: 'Listing', data: {children: [{},], after: null, before: null,},} as any,
		)
		const host = await renderButton(makeThing(),)

		expect(host.textContent,).toContain('sticky slot 1',)
		expect(host.textContent,).toContain('sticky slot 2',)
	})

	it('stickies into slot 1 on click', async () => {
		mockGetSubredditListing.mockRejectedValue(new Error('404',),)
		const host = await renderButton(makeThing(),)

		await clickLink(host, 'sticky slot 1',)

		expect(mockProposeOrSticky,).toHaveBeenCalledWith(
			expect.objectContaining({itemId: 't3_abc', itemKind: 'post',},),
			1,
		)
		expect(host.textContent,).toContain('stickied',)
	})

	it('stickies into slot 2 on click', async () => {
		mockGetSubredditListing.mockResolvedValue(
			{kind: 'Listing', data: {children: [{},], after: null, before: null,},} as any,
		)
		const host = await renderButton(makeThing(),)

		await clickLink(host, 'sticky slot 2',)

		expect(mockProposeOrSticky,).toHaveBeenCalledWith(
			expect.objectContaining({itemId: 't3_abc', itemKind: 'post',},),
			2,
		)
	})

	it('unstickies a stickied post on click', async () => {
		const host = await renderButton(makeThing({stickied: true,},),)

		await clickLink(host, 'unsticky',)

		expect(mockProposeOrUnsticky,).toHaveBeenCalledWith(
			expect.objectContaining({itemId: 't3_abc', itemKind: 'post',},),
		)
		expect(host.textContent,).toContain('unstickied',)
	})

	it('surfaces an error when the sticky call rejects', async () => {
		mockGetSubredditListing.mockRejectedValue(new Error('404',),)
		mockProposeOrSticky.mockRejectedValueOnce(new Error('boom',),)
		const host = await renderButton(makeThing(),)

		await clickLink(host, 'sticky slot 1',)

		expect(host.textContent,).toContain('failed to sticky',)
	})
})
