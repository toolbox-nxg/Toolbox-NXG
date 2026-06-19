/** Root component that renders the history button and opens the HistoryPopup when clicked. */
import {AuthorButton,} from '../../../shared/controls/AuthorButton'
import {GeneralButton,} from '../../../shared/controls/GeneralButton'
import {drawPosition,} from '../../../util/ui/drawPosition'
import {showHistoryPopup,} from './HistoryPopup'

/** Props for the HistoryButtonUserRoot component. */
interface HistoryButtonUserRootProps {
	/** The Reddit username whose history will be shown. */
	user: string
	/** The subreddit context, used to highlight the current sub in the popup; null if not on a subreddit page. */
	subreddit: string | null
	/** Button label text; defaults to `'H'`. */
	label?: string
	/** Whether to render using the compact author-row button style. */
	author?: boolean
	className?: string
}

/** Renders a button that opens the user history popup for the given user when clicked. */
export function HistoryButtonUserRoot (
	{user, subreddit, label = 'H', author = false, className,}: HistoryButtonUserRootProps,
) {
	const Button = author ? AuthorButton : GeneralButton

	return (
		<Button
			type="button"
			className={className}
			onClick={(e,) => {
				e.preventDefault()
				e.stopPropagation()
				// Dedup is handled by the popup registry (keyed on user): re-clicking any
				// history button for the same user reveals the live popup instead of
				// opening another copy, and recovers it if it was dragged off-screen.
				const {topPosition, leftPosition,} = drawPosition(e.nativeEvent,)
				showHistoryPopup({user, subreddit, initialPosition: {top: topPosition, left: leftPosition,},},)
			}}
			title="view & analyze user's submission and comment history"
		>
			{label}
		</Button>
	)
}
