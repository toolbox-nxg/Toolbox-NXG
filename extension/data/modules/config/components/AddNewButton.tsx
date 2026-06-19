/** A primary button that can be disabled from outside React via a ref, used to add items to a list. */
import {useEffect, useState,} from 'react'

import {ActionButton,} from '../../../shared/controls/ActionButton'
import {Icon,} from '../../../shared/controls/Icon'

/** Ref-based callback slot for triggering an action imperatively from outside React. */
type TriggerRef = {current: (() => void) | null}
/** Ref-based callback slot for controlling a button's disabled state from outside React. */
type DisabledRef = {current: ((disabled: boolean,) => void) | null}

/** Props for the AddNewButton component. */
interface Props {
	/** Label text shown on the button. */
	label: string
	/** Ref assigned by the parent; calling `triggerRef.current()` triggers the add action. */
	triggerRef: TriggerRef
	/** Ref written by this component so the parent can toggle the disabled state. */
	disabledRef: DisabledRef
}

/**
 * Renders a primary "add" button with a circle-plus icon.
 * Exposes a `disabledRef` so the parent can disable the button while an async add is pending,
 * and a `triggerRef` so the parent can invoke the add action imperatively.
 */
export function AddNewButton ({label, triggerRef, disabledRef,}: Props,) {
	const [disabled, setDisabled,] = useState(false,)
	useEffect(() => {
		disabledRef.current = setDisabled
		return () => {
			disabledRef.current = null
		}
	}, [],)
	return (
		<ActionButton primary disabled={disabled} type="button" onClick={() => triggerRef.current?.()}>
			<Icon icon="addCircle" />
			{label}
			{disabled ? ' (Pending)' : ''}
		</ActionButton>
	)
}
