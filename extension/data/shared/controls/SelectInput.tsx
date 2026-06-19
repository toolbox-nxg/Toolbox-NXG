/** Styled select element with consistent Toolbox font and color-scheme. */

import {type ComponentPropsWithRef,} from 'react'
import {classes,} from '../../util/ui/reactMount'
import css from './SelectInput.module.css'

/** Renders a `<select>` with Toolbox font and `color-scheme: none` to prevent browser dark-mode conflicts. */
export const SelectInput = ({
	className,
	...props
}: ComponentPropsWithRef<'select'>,) => (
	<select className={classes(css.select, className,)} {...props} />
)
