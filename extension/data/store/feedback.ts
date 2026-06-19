/** Convenience functions for dispatching transient text feedback messages to the Redux store. */

import store from '.'
import {showTextFeedback, TextFeedbackKind,} from './textFeedbackSlice'

/** Options for text feedback display. */
interface FeedbackOptions {
	/** How long (ms) to show the message before auto-dismissing. Defaults to 3000. */
	duration?: number
}

/**
 * Dispatches a text feedback message with the given kind.
 * @param kind Visual style of the message.
 * @param message Text to display.
 * @param options Optional display options.
 */
function dispatchTextFeedback (kind: TextFeedbackKind, message: string, options?: FeedbackOptions,) {
	store.dispatch(
		showTextFeedback({
			message,
			kind,
			...(options?.duration !== undefined && {duration: options.duration,}),
		},),
	)
}

/** Displays a success-style text feedback message. */
export function positiveTextFeedback (message: string, options?: FeedbackOptions,) {
	dispatchTextFeedback(TextFeedbackKind.Positive, message, options,)
}

/** Displays an error-style text feedback message. */
export function negativeTextFeedback (message: string, options?: FeedbackOptions,) {
	dispatchTextFeedback(TextFeedbackKind.Negative, message, options,)
}

/** Displays a neutral/informational text feedback message. */
export function neutralTextFeedback (message: string, options?: FeedbackOptions,) {
	dispatchTextFeedback(TextFeedbackKind.Neutral, message, options,)
}
