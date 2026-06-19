/** Shared delivery-option row used by the removal-reasons overlay and settings panels. */

import {type ReactNode,} from 'react'

import {classes,} from '../../../util/ui/reactMount'

/**
 * Creates a delivery-option row component bound to a CSS module's class names. The returned
 * component renders a row that visually highlights when `selected`, so each panel reuses the
 * shared markup while keeping its own styling.
 * @param baseClass The always-applied row class.
 * @param selectedClass The class applied additionally when the row is selected.
 * @returns A `DeliveryOption` component taking `selected` and `children`.
 */
export function makeDeliveryOption (baseClass: string | undefined, selectedClass: string | undefined,) {
	return function DeliveryOption ({selected, children,}: {selected: boolean; children: ReactNode},) {
		return <div className={classes(baseClass, selected && selectedClass,)}>{children}</div>
	}
}
