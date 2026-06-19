/** Provides a handler that auto-ignores reports when an item is approved. */
import {clickIfNotPressed,} from './buttonUtils'

/**
 * Creates handlers for the auto-ignore-reports-on-approve feature.
 * @returns An object containing `handleApproveClick`.
 */
export function createAutoIgnoreReportsHandlers () {
	return {
		/**
		 * Clicks the ignore-reports button when the approve button is clicked,
		 * if reports have not already been ignored.
		 * @param element The approve button that was clicked.
		 */
		handleApproveClick (element: Element,) {
			clickIfNotPressed(element.closest('.big-mod-buttons',)?.querySelector<HTMLElement>(':scope > .neutral',),)
		},
	}
}
