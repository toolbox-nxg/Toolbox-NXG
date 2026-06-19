/**
 * Animated container that displays the current transient text feedback message from the Redux store.
 * The message renders as a bottom-centered rounded pill that mirrors the loading spinner
 * (see SpinnerContainer): a leading status dot followed by the message text. The pill is
 * color-coded by kind - grey for neutral progress (with a pulsing dot), green for success,
 * and red for failure.
 */

import {AnimatePresence, motion,} from 'framer-motion'
import {useSelector,} from 'react-redux'
import {RootState,} from '../../store'
import {classes,} from '../../util/ui/reactMount'
import css from './TextFeedbackContainer.module.css'

/** Renders the current text feedback message with a fade-out animation when it is cleared. */
export function TextFeedbackContainer () {
	const currentMessage = useSelector((state: RootState,) => state.textFeedback.current)

	// When the loading spinner is on screen it occupies the same bottom-center slot as the
	// pill, so lift the pill above it to avoid the two overlapping (see SpinnerContainer).
	const spinnerVisible = useSelector((state: RootState,) => state.spinner.count > 0)

	return (
		<AnimatePresence>
			{currentMessage && (
				<motion.div
					className={classes(css.window, spinnerVisible && css.raised, css[currentMessage.kind],)}
					animate={{opacity: 1,}}
					exit={{opacity: 0,}}
				>
					<span className={css.dot} />
					<span className={css.text}>{currentMessage.message}</span>
				</motion.div>
			)}
		</AnimatePresence>
	)
}
