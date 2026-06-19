/** Shared button-interaction utilities for Better Buttons features. */

/**
 * Clicks a mod-action button only if it has not already been pressed.
 * @param button The button element to click, or null/undefined to no-op.
 */
export function clickIfNotPressed (button: HTMLElement | null | undefined,) {
	if (button && !button.classList.contains('pressed',)) {
		button.click()
	}
}
