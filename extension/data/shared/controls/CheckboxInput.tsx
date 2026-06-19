/** Labeled checkbox control that pairs an `<input type="checkbox">` with a visible label. */

import {type ComponentPropsWithRef, type ReactNode,} from 'react'
import {classes,} from '../../util/ui/reactMount'
import css from './CheckboxInput.module.css'

/**
 * Renders a checkbox wrapped in a `<label>`.
 * @param label Content displayed next to the checkbox.
 */
export const CheckboxInput = ({
	label,
	className,
	...props
}: ComponentPropsWithRef<'input'> & {
	label: ReactNode
},) => (
	<label className={css.label}>
		<input
			type="checkbox"
			className={classes(css.toggle, className,)}
			{...props}
		/>{' '}
		{label}
	</label>
)
