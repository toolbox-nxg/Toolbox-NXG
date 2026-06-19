/** Button that opens the API info popup for a given UI location context. */
import {type UILocationContext,} from '../../../dom/uiLocations'
import {AuthorButton,} from '../../../shared/controls/AuthorButton'
import {GeneralButton,} from '../../../shared/controls/GeneralButton'
import {showApiInfoPopup,} from './ApiInfoPopup'

/** Props for the ApiInfoButton component. */
interface ApiInfoButtonProps {
	/** The API context to display when clicked. */
	context: UILocationContext
	/** Renders as an AuthorButton when true, otherwise a GeneralButton. */
	author?: boolean
	className?: string
}

/**
 * A button that, when clicked, opens the API info popup positioned near the click target.
 * Positions the popup to the left of the click when close to the right edge of the viewport.
 */
export function ApiInfoButton ({context, author = false, className,}: ApiInfoButtonProps,) {
	const handleClick = (event: React.MouseEvent<HTMLElement>,) => {
		const x = event.pageX
		const leftPosition = document.documentElement.clientWidth - x < 400 ? x - 600 : x - 50
		showApiInfoPopup({
			info: context,
			initialPosition: {top: event.pageY - 10, left: leftPosition,},
		},)
	}

	const Button = author ? AuthorButton : GeneralButton
	return (
		<Button type="button" className={className} onClick={handleClick}>
			api info
		</Button>
	)
}
