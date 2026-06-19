/** Tests for drawPosition. */

import {beforeEach, describe, expect, it,} from 'vitest'

import {drawPosition,} from './drawPosition'

function makeMouseEvent (pageX: number, pageY: number,): MouseEvent {
	const event = new MouseEvent('click',)
	Object.defineProperty(event, 'pageX', {value: pageX,},)
	Object.defineProperty(event, 'pageY', {value: pageY,},)
	return event
}

describe('drawPosition', () => {
	beforeEach(() => {
		Object.defineProperty(window, 'innerWidth', {configurable: true, value: 1000,},)
		Object.defineProperty(window, 'innerHeight', {configurable: true, value: 768,},)
		Object.defineProperty(window, 'scrollX', {configurable: true, value: 0,},)
		Object.defineProperty(window, 'scrollY', {configurable: true, value: 0,},)
	},)

	it('places popups near the cursor when there is room', () => {
		// default 700×500 popup; left=250, top=150 — well within viewport
		expect(drawPosition(makeMouseEvent(300, 200,),),).toEqual({leftPosition: 250, topPosition: 150,},)
	})

	it('clamps to the right edge', () => {
		// cursor at 800; unclamped left=750, max=1000-700-5=295
		expect(drawPosition(makeMouseEvent(800, 200,),),).toEqual({leftPosition: 295, topPosition: 150,},)
	})

	it('clamps to the left edge', () => {
		// cursor at 20; unclamped left=-30, min=5
		expect(drawPosition(makeMouseEvent(20, 200,),),).toEqual({leftPosition: 5, topPosition: 150,},)
	})

	it('clamps to the top edge', () => {
		// cursor at y=20; unclamped top=-30, min=5
		expect(drawPosition(makeMouseEvent(300, 20,),),).toEqual({leftPosition: 250, topPosition: 5,},)
	})

	it('clamps to the bottom edge', () => {
		// cursor at y=700; unclamped top=650, max=768-500-5=263
		expect(drawPosition(makeMouseEvent(300, 700,),),).toEqual({leftPosition: 250, topPosition: 263,},)
	})

	it('respects custom popup dimensions', () => {
		// 400×300 popup; max left=1000-400-5=595, max top=768-300-5=463
		expect(drawPosition(makeMouseEvent(500, 300,), {popupWidth: 400, popupHeight: 300,},),)
			.toEqual({leftPosition: 450, topPosition: 250,},)
	})

	it('accounts for page scroll offset', () => {
		Object.defineProperty(window, 'scrollX', {configurable: true, value: 200,},)
		Object.defineProperty(window, 'scrollY', {configurable: true, value: 100,},)
		// cursor at page (300, 200); viewport window starts at (200, 100)
		// minLeft=205, minTop=105 — cursor offset puts us at (250, 150), both within bounds
		expect(drawPosition(makeMouseEvent(300, 200,),),).toEqual({leftPosition: 250, topPosition: 150,},)
	})

	it('clamps to viewport left edge when scrolled', () => {
		Object.defineProperty(window, 'scrollX', {configurable: true, value: 200,},)
		Object.defineProperty(window, 'scrollY', {configurable: true, value: 0,},)
		// cursor at page x=210 (clientX=10); unclamped left=160, min=205
		expect(drawPosition(makeMouseEvent(210, 200,),),).toEqual({leftPosition: 205, topPosition: 150,},)
	})
})
