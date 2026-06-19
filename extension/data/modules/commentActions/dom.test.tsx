/** Tests for the CommentActions module's thingFlatListActions renderers (createCommentActionsSlot). */

import type {ReactElement,} from 'react'
import {beforeEach, describe, expect, it, vi,} from 'vitest'

// Capture the registered renderers instead of touching the real (polyfill-loading) uiLocations,
// and stub the components so the renderers' own guard/plumbing logic is what's under test.
const renderAtLocation = vi.hoisted(() => vi.fn(() => () => {}))
vi.mock('../../dom/uiLocations', () => ({renderAtLocation,}),)
vi.mock('./components/CommentActions', () => ({CommentVote: () => null, CommentExtras: () => null,}),)

import {CommentExtras, CommentVote,} from './components/CommentActions'
import {createCommentActionsSlot,} from './dom'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the renderer's context is loosely typed here.
type RenderFn = (args: {context: any; target: Element},) => ReactElement | null

/** Registers the slots and returns the renderer captured for the given id. */
function getRendererById (id: string,): RenderFn {
	createCommentActionsSlot()
	const call = renderAtLocation.mock.calls.find((c,) => (c[1] as {id: string}).id === id)!
	return call[2] as RenderFn
}

beforeEach(() => {
	renderAtLocation.mockClear()
},)

describe('createCommentActionsSlot', () => {
	it('registers vote first (order -10) and extras after the mod row (order 20)', () => {
		createCommentActionsSlot()
		expect(renderAtLocation,).toHaveBeenCalledWith(
			'thingFlatListActions',
			expect.objectContaining({id: 'commentActions.vote', order: -10,},),
			expect.any(Function,),
		)
		expect(renderAtLocation,).toHaveBeenCalledWith(
			'thingFlatListActions',
			expect.objectContaining({id: 'commentActions.extras', order: 20,},),
			expect.any(Function,),
		)
	})

	it('renders nothing for posts', () => {
		const render = getRendererById('commentActions.vote',)
		expect(
			render({
				context: {kind: 'post', thingId: 't3_x', subreddit: 'sub',},
				target: document.createElement('span',),
			},),
		)
			.toBeNull()
	})

	it('renders nothing without a shreddit-comment ancestor', () => {
		const render = getRendererById('commentActions.extras',)
		expect(
			render({
				context: {kind: 'comment', thingId: 't1_x', subreddit: 'sub',},
				target: document.createElement('span',),
			},),
		)
			.toBeNull()
	})

	it('passes the comment element to each piece', () => {
		const comment = document.createElement('shreddit-comment',)
		const slot = document.createElement('span',)
		comment.appendChild(slot,)
		const context = {kind: 'comment', thingId: 't1_c', subreddit: 'sub',}

		const voteNode = getRendererById('commentActions.vote',)({context, target: slot,},)
		expect(voteNode!.type,).toBe(CommentVote,)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspect the element's props.
		expect((voteNode as any).props,).toMatchObject({comment,},)

		const extrasNode = getRendererById('commentActions.extras',)({context, target: slot,},)
		expect(extrasNode!.type,).toBe(CommentExtras,)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspect the element's props.
		expect((extrasNode as any).props,).toMatchObject({comment,},)
	})
})
