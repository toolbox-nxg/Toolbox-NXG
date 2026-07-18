/** Tests for the ModActions module's thingFlatListActions renderer (createModActionsSlot). */

import type {ReactElement,} from 'react'
import {beforeEach, describe, expect, it, vi,} from 'vitest'

// Capture the registered renderer instead of touching the real (polyfill-loading) uiLocations,
// and stub the component so the renderer's own guard/plumbing logic is what's under test.
const renderAtLocation = vi.hoisted(() => vi.fn())
vi.mock('../../dom/uiLocations', () => ({renderAtLocation,}),)
vi.mock('./components/FlatListModActions', () => ({FlatListModActions: () => null,}),)

import {FlatListModActions,} from './components/FlatListModActions'
import {createModActionsSlot,} from './dom'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the renderer's context is loosely typed here.
type RenderFn = (args: {context: any; target: Element},) => ReactElement | null

/** Registers the slot and returns the captured renderer callback. */
function getRenderer (): RenderFn {
	createModActionsSlot()
	return renderAtLocation.mock.calls[0]![2] as RenderFn
}

beforeEach(() => {
	renderAtLocation.mockClear()
},)

describe('createModActionsSlot', () => {
	it('registers a thingFlatListActions renderer with a stable id', () => {
		createModActionsSlot()
		expect(renderAtLocation,).toHaveBeenCalledWith(
			'thingFlatListActions',
			expect.objectContaining({id: 'modactions.row',},),
			expect.any(Function,),
		)
	})

	it('renders nothing without subreddit/thingId', () => {
		const render = getRenderer()
		expect(render({context: {kind: 'post',}, target: document.createElement('span',),},),).toBeNull()
	})

	it('renders nothing for kinds other than post/comment', () => {
		const render = getRenderer()
		const node = render({
			context: {kind: 'user', thingId: 't2_x', subreddit: 'sub',},
			target: document.createElement('span',),
		},)
		expect(node,).toBeNull()
	})

	it('passes a post\'s NSFW / lock / sticky state and permalink read from the element', () => {
		const post = document.createElement('shreddit-post',)
		post.setAttribute('nsfw', '',)
		post.setAttribute('locked', '',)
		post.setAttribute('stickied', '',)
		post.setAttribute('permalink', '/r/sub/comments/x/',)
		const slot = document.createElement('span',)
		post.appendChild(slot,)

		const render = getRenderer()
		const node = render({
			context: {kind: 'post', thingId: 't3_x', subreddit: 'sub', isRemoved: false,},
			target: slot,
		},)
		expect(node,).not.toBeNull()
		expect(node!.type,).toBe(FlatListModActions,)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspect the element's props.
		expect((node as any).props,).toMatchObject({
			subreddit: 'sub',
			itemId: 't3_x',
			itemKind: 'post',
			initialNsfw: true,
			initialLocked: true,
			initialStickied: true,
			link: '/r/sub/comments/x/',
		},)
	})

	it('defaults initialNsfw / initialLocked / initialStickied to false when the attributes are absent', () => {
		const post = document.createElement('shreddit-post',)
		const slot = document.createElement('span',)
		post.appendChild(slot,)

		const render = getRenderer()
		const node = render({
			context: {kind: 'post', thingId: 't3_x', subreddit: 'sub', isRemoved: false,},
			target: slot,
		},)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspect the element's props.
		expect((node as any).props,).toMatchObject({initialNsfw: false, initialLocked: false, initialStickied: false,},)
	})

	it('reads a comment\'s locked state from a `<locked>` badge in its own commentMeta', () => {
		const comment = document.createElement('shreddit-comment',)
		comment.innerHTML =
			'<div slot="commentMeta"><shreddit-comment-badges><locked></locked></shreddit-comment-badges></div>'
		const slot = document.createElement('span',)
		comment.appendChild(slot,)

		const render = getRenderer()
		const node = render({
			context: {kind: 'comment', thingId: 't1_c', subreddit: 'sub', isRemoved: false,},
			target: slot,
		},)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspect the element's props.
		expect((node as any).props.initialLocked,).toBe(true,)
	})

	it('marks a depth-0 comment top-level and a deeper one not (drives the Sticky action)', () => {
		const render = getRenderer()

		const top = document.createElement('shreddit-comment',)
		top.setAttribute('depth', '0',)
		const topSlot = document.createElement('span',)
		top.appendChild(topSlot,)
		const topNode = render({
			context: {kind: 'comment', thingId: 't1_top', subreddit: 'sub', isRemoved: false,},
			target: topSlot,
		},)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspect the element's props.
		expect((topNode as any).props.isTopLevelComment,).toBe(true,)

		const nested = document.createElement('shreddit-comment',)
		nested.setAttribute('depth', '2',)
		const nestedSlot = document.createElement('span',)
		nested.appendChild(nestedSlot,)
		const nestedNode = render({
			context: {kind: 'comment', thingId: 't1_nested', subreddit: 'sub', isRemoved: false,},
			target: nestedSlot,
		},)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspect the element's props.
		expect((nestedNode as any).props.isTopLevelComment,).toBe(false,)
	})

	it('does not mark a comment locked from a nested reply\'s lock badge', () => {
		const comment = document.createElement('shreddit-comment',)
		// The parent's own meta has no lock badge; only a nested reply does.
		comment.innerHTML = '<div slot="commentMeta"><shreddit-comment-badges></shreddit-comment-badges></div>'
			+ '<shreddit-comment><div slot="commentMeta"><shreddit-comment-badges><locked></locked>'
			+ '</shreddit-comment-badges></div></shreddit-comment>'
		const slot = document.createElement('span',)
		comment.insertBefore(slot, comment.firstChild,)

		const render = getRenderer()
		const node = render({
			context: {kind: 'comment', thingId: 't1_parent', subreddit: 'sub', isRemoved: false,},
			target: slot,
		},)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspect the element's props.
		expect((node as any).props.initialLocked,).toBe(false,)
	})
})
