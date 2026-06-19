/** Small inline button for Reddit-page action rows. */

import {type ComponentPropsWithRef,} from 'react'
import {classes,} from '../../util/ui/reactMount'
import css from './GeneralInlineButton.module.css'

type GeneralInlineButtonProps = ComponentPropsWithRef<'button'> & {
	/** Whether to stop the click from opening Reddit parent lightboxes. */
	stopPropagation?: boolean
}

/** Renders the compact inline Toolbox button style used inside Reddit page rows. */
export const GeneralInlineButton = ({
	className,
	onClick,
	stopPropagation = true,
	type = 'button',
	...props
}: GeneralInlineButtonProps,) => (
	<button
		type={type}
		className={classes(css.generalInlineButton, className,)}
		onClick={(event,) => {
			if (stopPropagation) { event.stopPropagation() }
			onClick?.(event,)
		}}
		{...props}
	/>
)
