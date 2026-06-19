/** Numeric input with an optional inline label. */

import {type ComponentPropsWithRef,} from 'react'
import css from './NumberInput.module.css'

/**
 * Renders a styled `<input type="number">` with an optional preceding label.
 * @param label Text shown before the input.
 */
export const NumberInput = ({
	label,
	...props
}: ComponentPropsWithRef<'input'> & {
	label?: string
},) => (
	<span className={css.wrapper}>
		{label && <span className={css.label}>{label}</span>}
		<input type="number" className={css.input} {...props} />
	</span>
)
