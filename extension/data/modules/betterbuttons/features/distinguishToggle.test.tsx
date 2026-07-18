/** Tests for the old-Reddit distinguish toggle and its injected "sticky" comment link. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

// Stickying routes through the proposals gateway; mock it (the real module pulls in the wiki
// transport + webextension polyfill, which throws outside a browser). uiLocations is stubbed for the
// same reason - StickyToggle is rendered directly here instead of through a slot.
const proposeOrDistinguish = vi.hoisted(() => vi.fn(() => Promise.resolve('performed',)))
const renderAtLocation = vi.hoisted(() => vi.fn(() => () => {}))
const provideLocation = vi.hoisted(() => vi.fn(() => () => {}))
const notifyNewThings = vi.hoisted(() => vi.fn())

vi.mock('../../shared/proposals/gateway', () => ({proposeOrDistinguish,}),)
vi.mock('../../../dom/uiLocations', () => ({renderAtLocation, provideLocation,}),)
vi.mock('../../../util/ui/listener', () => ({notifyNewThings,}),)
vi.mock('../../../util/infra/logging', () => ({
	default: () => ({error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn(),}),
}),)
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

import {createDistinguishToggleHandlers, distinguishFormSelector,} from './distinguishToggle'

const roots: Root[] = []
const cleanups: Array<() => void> = []

/** Creates the handlers and registers their teardown so injected UI never leaks between tests. */
function createHandlers () {
	const handlers = createDistinguishToggleHandlers()
	cleanups.push(() => void handlers.cleanup())
	return handlers
}

/**
 * Builds a top-level comment carrying Reddit's distinguish toggle. `action` defaults to the absolute
 * URL Reddit actually renders today, which an exact `[action="/post/distinguish"]` match would miss.
 */
function makeComment (
	{action = 'https://www.reddit.com/post/distinguish', distinguished = false,} = {},
) {
	document.body.innerHTML = `
		<div class="sitetable nestedlisting">
			<div class="thing comment" data-fullname="t1_abc" data-subreddit="testsub">
				<div class="entry">
					<a class="author${distinguished ? ' moderator' : ''}">someone</a>
					<ul class="buttons">
						<li class="toggle">
							<form method="post" action="${action}">
								<a class="outer">distinguish</a>
								<span class="option">
									<a class="yes">yes</a>
									<a class="no">no</a>
								</span>
							</form>
						</li>
					</ul>
				</div>
			</div>
		</div>`
	return {
		form: document.querySelector<HTMLFormElement>('form',)!,
		outer: document.querySelector<HTMLElement>('a.outer',)!,
		yes: document.querySelector<HTMLElement>('a.yes',)!,
	}
}

/** Renders the sticky link by invoking the captured slot renderer with a context. */
async function renderStickyLink (thingId = 't1_abc', subreddit = 'testsub',) {
	createHandlers()
	const renderer = renderAtLocation.mock.calls[0]![2] as (
		args: {context: Record<string, unknown>},
	) => React.ReactElement | null
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)
	await act(async () => {
		root.render(renderer({context: {thingId, subreddit,},},),)
	},)
	return host
}

beforeEach(() => {
	vi.clearAllMocks()
	document.body.innerHTML = ''
},)

afterEach(() => {
	roots.forEach((root,) => act(() => root.unmount()))
	roots.length = 0
	while (cleanups.length) { cleanups.pop()!() }
	document.body.innerHTML = ''
},)

describe('distinguishFormSelector', () => {
	it('matches the absolute action Reddit renders today', () => {
		const {form,} = makeComment()
		expect(form.matches(distinguishFormSelector,),).toBe(true,)
		// The previous exact-match selector is what silently broke every call site.
		expect(form.matches('form[action="/post/distinguish"]',),).toBe(false,)
	})

	it('still matches a relative action', () => {
		const {form,} = makeComment({action: '/post/distinguish',},)
		expect(form.matches(distinguishFormSelector,),).toBe(true,)
	})
})

