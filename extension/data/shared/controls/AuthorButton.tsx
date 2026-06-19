/** Tiny button used in author action rows beside Reddit usernames. */

import {type ComponentPropsWithRef,} from 'react'
import {classes,} from '../../util/ui/reactMount'
import css from './AuthorButton.module.css'
import {GeneralButton,} from './GeneralButton'

/** Renders a compact author-line button using the shared GeneralButton base. */
export const AuthorButton = ({className, ...props}: ComponentPropsWithRef<'button'>,) => (
	<GeneralButton
		className={classes(css.authorButton, className,)}
		{...props}
	/>
)
