/** Tests for the native-approve interceptor (trainee approvals → proposals). */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

const proposeOrApprove = vi.hoisted(() => vi.fn(async () => 'captured' as const))
const isTraineeForSync = vi.hoisted(() => vi.fn())
// Sandboxed-somewhere fast-path gate; default true so per-sub tests reach interception.
const isTraineeAnywhereSync = vi.hoisted(() => vi.fn(() => true))
// Whether the page's trainee state has warmed; default true so the per-sub tests exercise
// the authoritative (warm) path. The unwarmed-fail-closed cases set this false explicitly.
const isTraineeStateWarm = vi.hoisted(() => vi.fn(() => true))
const positiveTextFeedback = vi.hoisted(() => vi.fn())
const negativeTextFeedback = vi.hoisted(() => vi.fn())

vi.mock('./gateway', () => ({proposeOrApprove,}),)
vi.mock('./traineeState', () => ({isTraineeForSync, isTraineeAnywhereSync, isTraineeStateWarm,}),)
vi.mock('../../../store/feedback', () => ({positiveTextFeedback, negativeTextFeedback,}),)
vi.mock('../../../dom/oldReddit/things', () => ({
	getThingFullname: (t: Element,) => t.getAttribute('data-fullname',),
	getThingSubreddit: (t: Element,) => t.getAttribute('data-subreddit',),
}),)
// dom/shreddit/things is left unmocked: getThingContext is a pure attribute reader.

import {handleApproveClick,} from './approveCapture'

/** Builds a thing with an old-Reddit approve button and returns the clickable button. */
function makeThing (fullname: string, subreddit: string,): HTMLElement {
	const thing = document.createElement('div',)
	thing.className = 'thing'
	thing.setAttribute('data-fullname', fullname,)
	thing.setAttribute('data-subreddit', subreddit,)
	thing.setAttribute('data-permalink', '/r/testsub/comments/abc/x/',)
	thing.innerHTML = '<div class="big-mod-buttons"><span><a class="pretty-button positive">approve</a></span></div>'
	document.body.appendChild(thing,)
	return thing.querySelector<HTMLElement>('.positive',)!
}

/** Dispatches a cancelable click through the capture-phase handler; returns the event. */
function clickApprove (el: HTMLElement,): MouseEvent {
	const event = new MouseEvent('click', {bubbles: true, cancelable: true,},)
	document.addEventListener('click', handleApproveClick as EventListener, true,)
	el.dispatchEvent(event,)
	document.removeEventListener('click', handleApproveClick as EventListener, true,)
	return event
}

beforeEach(() => {
	vi.clearAllMocks()
	// clearAllMocks clears call history but not return values; reset the gates to their
	// defaults so a test that flips one can't leak forward.
	isTraineeAnywhereSync.mockReturnValue(true,)
	isTraineeStateWarm.mockReturnValue(true,)
	document.body.innerHTML = ''
},)

afterEach(() => {
	document.body.innerHTML = ''
},)

