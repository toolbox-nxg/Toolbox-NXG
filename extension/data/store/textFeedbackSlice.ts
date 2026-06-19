/**
 * Redux slice for transient text feedback messages (toasts).
 * State shape: `{ current }` - the currently visible message, or null when none is shown.
 * Auto-dismiss timing is handled by a listenerMiddleware effect in store/index.ts.
 */

import {createSlice, type PayloadAction,} from '@reduxjs/toolkit'

/** Visual kind of a text feedback message. */
export enum TextFeedbackKind {
	Neutral = 'neutral',
	Positive = 'positive',
	Negative = 'negative',
}

/** A transient text-feedback message shown to the user. */
export interface TextFeedback {
	message: string
	kind: TextFeedbackKind
}

/** Payload for the showTextFeedback action. */
export interface ShowTextFeedbackPayload extends TextFeedback {
	/** How long (ms) to show the message before auto-dismissing. Defaults to 3000. */
	duration?: number
}

interface TextFeedbackState {
	current: TextFeedback | null
}

export const textFeedbackSlice = createSlice({
	name: 'textFeedback',
	initialState: {
		current: null,
	} as TextFeedbackState,
	reducers: {
		/**
		 * Shows a text feedback message. The `duration` field is read by the
		 * listenerMiddleware effect in index.ts and is not stored in Redux state.
		 */
		showTextFeedback (state, action: PayloadAction<ShowTextFeedbackPayload>,) {
			state.current = {
				message: action.payload.message,
				kind: action.payload.kind,
			}
		},
		/** Clears the currently displayed text feedback message. */
		clearTextFeedback (state,) {
			state.current = null
		},
	},
},)
export default textFeedbackSlice.reducer
export const {showTextFeedback, clearTextFeedback,} = textFeedbackSlice.actions
