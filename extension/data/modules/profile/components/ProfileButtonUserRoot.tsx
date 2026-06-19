/** Bracket-style button placed next to a username that opens the Toolbox profile overlay for that user. */
import {AuthorButton,} from '../../../shared/controls/AuthorButton'
import {GeneralButton,} from '../../../shared/controls/GeneralButton'
import {showProfileOverlay,} from './ProfileOverlay'
import {type ProfileListing,} from './ProfileOverlay.helpers'

/** Props for the ProfileButtonUserRoot component. */
interface ProfileButtonUserRootProps {
	/** Reddit username whose profile will be opened. */
	user: string
	/** Subreddit context used as the initial search filter in the overlay. */
	subreddit: string
	/** Which listing tab to open initially. */
	listing: ProfileListing
	/** Whether to apply per-subreddit color accents inside the overlay. */
	subredditColor: boolean
	/** Text displayed inside the button. */
	label?: string
	/** Whether to render using the compact author-row button style. */
	author?: boolean
	className?: string
	/** Tooltip shown on hover. */
	title?: string
}

/** Renders a button that opens the Toolbox profile overlay when clicked. */
export function ProfileButtonUserRoot ({
	user,
	subreddit,
	listing,
	subredditColor,
	label = 'P',
	author = false,
	className,
	title = 'view & filter user\'s profile in Toolbox-NXG overlay',
}: ProfileButtonUserRootProps,) {
	function handleClick (e: React.MouseEvent<HTMLButtonElement>,) {
		e.preventDefault()
		e.stopPropagation()
		showProfileOverlay({
			user,
			initialListing: listing,
			initialOptions: {sort: 'new', subreddit,},
			subredditColor,
		},)
	}

	const Button = author ? AuthorButton : GeneralButton
	return (
		<Button type="button" className={className} title={title} onClick={handleClick}>
			{label}
		</Button>
	)
}
