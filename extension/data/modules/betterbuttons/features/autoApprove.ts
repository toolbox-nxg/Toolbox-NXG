/** Provides a handler that auto-approves an item when its reports are ignored. */
import createLogger from '../../../util/infra/logging'

import {clickIfNotPressed,} from './buttonUtils'

const log = createLogger('BButtons',)

/**
 * Creates handlers for the auto-approve-on-ignore feature.
 * @returns An object containing `handleIgnoreClick`.
 */
export function createAutoApproveHandlers () {
	return {
		/**
		 * Clicks the approve button when the ignore-reports button is clicked,
		 * if the item has not already been approved.
		 * @param element The ignore-reports button that was clicked.
		 */
		handleIgnoreClick (element: Element,) {
			log.debug('Ignore reports pressed',)
			const approveButton = element.parentElement?.querySelector<HTMLElement>(':scope > span > .positive',)
			if (!approveButton) {
				log.warn('Could not find approve button to auto-approve after ignoring reports',)
				return
			}
			clickIfNotPressed(approveButton,)
		},
	}
}