describe('addSticky', () => {
	it('injects a sticky slot on an undistinguished top-level comment', () => {
		makeComment()
		const {addSticky,} = createHandlers()

		addSticky()

		expect(provideLocation,).toHaveBeenCalledWith(
			'commentDistinguishControls',
			expect.any(Element,),
			expect.objectContaining({thingId: 't1_abc', subreddit: 'testsub',},),
			expect.anything(),
		)
	})

	it('skips a comment that is already distinguished', () => {
		makeComment({distinguished: true,},)
		const {addSticky,} = createHandlers()

		addSticky()

		expect(provideLocation,).not.toHaveBeenCalled()
	})

	it('skips a comment with no distinguish form (not the viewer\'s own)', () => {
		makeComment()
		document.querySelector('form',)!.remove()
		const {addSticky,} = createHandlers()

		addSticky()

		expect(provideLocation,).not.toHaveBeenCalled()
	})

	it('injects only once for the same comment', () => {
		makeComment()
		const {addSticky,} = createHandlers()

		addSticky()
		addSticky()

		expect(provideLocation,).toHaveBeenCalledTimes(1,)
	})
})

describe('StickyToggle', () => {
	it('stickies via the gateway with sticky = true', async () => {
		const host = await renderStickyLink()

		await act(async () => {
			host.querySelector('a',)!.dispatchEvent(new MouseEvent('click', {bubbles: true,},),)
		},)

		expect(proposeOrDistinguish,).toHaveBeenCalledWith(
			{subreddit: 'testsub', itemId: 't1_abc', itemKind: 'comment',},
			true,
		)
		expect(host.textContent,).toContain('stickied',)
	})

	it('surfaces an error when the sticky call rejects', async () => {
		proposeOrDistinguish.mockRejectedValueOnce(new Error('boom',),)
		const host = await renderStickyLink()

		await act(async () => {
			host.querySelector('a',)!.dispatchEvent(new MouseEvent('click', {bubbles: true,},),)
		},)

		expect(host.textContent,).toContain('failed to sticky',)
	})

	it('keeps the link when the action is only captured for review', async () => {
		proposeOrDistinguish.mockResolvedValueOnce('captured',)
		const host = await renderStickyLink()

		await act(async () => {
			host.querySelector('a',)!.dispatchEvent(new MouseEvent('click', {bubbles: true,},),)
		},)

		// Nothing happened on Reddit, so the link stays available rather than reading "stickied".
		expect(host.textContent,).toContain('sticky',)
		expect(host.textContent,).not.toContain('stickied',)
	})
})

describe('distinguishClicked', () => {
	it('auto-confirms a real toggle click by clicking the first option', () => {
		const {form, yes,} = makeComment()
		const {distinguishClicked,} = createHandlers()
		const yesClick = vi.fn()
		yes.addEventListener('click', yesClick,)

		// A constructed MouseEvent is untrusted, so mark it trusted to stand in for a real user click.
		const event = new MouseEvent('click', {bubbles: true,},)
		Object.defineProperty(event, 'isTrusted', {value: true,},)
		distinguishClicked(form, event,)

		expect(yesClick,).toHaveBeenCalled()
	})

	it('ignores untrusted events so the synthetic confirm click cannot loop', () => {
		const {form, yes,} = makeComment()
		const {distinguishClicked,} = createHandlers()
		const yesClick = vi.fn()
		yes.addEventListener('click', yesClick,)

		// A dispatched MouseEvent is untrusted, which is exactly what our own confirm click produces.
		const event = new MouseEvent('click', {bubbles: true,},)
		Object.defineProperty(event, 'isTrusted', {value: false,},)
		distinguishClicked(form, event,)

		expect(yesClick,).not.toHaveBeenCalled()
	})

	it('ignores clicks that originate inside the confirm menu', () => {
		const {form, yes,} = makeComment()
		const {distinguishClicked,} = createHandlers()
		const yesClick = vi.fn()
		yes.addEventListener('click', yesClick,)

		// Trusted on purpose, so the `.option` guard is what rejects this and not the isTrusted check.
		const event = new MouseEvent('click', {bubbles: true,},)
		Object.defineProperty(event, 'isTrusted', {value: true,},)
		Object.defineProperty(event, 'target', {value: yes,},)
		distinguishClicked(form, event,)

		expect(yesClick,).not.toHaveBeenCalled()
	})
})
