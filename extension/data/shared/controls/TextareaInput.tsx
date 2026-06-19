/** Styled textarea with an optional inline label above it. */

import {type ComponentPropsWithRef,} from 'react'
import {classes,} from '../../util/ui/reactMount'
import css from './TextareaInput.module.css'

/**
 * Renders a styled `<textarea>` with an optional label.
 * @param label Text shown above the textarea.
 */
export const TextareaInput = ({
	label,
	className,
	...props
}: ComponentPropsWithRef<'textarea'> & {
	label?: string | undefined
},) => (
	<span className={css.wrapper}>
		{label && <>
			<span className={css.label}>{label}</span>
			<br />
		</>}
		<textarea className={classes(css.textarea, className,)} {...props} />
	</span>
)
