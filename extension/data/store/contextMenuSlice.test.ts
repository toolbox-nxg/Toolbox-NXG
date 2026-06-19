/** Tests for contextMenuSlice. */

import {describe, expect, it,} from 'vitest'

import reducer, {addItem, clearAttention, removeItem,} from './contextMenuSlice'

describe('contextMenuSlice', () => {
	it('adds items silently by default', () => {
		const state = reducer(undefined, addItem({id: 'one', text: 'One', icon: 'star',},),)

		expect(state.items,).toEqual([{id: 'one', text: 'One', icon: 'star',},],)
		expect(state.attentionId,).toBeNull()
	})

	it('marks the item for attention when attention flag is set', () => {
		const state = reducer(undefined, addItem({id: 'one', text: 'One', icon: 'star', attention: true,},),)

		expect(state.items,).toEqual([{id: 'one', text: 'One', icon: 'star',},],)
		expect(state.attentionId,).toBe('one',)
	})

	it('replaces an item with the same id', () => {
		let state = reducer(undefined, addItem({id: 'one', text: 'One', icon: 'star',},),)
		state = reducer(state, addItem({id: 'one', text: 'Updated', icon: 'check', title: 'Title',},),)

		expect(state.items,).toEqual([{id: 'one', text: 'Updated', icon: 'check', title: 'Title',},],)
		expect(state.attentionId,).toBeNull()
	})

	it('removes items and clears attention for the removed item', () => {
		let state = reducer(undefined, addItem({id: 'one', text: 'One', icon: 'star',},),)
		state = reducer(state, addItem({id: 'two', text: 'Two', icon: 'check',},),)

		state = reducer(state, removeItem('two',),)

		expect(state.items,).toEqual([{id: 'one', text: 'One', icon: 'star',},],)
		expect(state.attentionId,).toBeNull()
	})

	it('sorts items by order, with unordered items at the end in insertion order', () => {
		let state = reducer(undefined, addItem({id: 'c', text: 'C', icon: 'star', order: 30,},),)
		state = reducer(state, addItem({id: 'unordered-1', text: 'U1', icon: 'star',},),)
		state = reducer(state, addItem({id: 'a', text: 'A', icon: 'star', order: 10,},),)
		state = reducer(state, addItem({id: 'unordered-2', text: 'U2', icon: 'star',},),)
		state = reducer(state, addItem({id: 'b', text: 'B', icon: 'star', order: 20,},),)

		expect(state.items.map((i,) => i.id),).toEqual(['a', 'b', 'c', 'unordered-1', 'unordered-2',],)
	})

	it('clears attention without removing items', () => {
		let state = reducer(undefined, addItem({id: 'one', text: 'One', icon: 'star',},),)

		state = reducer(state, clearAttention(),)

		expect(state.items,).toHaveLength(1,)
		expect(state.attentionId,).toBeNull()
	})
})
