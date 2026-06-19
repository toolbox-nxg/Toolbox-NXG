/** Modbar button that opens and closes the Subreddit Notes popup. */
import {useRef, useState,} from 'react'

import {ModbarButton,} from '../../../shared/controls/ModbarButton'
import {postSite,} from '../../../util/reddit/pageContext'
import type {SubredditNotesSettings,} from '../settings'
import {showSubredditNotesPopup,} from './SubredditNotesPopup'

/** Modbar button that toggles the Subreddit Notes popup open and closed. */
export function SubredditNotesButton ({noteWiki, monospace, defaultToCurrentSub,}: SubredditNotesSettings,) {
	const [activated, setActivated,] = useState(false,)
	const closeRef = useRef<(() => void) | null>(null,)

	const handleClick = () => {
		if (closeRef.current) {
			closeRef.current()
			return
		}
		setActivated(true,)
		closeRef.current = showSubredditNotesPopup({
			notewiki: noteWiki,
			monospace,
			defaultToCurrentSub,
			...(postSite ? {currentSubreddit: postSite,} : {}),
			onClose: () => {
				setActivated(false,)
				closeRef.current = null
			},
		},)
	}

	return (
		<ModbarButton
			className={`toolbox-subreddit-notes-button${activated ? ' toolbox-notes-activated' : ''}`}
			onClick={handleClick}
		>
			Subreddit Notes
		</ModbarButton>
	)
}
