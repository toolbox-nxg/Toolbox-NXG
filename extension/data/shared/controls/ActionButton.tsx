/** Styled action button used throughout Toolbox dialogs and toolbars. */

import {type ComponentPropsWithRef,} from 'react'
import {classes,} from '../../util/ui/reactMount'
import css from './ActionButton.module.css'

/**
 * Renders a styled `<button>` with optional inline and primary variants.
 * @param props Component properties.
 * @param props.inline When true, renders as an inline-sized button.
 * @param props.primary When true, applies the primary (highlighted) style.
 * @param props.busy When true, shows a leading spinner and forces the button
 *   disabled (an in-flight action shouldn't be re-triggered).
 */
export const ActionButton = ({
	inline,
	primary,
	busy,
	className,
	disabled,
	children,
	...props
}: ComponentPropsWithRef<'button'> & {
	inline?: boolean
	primary?: boolean
	busy?: boolean
},) => (
	<button
		className={classes(
			css.actionButton,
			inline && css.inline,
			primary && css.primary,
			className,
		)}
		disabled={disabled || busy}
		{...props}
	>
		{busy && <span className={css.spinner} aria-hidden="true" />}
		{children}
	</button>
)
