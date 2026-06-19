/** Tests for the Toolbox reddit-element action-button wiring and capture-guard registration. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

// Capture the gateway helpers so we can assert what subreddit the click handlers pass.
const proposeOrApprove = vi.hoisted(() => vi.fn(() => Promise.resolve('performed',)))
const proposeOrRemove = vi.hoisted(() => vi.fn(() => Promise.resolve('performed',)))
const proposeOrLock = vi.hoisted(() => vi.fn(() => Promise.resolve('performed',)))
const proposeOrUnlock = vi.hoisted(() => vi.fn(() => Promise.resolve('performed',)))
const proposeOrMarkNsfw = vi.hoisted(() => vi.fn(() => Promise.resolve('performed',)))
const registerItemSubreddit = vi.hoisted(() => vi.fn())

vi.mock('../../modules/shared/proposals/gateway', () => ({
	proposeOrApprove,
	proposeOrRemove,
	proposeOrLock,
	proposeOrUnlock,
	proposeOrMarkNsfw,
}),)
vi.mock('../infra/captureGuard', () => ({registerItemSubreddit,}),)
vi.mock('../persistence/settings', () => ({getSettingAsync: vi.fn().mockResolvedValue('PJSalt',),}),)
vi.mock('../../api/resources/comments', () => ({getMoreComments: vi.fn(),}),)
vi.mock('../../store', () => ({default: {dispatch: vi.fn(),},}),)
vi.mock('../../store/spinnerSlice', () => ({startSpinner: vi.fn(), stopSpinner: vi.fn(),}),)
vi.mock('../../dom/uiLocations', () => ({provideLocation: vi.fn(() => vi.fn()),}),)
// The React components are only used by the make* helpers, not the paths under test.
vi.mock(
	'../../modules/shared/redditElements/TBComment',
	() => ({TBComment: () => null, TBCommentChildren: () => null,}),
)
vi.mock('../../modules/shared/redditElements/TBSubmission', () => ({TBSubmission: () => null,}),)

// Importing the module registers its body-level delegated click handlers (a side effect),
// so this import must come after the mocks above.
import {tbRedditEvent,} from './redditElementsInit'

/** Builds a detached wrapper containing `html` so tbRedditEvent can scan it for `.toolbox-thing`. */
function wrapper (html: string,): HTMLElement {
	const el = document.createElement('div',)
	el.innerHTML = html
	return el
}

beforeEach(() => {
	vi.clearAllMocks()
	document.body.innerHTML = ''
},)

describe('capture-guard item registration (tbRedditEvent)', () => {
	it('registers each rendered thing\'s fullname→subreddit so the guard can resolve it', () => {
		tbRedditEvent(
			wrapper(
				'<div class="toolbox-thing toolbox-submission" data-fullname="t3_abc" data-subreddit="testsub"></div>',
			),
		)

		expect(registerItemSubreddit,).toHaveBeenCalledWith('testsub', 't3_abc',)
	})

	it('registers comments too', () => {
		tbRedditEvent(
			wrapper(
				'<div class="toolbox-thing toolbox-comment" data-fullname="t1_xyz" data-subreddit="testsub"></div>',
			),
		)

		expect(registerItemSubreddit,).toHaveBeenCalledWith('testsub', 't1_xyz',)
	})

	it('does not register a thing that has no subreddit attribute', () => {
		tbRedditEvent(wrapper('<div class="toolbox-thing toolbox-submission" data-fullname="t3_abc"></div>',),)

		expect(registerItemSubreddit,).not.toHaveBeenCalled()
	})
})

describe('action-button click delegation', () => {
	it('routes a remove click through the gateway with the subreddit read from the enclosing thing', () => {
		document.body.innerHTML = `
			<div class="toolbox-thing toolbox-submission" data-fullname="t3_abc" data-subreddit="testsub">
				<a class="toolbox-submission-button toolbox-submission-button-remove" data-fullname="t3_abc">remove</a>
			</div>
		`
		document.querySelector('.toolbox-submission-button-remove',)!
			.dispatchEvent(new MouseEvent('click', {bubbles: true,},),)

		// The subreddit must come from the .toolbox-thing container, not the button (which only
		// carries data-fullname) - otherwise it would be '' and the gateway would perform the
		// real action for a sandboxed trainee.
		expect(proposeOrRemove,).toHaveBeenCalledWith(
			expect.objectContaining({subreddit: 'testsub', itemId: 't3_abc', itemKind: 'post',},),
			false,
		)
	})

	it('passes itemKind "comment" and the thing subreddit for a comment approve click', () => {
		document.body.innerHTML = `
			<div class="toolbox-thing toolbox-comment" data-fullname="t1_xyz" data-subreddit="testsub">
				<a class="toolbox-comment-button toolbox-comment-button-approve" data-fullname="t1_xyz">approve</a>
			</div>
		`
		document.querySelector('.toolbox-comment-button-approve',)!
			.dispatchEvent(new MouseEvent('click', {bubbles: true,},),)

		expect(proposeOrApprove,).toHaveBeenCalledWith(
			expect.objectContaining({subreddit: 'testsub', itemId: 't1_xyz', itemKind: 'comment',},),
		)
	})
})
