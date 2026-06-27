/** Tests for the inline Shreddit mod-action row (FlatListModActions). */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

// All actions route through the proposals gateway; mock it (the real module pulls in the wiki
// transport + webextension polyfill, which throws outside a browser). Same reason for modSubs,
// store/feedback, reactMount, logging, and the history popup (which transitively loads Window).
const isModSub = vi.hoisted(() => vi.fn())
const getCurrentUser = vi.hoisted(() => vi.fn())
const positiveTextFeedback = vi.hoisted(() => vi.fn())
const openRemovalReasonOverlay = vi.hoisted(() => vi.fn())
const proposeOrApprove = vi.hoisted(() => vi.fn())
const proposeOrLock = vi.hoisted(() => vi.fn())
const proposeOrUnlock = vi.hoisted(() => vi.fn())
const proposeOrDistinguish = vi.hoisted(() => vi.fn())
const proposeOrSticky = vi.hoisted(() => vi.fn())
const proposeOrUnsticky = vi.hoisted(() => vi.fn())
const proposeOrMarkNsfw = vi.hoisted(() => vi.fn())

vi.mock('../../../api/resources/modSubs', () => ({isModSub,}),)
vi.mock('../../../api/resources/me', () => ({getCurrentUser,}),)
vi.mock('../../../store/feedback', () => ({positiveTextFeedback,}),)
vi.mock('../../removalreasons/overlayOpener', () => ({openRemovalReasonOverlay,}),)
vi.mock('../../shared/proposals/gateway', () => ({
	proposeOrApprove,
	proposeOrLock,
	proposeOrUnlock,
	proposeOrDistinguish,
	proposeOrSticky,
	proposeOrUnsticky,
	proposeOrMarkNsfw,
}),)
vi.mock('../../../util/ui/reactMount', () => ({
	classes: (...stuff: unknown[]) => stuff.flat().filter(Boolean,).join(' ',),
}),)
vi.mock('../../../util/infra/logging', () => ({
	default: () => ({error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn(),}),
}),)
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

import {FlatListModActions, type FlatListModActionsProps,} from './FlatListModActions'

const roots: Root[] = []

/** Default props for a post; override per test. */
function postProps (over: Partial<FlatListModActionsProps> = {},): FlatListModActionsProps {
	return {subreddit: 'sub', itemId: 't3_x', itemKind: 'post', isRemoved: false, link: '/r/sub/x/', ...over,}
}

/** Default props for a comment; defaults to the viewer's own comment (author === current user). */
function commentProps (over: Partial<FlatListModActionsProps> = {},): FlatListModActionsProps {
	return {
		subreddit: 'sub',
		itemId: 't1_y',
		itemKind: 'comment',
		isRemoved: false,
		link: '/r/sub/x/y/',
		author: 'me',
		...over,
	}
}

/** Renders the row and flushes the isMod effect + any pending promises. */
async function render (props: FlatListModActionsProps,) {
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	const root = createRoot(host,)
	roots.push(root,)
	await act(async () => {
		root.render(<FlatListModActions {...props} />,)
	},)
	return host
}

/** Finds the action link whose text matches `label`. */
function buttonByText (host: HTMLElement, label: string,): HTMLAnchorElement | undefined {
	return Array.from(host.querySelectorAll('a',),).find((a,) => a.textContent === label)
}

/** Clicks the given element inside an act() so state updates flush. */
async function click (el: Element | undefined,) {
	expect(el,).toBeTruthy()
	await act(async () => {
		el!.dispatchEvent(new MouseEvent('click', {bubbles: true,},),)
	},)
}

beforeEach(() => {
	vi.clearAllMocks()
	isModSub.mockResolvedValue(true,)
	getCurrentUser.mockResolvedValue('me',)
	for (
		const fn of [
			proposeOrApprove,
			proposeOrLock,
			proposeOrUnlock,
			proposeOrDistinguish,
			proposeOrSticky,
			proposeOrUnsticky,
			proposeOrMarkNsfw,
		]
	) {
		fn.mockResolvedValue('performed',)
	}
},)

afterEach(() => {
	roots.forEach((root,) => act(() => root.unmount()))
	roots.length = 0
	document.body.innerHTML = ''
},)

