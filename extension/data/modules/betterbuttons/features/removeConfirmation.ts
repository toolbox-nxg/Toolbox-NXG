/** Bypasses the remove/approve confirmation dialogs so moderators can act in a single click. */
import {removalReasons,} from '../../../framework/moduleIds'
import createLogger from '../../../util/infra/logging'
import {getSettingAsync,} from '../../../util/persistence/settings'

const log = createLogger('BButtons',)

/**
 * Creates handlers that skip the remove/approve confirmation step.
 * @returns An object containing `handleApproveClick` and `handleRemoveClick`.
 */
export function createRemoveConfirmationHandlers () {
	log.debug('Adding one-click remove events',)

	return {
		/**
		 * Immediately confirms an approve action without waiting for user confirmation.
		 * @param element The approve toggle button that was clicked.
		 */
		handleApproveClick (element: Element,) {
			const yes = element.closest('.approve-button',)?.querySelector<HTMLElement>('.yes',)
			if (yes) {
				yes.click()
			}
		},
		/**
		 * Immediately confirms a remove action, unless the removal-reasons module is active and
		 * comment reasons are enabled (in which case the reasons dialog handles its own flow).
		 * Spam removals always bypass the confirmation regardless.
		 * @param element The remove toggle button that was clicked.
		 */
		async handleRemoveClick (element: Element,) {
			const button = element.closest('.remove-button',)
			const yes = button?.querySelector<HTMLElement>('.yes',)

			// getAttribute('value') may return null, but null === 'spammed' is false, which is the
			// correct behavior (null means not-spam, so the condition falls through to the other
			// branches rather than bypassing the dialog).
			if (
				!document.body.classList.contains('toolbox-removal-reasons',)
				|| !await getSettingAsync(removalReasons, 'commentReasons',)
				|| button?.firstElementChild?.getAttribute('value',) === 'spammed'
			) {
				if (yes) {
					yes.click()
				}
			}
		},
	}
}
