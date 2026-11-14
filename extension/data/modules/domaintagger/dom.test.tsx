/** Tests that the Domain Tagger counts removals announced by Removal Reasons via `TB_THING_REMOVED`. */
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

const incrementDomainStat = vi.hoisted(() => vi.fn(async () => {},))
const getDomainTagsData = vi.hoisted(() => vi.fn(async () => ({tags: [], showCounts: false,})))
vi.mock('./moduleapi', () => ({incrementDomainStat, getDomainTagsData, saveDomainTag: vi.fn(),}),)
vi.mock('webextension-polyfill', () => ({
	default: {runtime: {getURL: (path: string,) => `chrome-extension://fake/${path}`,},},
}),)
vi.mock('../../api/resources/modSubs', () => ({isModSub: vi.fn(async () => true),}),)
vi.mock('../../dom/uiLocations', () => ({
	provideLocation: vi.fn(),
	refreshProvidedLocation: vi.fn(),
	removeProvidedLocation: vi.fn(),
	renderAtLocation: vi.fn(),
}),)

import {createDomainTaggerHandlers, type DomainTaggerHandlers,} from './dom'

/** Builds a `TB_THING_REMOVED` event as Removal Reasons sends it. */
function removedEvent (thingId: string,): CustomEvent {
	return new CustomEvent('TB_THING_REMOVED', {detail: {thingId, spam: false,},},)
}

describe('handleThingRemoved', () => {
	let handlers: DomainTaggerHandlers

	beforeEach(() => {
		incrementDomainStat.mockClear()
		handlers = createDomainTaggerHandlers({displayType: 'title_dot',} as never,)
	},)

	afterEach(async () => {
		await handlers.cleanup()
		document.body.innerHTML = ''
	},)

	it('counts a removal of an old Reddit link post', () => {
		document.body.innerHTML = `
			<div class="thing" data-fullname="t3_abc" data-subreddit="pics">
				<div class="entry"><span class="domain">(<a href="/domain/example.com/">example.com</a>)</span></div>
			</div>`
		handlers.handleThingRemoved(removedEvent('t3_abc',),)
		expect(incrementDomainStat,).toHaveBeenCalledWith('pics', 'example.com', 'remove',)
	})

	it('counts a removal of a Shreddit post', () => {
		document.body.innerHTML =
			`<shreddit-post id="t3_xyz" subreddit-name="pics" content-href="https://www.example.com/a"></shreddit-post>`
		handlers.handleThingRemoved(removedEvent('t3_xyz',),)
		expect(incrementDomainStat,).toHaveBeenCalledWith('pics', 'example.com', 'remove',)
	})

	it('ignores comments and items not on the page', () => {
		handlers.handleThingRemoved(removedEvent('t1_abc',),)
		handlers.handleThingRemoved(removedEvent('t3_missing',),)
		expect(incrementDomainStat,).not.toHaveBeenCalled()
	})
})
