/** Standard text input with Toolbox default styling. */

import {type ComponentPropsWithRef,} from 'react'
import {classes,} from '../../util/ui/reactMount'
import css from './NormalInput.module.css'

/**
 * Renders a styled `<input>`.
 * @param inFooter When true, applies footer-specific padding adjustments.
 */
export const TextInput = ({
	inFooter,
	className,
	...props
}: ComponentPropsWithRef<'input'> & {
	inFooter?: boolean
},) => (
	<input
		className={classes(
			css.normalInput,
			inFooter && css.inWindowFooter,
			className,
		)}
		{...props}
	/>
)
