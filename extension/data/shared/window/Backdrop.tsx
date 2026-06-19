/** Full-viewport backdrop that closes on outside click or Escape key press. */

import {MouseEvent, ReactNode, useEffect,} from 'react'
import {useEscapeKey,} from '../../util/ui/hooks'
import {classes,} from '../../util/ui/reactMount'
import css from './Backdrop.module.css'

/**
 * Renders a full-viewport dimmed overlay. Calls `onClickOutside` when the user
 * clicks the backdrop area or presses Escape.
 * @param onClickOutside Called when the user dismisses the backdrop.
 */
export const Backdrop = ({
	className,
	onClickOutside,
	children,
}: {
	className?: string | undefined
	onClickOutside?: () => void
	children: ReactNode
},) => {
	const handleBackdropClick = (event: MouseEvent<HTMLDivElement>,) => {
		if (event.target === event.currentTarget) { onClickOutside?.() }
	}

	// Dismiss on Escape; the hook tracks the latest callback via a ref so the
	// listener never needs re-registering when an unstable reference is passed.
	useEscapeKey(onClickOutside,)

	useEffect(() => {
		const prev = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		return () => {
			document.body.style.overflow = prev
		}
	}, [],)

	return (
		<div className={classes(css.backdrop, className,)} onClick={handleBackdropClick}>
			<div className={css.dialog}>
				{children}
			</div>
		</div>
	)
}
