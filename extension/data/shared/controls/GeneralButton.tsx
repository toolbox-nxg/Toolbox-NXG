/** General-purpose button with Toolbox default styling (used in pagers and other non-action contexts). */

import {type ComponentPropsWithRef,} from 'react'
import {classes,} from '../../util/ui/reactMount'
import css from './GeneralButton.module.css'

/** Renders a general-purpose styled `<button>`. */
export const GeneralButton = ({
	className,
	...props
}: ComponentPropsWithRef<'button'>,) => (
	<button
		className={classes(css.generalButton, className,)}
		{...props}
	/>
)
