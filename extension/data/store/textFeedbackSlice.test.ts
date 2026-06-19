/** Tests for textFeedbackSlice. */

import {combineReducers, configureStore, createListenerMiddleware,} from '@reduxjs/toolkit'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

import reducer, {clearTextFeedback, showTextFeedback, TextFeedbackKind,} from './textFeedbackSlice'

/** Creates a test store that mirrors the listenerMiddleware setup in store/index.ts. */
function makeStore () {
	const listenerMiddleware = createListenerMiddleware()
	const store = configureStore({
		reducer: combineReducers({textFeedback: reducer,},),
		middleware: (getDefaultMiddleware,) => getDefaultMiddleware().prepend(listenerMiddleware.middleware,),
	},)
	listenerMiddleware.startListening({
		actionCreator: showTextFeedback,
		effect: async (action, listenerApi,) => {
			listenerApi.cancelActiveListeners()
			await listenerApi.delay(action.payload.duration ?? 3000,)
			listenerApi.dispatch(clearTextFeedback(),)
		},
	},)
	return store
}

describe('textFeedbackSlice', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	},)

	afterEach(() => {
		vi.useRealTimers()
	},)

	it('shows feedback immediately and clears it after the duration', async () => {
		const store = makeStore()

		store.dispatch(showTextFeedback({
			message: 'Saved',
			kind: TextFeedbackKind.Positive,
			duration: 1000,
		},),)

		expect(store.getState().textFeedback.current,).toEqual({
			message: 'Saved',
			kind: TextFeedbackKind.Positive,
		},)

		await vi.advanceTimersByTimeAsync(1000,)

		expect(store.getState().textFeedback.current,).toBeNull()
	})

	it('cancels the previous clear timeout when showing a new message', async () => {
		const store = makeStore()

		store.dispatch(showTextFeedback({
			message: 'First',
			kind: TextFeedbackKind.Neutral,
			duration: 1000,
		},),)
		await vi.advanceTimersByTimeAsync(500,)

		store.dispatch(showTextFeedback({
			message: 'Second',
			kind: TextFeedbackKind.Negative,
			duration: 1000,
		},),)
		await vi.advanceTimersByTimeAsync(500,)

		expect(store.getState().textFeedback.current?.message,).toBe('Second',)

		await vi.advanceTimersByTimeAsync(500,)

		expect(store.getState().textFeedback.current,).toBeNull()
	})
})
