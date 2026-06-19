/** Async wrapper that fetches the latest native mod note and renders a ModNotesBadge. */

import {useFetched,} from '../../../util/ui/hooks'
import {ModNote,} from '../../shared/modnotes/schema'
import {ModNotesBadge,} from './ModNotesBadge'

/** Props for the ModNotesUserRoot component. */
interface ModNotesUserRootProps {
	user: string
	subreddit: string
	/** Async fetcher for the user's most recent native mod note. */
	getLatestModNote: (subreddit: string, user: string,) => Promise<ModNote | null>
	onBadgeClick: (event: React.MouseEvent<HTMLElement>,) => void
}

/** Fetches the latest native mod note and renders a ModNotesBadge for a given user. */
export function ModNotesUserRoot ({user, subreddit, getLatestModNote, onBadgeClick,}: ModNotesUserRootProps,) {
	const note = useFetched(getLatestModNote(subreddit, user,),)

	return (
		<ModNotesBadge
			label="NN"
			user={user}
			subreddit={subreddit}
			note={note}
			onClick={onBadgeClick}
		/>
	)
}