describe('handleApproveClick', () => {
	it('captures a trainee approval and blocks the native approve', () => {
		isTraineeForSync.mockReturnValue(true,)
		const event = clickApprove(makeThing('t3_abc', 'testsub',),)

		expect(event.defaultPrevented,).toBe(true,)
		expect(proposeOrApprove,).toHaveBeenCalledWith({
			subreddit: 'testsub',
			itemId: 't3_abc',
			itemKind: 'post',
			link: 'http://localhost:3000/r/testsub/comments/abc/x/',
		},)
	})

	it('classifies a comment fullname as a comment', () => {
		isTraineeForSync.mockReturnValue(true,)
		clickApprove(makeThing('t1_def', 'testsub',),)
		expect(proposeOrApprove,).toHaveBeenCalledWith(expect.objectContaining({itemKind: 'comment',},),)
	})

	it('leaves a non-trainee\'s native approve untouched', () => {
		isTraineeForSync.mockReturnValue(false,)
		const event = clickApprove(makeThing('t3_abc', 'testsub',),)

		expect(event.defaultPrevented,).toBe(false,)
		expect(proposeOrApprove,).not.toHaveBeenCalled()
	})

	it('fast-path: does nothing (no per-sub check) when warm and sandboxed nowhere', () => {
		isTraineeAnywhereSync.mockReturnValue(false,)
		isTraineeForSync.mockReturnValue(true,)
		const event = clickApprove(makeThing('t3_abc', 'testsub',),)

		expect(event.defaultPrevented,).toBe(false,)
		expect(proposeOrApprove,).not.toHaveBeenCalled()
		expect(isTraineeForSync,).not.toHaveBeenCalled()
	})

	it('does NOT fall open before warm: swallows the approve and defers to the async decision', () => {
		// The warmup race: the user clicks native approve before trainee state is warm. A sync
		// "not a trainee" is unreliable here, so the click must be swallowed and routed through
		// the gateway (which awaits config) rather than performing a real, unreviewed approval.
		isTraineeStateWarm.mockReturnValue(false,)
		isTraineeAnywhereSync.mockReturnValue(false,) // unreliable while cold — must be ignored
		isTraineeForSync.mockReturnValue(false,) // likewise unreliable while cold
		const event = clickApprove(makeThing('t3_abc', 'testsub',),)

		expect(event.defaultPrevented,).toBe(true,)
		expect(proposeOrApprove,).toHaveBeenCalledWith(expect.objectContaining({
			subreddit: 'testsub',
			itemId: 't3_abc',
		},),)
	})

	it('ignores a non-approve click even before warm (no spurious interception)', () => {
		isTraineeStateWarm.mockReturnValue(false,)
		const thing = document.createElement('div',)
		thing.className = 'thing'
		thing.setAttribute('data-fullname', 't3_abc',)
		thing.setAttribute('data-subreddit', 'testsub',)
		thing.innerHTML = '<a class="pretty-button negative">remove</a>'
		document.body.appendChild(thing,)

		const event = clickApprove(thing.querySelector<HTMLElement>('.negative',)!,)
		expect(event.defaultPrevented,).toBe(false,)
		expect(proposeOrApprove,).not.toHaveBeenCalled()
	})

	it('ignores clicks that are not on an approve button', () => {
		isTraineeForSync.mockReturnValue(true,)
		const thing = document.createElement('div',)
		thing.className = 'thing'
		thing.setAttribute('data-fullname', 't3_abc',)
		thing.setAttribute('data-subreddit', 'testsub',)
		thing.innerHTML = '<a class="pretty-button negative">remove</a>'
		document.body.appendChild(thing,)

		clickApprove(thing.querySelector<HTMLElement>('.negative',)!,)
		expect(proposeOrApprove,).not.toHaveBeenCalled()
	})
})

describe('handleApproveClick (Shreddit)', () => {
	/** Builds a shreddit-post with a native approve mod-action-button; returns the button. */
	function makeShredditPost (fullname: string, subreddit: string,): HTMLElement {
		const post = document.createElement('shreddit-post',)
		post.setAttribute('id', fullname,)
		post.setAttribute('subreddit-name', subreddit,)
		post.setAttribute('permalink', '/r/testsub/comments/abc/x/',)
		const button = document.createElement('mod-action-button',)
		button.setAttribute('data-mod-action', 'mod-approve-content',)
		post.appendChild(button,)
		document.body.appendChild(post,)
		return button
	}

	it('captures a trainee approval from the Shreddit mod-action button', () => {
		isTraineeForSync.mockReturnValue(true,)
		const event = clickApprove(makeShredditPost('t3_xyz', 'testsub',),)

		expect(event.defaultPrevented,).toBe(true,)
		expect(proposeOrApprove,).toHaveBeenCalledWith({
			subreddit: 'testsub',
			itemId: 't3_xyz',
			itemKind: 'post',
			link: 'http://localhost:3000/r/testsub/comments/abc/x/',
		},)
	})

	it('leaves a non-trainee\'s Shreddit approve untouched', () => {
		isTraineeForSync.mockReturnValue(false,)
		const event = clickApprove(makeShredditPost('t3_xyz', 'testsub',),)

		expect(event.defaultPrevented,).toBe(false,)
		expect(proposeOrApprove,).not.toHaveBeenCalled()
	})
})
