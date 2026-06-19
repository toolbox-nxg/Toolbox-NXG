/** Link-style button used in the Toolbox bottom modbar. */

import {type ComponentPropsWithRef,} from 'react'
import {classes,} from '../../util/ui/reactMount'
import css from './ModbarButton.module.css'

/** Renders a modbar item with the shared React-owned modbar style. */
export const ModbarButton = ({className, ...props}: ComponentPropsWithRef<'a'>,) => (
	<a
		className={classes(css.modbarButton, className,)}
		{...props}
	/>
)
