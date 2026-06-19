/** Styled select element matching the ActionButton visual style. */

import {type ComponentPropsWithRef,} from 'react'
import {classes,} from '../../util/ui/reactMount'
import css from './ActionSelect.module.css'

/**
 * Renders a styled `<select>` with an optional inline variant.
 * @param inline When true, renders as an inline-sized select.
 */
export const ActionSelect = ({
	inline,
	className,
	...props
}: ComponentPropsWithRef<'select'> & {
	inline?: boolean
},) => (
	<select
		className={classes(
			css.actionSelect,
			inline && css.inline,
			className,
		)}
		{...props}
	/>
)
