/**
 * Redux slice for the global loading spinner.
 * State shape: `{ count }` - spinner is visible when count > 0.
 * Multiple concurrent callers can each increment/decrement independently.
 */

import {createSlice,} from '@reduxjs/toolkit'

/** State for the spinner slice. */
interface SpinnerState {
	/** Number of concurrent in-flight operations; spinner is shown when this is greater than zero. */
	count: number
}

export const spinnerSlice = createSlice({
	name: 'spinner',
	initialState: {count: 0,} as SpinnerState,
	reducers: {
		startSpinner (state,) {
			state.count++
		},
		stopSpinner (state,) {
			state.count = Math.max(0, state.count - 1,)
		},
		resetSpinner (state,) {
			state.count = 0
		},
	},
},)
export default spinnerSlice.reducer
export const {startSpinner, stopSpinner, resetSpinner,} = spinnerSlice.actions
