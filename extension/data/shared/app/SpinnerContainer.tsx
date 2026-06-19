/** Global loading spinner shown while one or more async operations are in flight. */

import {useEffect,} from 'react'
import {useSelector,} from 'react-redux'
import {RootState,} from '../../store'
import css from './SpinnerContainer.module.css'

/** Renders a loading indicator when the spinner count in the Redux store is greater than zero. */
export function SpinnerContainer () {
	const visible = useSelector((state: RootState,) => state.spinner.count > 0)

	// While any Toolbox async operation is in flight (spinner visible), guard against accidental
	// navigation away from the page - calling `preventDefault` in a `beforeunload` handler triggers
	// the browser's "leave site?" confirmation. The listener is registered only while the spinner is
	// visible and torn down as soon as it hides (or on unmount), so it never lingers. Because every
	// async caller shares the global spinner counter, this protection applies app-wide.
	useEffect(() => {
		if (!visible) { return }
		const handleBeforeUnload = (event: BeforeUnloadEvent,) => {
			event.preventDefault()
		}
		window.addEventListener('beforeunload', handleBeforeUnload,)
		return () => window.removeEventListener('beforeunload', handleBeforeUnload,)
	}, [visible,],)

	if (!visible) { return null }
	return (
		<div className={css.spinner}>
			<span className={css.dot} />
			<span>Toolbox-NXG Loading Content...</span>
		</div>
	)
}
