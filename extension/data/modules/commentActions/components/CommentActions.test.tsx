/** Tests for the recreated comment controls (CommentVote / CommentExtras). */

import {act, type ReactElement,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

// Stub the reactMount `classes` helper + logging (the real modules pull in browser-only deps). The
// commentActionRow helpers are used for real against DOM fixtures.
vi.mock('../../../util/ui/reactMount', () => ({
	classes: (...stuff: unknown[]) => stuff.flat().filter(Boolean,).join(' ',),
}),)
vi.mock('../../../util/infra/logging', () => ({
	default: () => ({error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn(),}),
}),)
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

import {CommentExtras, CommentVote,} from './CommentActions'

const roots: Root[] = []

/** Builds a comment with a native vote host (up/down buttons in its shadow) and a reply button. */
function makeComment ({score = '8', voteState = 'NONE', withVote = true,} = {},): {
	comment: Element
	up?: HTMLElement
	down?: HTMLElement
	reply: HTMLElement
} {
	const wrap = document.createElement('div',)
	wrap.innerHTML = `
		<shreddit-comment thingid="t1_c" score="${score}">
			<div slot="actionRow">
				<shreddit-comment-action-row comment-id="t1_c" score="${score}" vote-state="${voteState}">
					${withVote ? '<shreddit-vote-animations></shreddit-vote-animations>' : ''}
					<span slot="comment-reply"><button data-testid="reply">Reply</button></span>
				</shreddit-comment-action-row>
			</div>
		</shreddit-comment>
	`
	document.body.appendChild(wrap,)
	const comment = wrap.querySelector('shreddit-comment',)!
	const result: {comment: Element; up?: HTMLElement; down?: HTMLElement; reply: HTMLElement} = {
		comment,
		reply: comment.querySelector('[data-testid="reply"]',)!,
	}
	if (withVote) {
		const shadow = comment.querySelector('shreddit-vote-animations',)!.attachShadow({mode: 'open',},)
		shadow.innerHTML = '<button upvote></button><button downvote></button>'
		result.up = shadow.querySelector('button[upvote]',)!
		result.down = shadow.querySelector('button[downvote]',)!
	}
	return result
}

/** Renders an element into a fresh root and flushes effects. */
async function render (node: ReactElement,) {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)
	await act(async () => {
		root.render(node,)
	},)
	return host
}

/** Finds the action link whose text matches `label`. */
function buttonByText (host: HTMLElement, label: string,): HTMLAnchorElement | undefined {
	return Array.from(host.querySelectorAll('a',),).find((a,) => a.textContent === label)
}

/** Clicks an element inside act() so state updates flush. */
async function click (el: Element | undefined,) {
	expect(el,).toBeTruthy()
	await act(async () => {
		el!.dispatchEvent(new MouseEvent('click', {bubbles: true,},),)
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

describe('CommentVote', () => {
	it('renders the arrows and initial score', async () => {
		const {comment,} = makeComment()
		const host = await render(<CommentVote comment={comment} />,)
		expect(buttonByText(host, '▲',),).toBeTruthy()
		expect(buttonByText(host, '▼',),).toBeTruthy()
		expect(host.querySelector('.toolbox-comment-score',)?.textContent,).toBe('8',)
	})

	it('upvotes by clicking the native button and bumps the score optimistically', async () => {
		const {comment, up,} = makeComment()
		const upClick = vi.fn()
		up!.addEventListener('click', upClick,)
		const host = await render(<CommentVote comment={comment} />,)
		await click(buttonByText(host, '▲',),)
		expect(upClick,).toHaveBeenCalledTimes(1,)
		expect(host.querySelector('.toolbox-comment-score',)?.textContent,).toBe('9',)
	})

	it('reverts the optimistic score and reveals the native row when no native vote control is found', async () => {
		const {comment,} = makeComment({withVote: false,},)
		const host = await render(<CommentVote comment={comment} />,)
		await click(buttonByText(host, '▲',),)
		expect(host.querySelector('.toolbox-comment-score',)?.textContent,).toBe('8',)
		// Degrade visibly rather than silently: reveal Reddit's own row so the user can still vote.
		expect(comment.classList.contains('toolbox-native-row-expanded',),).toBe(true,)
	})

	it('re-syncs the score and arrow when Reddit updates the native attributes', async () => {
		const {comment,} = makeComment()
		const host = await render(<CommentVote comment={comment} />,)
		expect(host.querySelector('.toolbox-comment-score',)?.textContent,).toBe('8',)
		// Reddit updates the authoritative score / vote-state on the action row (e.g. after the vote
		// settles, or a concurrent change); our display must follow it rather than stay on the seed.
		const actionRow = comment.querySelector('shreddit-comment-action-row',)!
		await act(async () => {
			actionRow.setAttribute('score', '42',)
			actionRow.setAttribute('vote-state', 'UP',)
			await new Promise((resolve,) => setTimeout(resolve, 0,))
		},)
		expect(host.querySelector('.toolbox-comment-score',)?.textContent,).toBe('42',)
		expect(buttonByText(host, '▲',)?.getAttribute('aria-pressed',),).toBe('true',)
	})
})

describe('CommentExtras', () => {
	it('renders Reply and the ⋯ toggle (no Report/Share)', async () => {
		const {comment,} = makeComment()
		const host = await render(<CommentExtras comment={comment} />,)
		expect(buttonByText(host, 'Reply',),).toBeTruthy()
		expect(buttonByText(host, '⋯',),).toBeTruthy()
		expect(buttonByText(host, 'Report',),).toBeFalsy()
		expect(buttonByText(host, 'Share',),).toBeFalsy()
	})

	it('Reply expands the native row and clicks the native reply control', async () => {
		const {comment, reply,} = makeComment()
		const replyClick = vi.fn()
		reply.addEventListener('click', replyClick,)
		const host = await render(<CommentExtras comment={comment} />,)
		await click(buttonByText(host, 'Reply',),)
		expect(comment.classList.contains('toolbox-native-row-expanded',),).toBe(true,)
		expect(replyClick,).toHaveBeenCalled()
	})

	it('toggles the native row from the ⋯ button', async () => {
		const {comment,} = makeComment()
		const host = await render(<CommentExtras comment={comment} />,)
		await click(buttonByText(host, '⋯',),)
		expect(comment.classList.contains('toolbox-native-row-expanded',),).toBe(true,)
		await click(buttonByText(host, '⋯',),)
		expect(comment.classList.contains('toolbox-native-row-expanded',),).toBe(false,)
	})

	it('stops the ⋯ click from bubbling to the post overlay', async () => {
		const {comment,} = makeComment()
		const host = await render(<CommentExtras comment={comment} />,)
		const docClick = vi.fn()
		document.addEventListener('click', docClick,)
		await click(buttonByText(host, '⋯',),)
		document.removeEventListener('click', docClick,)
		expect(docClick,).not.toHaveBeenCalled()
	})
})