describe('FlatListModActions', () => {
	it('renders nothing for non-moderators', async () => {
		isModSub.mockResolvedValue(false,)
		const host = await render(postProps(),)
		expect(host.textContent,).toBe('',)
	})

	it('shows the post action set (no Distinguish, Approve always shown)', async () => {
		const host = await render(postProps(),)
		expect(buttonByText(host, 'Spam',),).toBeTruthy()
		expect(buttonByText(host, 'Remove',),).toBeTruthy()
		expect(buttonByText(host, 'Lock',),).toBeTruthy()
		expect(buttonByText(host, 'Sticky',),).toBeTruthy()
		expect(buttonByText(host, 'Mark NSFW',),).toBeTruthy()
		expect(buttonByText(host, 'Distinguish',),).toBeFalsy()
		expect(buttonByText(host, 'Approve',),).toBeTruthy()
	})

	it('renders Spam immediately before Remove', async () => {
		const host = await render(postProps(),)
		const labels = Array.from(host.querySelectorAll('a',),).map((a,) => a.textContent)
		const spam = labels.indexOf('Spam',)
		const remove = labels.indexOf('Remove',)
		expect(spam,).toBeGreaterThanOrEqual(0,)
		expect(remove,).toBe(spam + 1,)
	})

	it('routes the Toolbox Remove through the removalreasons document handler (class + data attrs)', async () => {
		const host = await render(postProps(),)
		const removeButton = buttonByText(host, 'Remove',)!
		expect(removeButton.classList.contains('toolbox-removal-reason-remove',),).toBe(true,)
		expect(removeButton.dataset.id,).toBe('t3_x',)
		expect(removeButton.dataset.subreddit,).toBe('sub',)
	})

	it('shows Distinguish on the viewer\'s own comment and hides post-only actions', async () => {
		const host = await render(commentProps(),)
		expect(buttonByText(host, 'Distinguish',),).toBeTruthy()
		expect(buttonByText(host, 'Lock',),).toBeTruthy()
		expect(buttonByText(host, 'Sticky',),).toBeFalsy()
		expect(buttonByText(host, 'Mark NSFW',),).toBeFalsy()
	})

	it('hides Distinguish on another user\'s comment', async () => {
		const host = await render(commentProps({author: 'someone-else',},),)
		expect(buttonByText(host, 'Distinguish',),).toBeFalsy()
		// The rest of the comment row still renders.
		expect(buttonByText(host, 'Spam',),).toBeTruthy()
		expect(buttonByText(host, 'Lock',),).toBeTruthy()
	})

	it('matches the author case-insensitively for Distinguish', async () => {
		getCurrentUser.mockResolvedValue('Me',)
		const host = await render(commentProps({author: 'me',},),)
		expect(buttonByText(host, 'Distinguish',),).toBeTruthy()
	})

	it('hides Spam and Remove when the item is already removed', async () => {
		const host = await render(postProps({isRemoved: true,},),)
		expect(buttonByText(host, 'Spam',),).toBeFalsy()
		expect(buttonByText(host, 'Remove',),).toBeFalsy()
		expect(buttonByText(host, 'Lock',),).toBeTruthy()
	})

	it('approves a removed comment through the gateway and swaps Spam/Remove back in', async () => {
		const host = await render(commentProps({isRemoved: true,},),)
		await click(buttonByText(host, 'Approve',),)
		expect(proposeOrApprove,).toHaveBeenCalledWith(
			expect.objectContaining({subreddit: 'sub', itemId: 't1_y', itemKind: 'comment',},),
		)
		// A real approve flips the row back to not-removed: Spam/Remove return; Approve stays shown.
		expect(buttonByText(host, 'Approve',),).toBeTruthy()
		expect(buttonByText(host, 'Spam',),).toBeTruthy()
		expect(buttonByText(host, 'Remove',),).toBeTruthy()
	})

	it('keeps Spam hidden when the approve is only captured for review', async () => {
		proposeOrApprove.mockResolvedValueOnce('captured',)
		const host = await render(commentProps({isRemoved: true,},),)
		await click(buttonByText(host, 'Approve',),)
		// Captured (trainee): nothing was actually approved, so the row stays removed.
		expect(positiveTextFeedback,).toHaveBeenCalled()
		expect(buttonByText(host, 'Approve',),).toBeTruthy()
		expect(buttonByText(host, 'Spam',),).toBeFalsy()
	})

	it('shows Approve on every item, removed or not', async () => {
		// Removed comment: shown.
		expect(buttonByText(await render(commentProps({isRemoved: true,},),), 'Approve',),).toBeTruthy()
		// Removed post: shown.
		expect(buttonByText(await render(postProps({isRemoved: true,},),), 'Approve',),).toBeTruthy()
		// Non-removed comment: shown (the native approve is hidden by CSS, Toolbox renders its own).
		expect(buttonByText(await render(commentProps(),), 'Approve',),).toBeTruthy()
		// Non-removed post: shown.
		expect(buttonByText(await render(postProps(),), 'Approve',),).toBeTruthy()
	})

	it('approves a removed post through the gateway and swaps Spam/Remove back in', async () => {
		const host = await render(postProps({isRemoved: true,},),)
		await click(buttonByText(host, 'Approve',),)
		expect(proposeOrApprove,).toHaveBeenCalledWith(
			expect.objectContaining({subreddit: 'sub', itemId: 't3_x', itemKind: 'post',},),
		)
		expect(buttonByText(host, 'Approve',),).toBeTruthy()
		expect(buttonByText(host, 'Spam',),).toBeTruthy()
		expect(buttonByText(host, 'Remove',),).toBeTruthy()
	})

	it('opens the removal overlay (as spam) from the Spam button', async () => {
		const host = await render(postProps(),)
		await click(buttonByText(host, 'Spam',),)
		expect(openRemovalReasonOverlay,).toHaveBeenCalledWith({
			thingID: 't3_x',
			thingSubreddit: 'sub',
			isComment: false,
			spam: true,
		},)
	})

	it('opens the removal overlay as a comment removal on comments', async () => {
		const host = await render(commentProps(),)
		await click(buttonByText(host, 'Spam',),)
		expect(openRemovalReasonOverlay,).toHaveBeenCalledWith(
			expect.objectContaining({thingID: 't1_y', isComment: true, spam: true,},),
		)
	})

	it('keeps the label and shows feedback when the action is captured', async () => {
		proposeOrLock.mockResolvedValue('captured',)
		const host = await render(postProps(),)
		await click(buttonByText(host, 'Lock',),)
		expect(positiveTextFeedback,).toHaveBeenCalled()
		expect(buttonByText(host, 'Lock',),).toBeTruthy()
		expect(buttonByText(host, 'Unlock',),).toBeFalsy()
	})

	it('flips Lock to Unlock after a real lock', async () => {
		const host = await render(postProps(),)
		await click(buttonByText(host, 'Lock',),)
		expect(proposeOrLock,).toHaveBeenCalled()
		expect(buttonByText(host, 'Unlock',),).toBeTruthy()
	})

	it('starts on "Unmark NSFW" for an NSFW post and unmarks via the gateway', async () => {
		const host = await render(postProps({initialNsfw: true,},),)
		const button = buttonByText(host, 'Unmark NSFW',)
		expect(button,).toBeTruthy()
		await click(button,)
		expect(proposeOrMarkNsfw,).toHaveBeenCalledWith(expect.objectContaining({itemId: 't3_x',},), false,)
	})

	it('starts on "Unlock" for an already-locked item (seeded from the DOM)', async () => {
		const host = await render(postProps({initialLocked: true,},),)
		expect(buttonByText(host, 'Unlock',),).toBeTruthy()
		expect(buttonByText(host, 'Lock',),).toBeFalsy()
	})

	it('starts on "Unsticky" for an already-stickied post (seeded from the DOM)', async () => {
		const host = await render(postProps({initialStickied: true,},),)
		expect(buttonByText(host, 'Unsticky',),).toBeTruthy()
		expect(buttonByText(host, 'Sticky',),).toBeFalsy()
	})

	it('shows an error label when the action rejects', async () => {
		proposeOrLock.mockRejectedValueOnce(new Error('boom',),)
		const host = await render(postProps(),)
		await click(buttonByText(host, 'Lock',),)
		expect(host.textContent,).toContain('Lock failed',)
	})

	it('stops the click from bubbling to the post overlay', async () => {
		const host = await render(postProps(),)
		const docClick = vi.fn()
		document.addEventListener('click', docClick,)
		await click(buttonByText(host, 'Lock',),)
		document.removeEventListener('click', docClick,)
		expect(docClick,).not.toHaveBeenCalled()
	})
})
