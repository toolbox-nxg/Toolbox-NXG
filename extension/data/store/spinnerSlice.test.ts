/** Tests for spinnerSlice. */

import {describe, expect, it,} from 'vitest'

import reducer, {resetSpinner, startSpinner, stopSpinner,} from './spinnerSlice'

describe('spinnerSlice', () => {
	it('increments, decrements, and resets the spinner count', () => {
		let state = reducer(undefined, startSpinner(),)
		state = reducer(state, startSpinner(),)
		expect(state.count,).toBe(2,)

		state = reducer(state, stopSpinner(),)
		expect(state.count,).toBe(1,)

		state = reducer(state, resetSpinner(),)
		expect(state.count,).toBe(0,)
	})

	it('does not decrement below zero', () => {
		expect(reducer(undefined, stopSpinner(),).count,).toBe(0,)
	})
})
