/** Popup component for displaying toolbox announcement notes. */

import {useEffect, useState,} from 'react'

import {mountPopup,} from '../../../util/ui/reactMount'
import {markSeen,} from '../seen'
import type {AnnouncementNote,} from '../types'
import {AnnouncementCard,} from './AnnouncementCard'
import css from './AnnouncementsPopup.module.css'

interface Props {
	notes: AnnouncementNote[]
	onClose: () => void
}

/**
 * Paginated announcement card anchored to the bottom-left of the page. Shows one
 * note at a time; the close (✕) button dismisses the whole popup and is the only
 * way to close it (no backdrop / outside-click). When there is more than one
 * unseen note a dot pager lets the user step between them.
 */
function AnnouncementsPopup ({notes, onClose,}: Props,) {
	const [index, setIndex,] = useState(0,)
	const note = notes[index]!

	// Mark the current note seen only when the user leaves it - the cleanup runs
	// when `note.id` changes (paging away) or on unmount (closing the popup), but
	// never on the initial render. So a quick reload that never engages the popup
	// leaves every note unseen, and only notes actually viewed get hidden later.
	useEffect(() => () => {
		void markSeen(note.id,)
	}, [note.id,],)

	return (
		<div className={css.anchor}>
			<AnnouncementCard
				note={note}
				onClose={onClose}
				pageCount={notes.length}
				pageIndex={index}
				onSelectPage={setIndex}
			/>
		</div>
	)
}

/**
 * Imperatively mounts the announcements popup for the given notes.
 * Called once at startup when there are unseen notes.
 */
export function showAnnouncementsPopup (notes: AnnouncementNote[],): void {
	mountPopup((onClose,) => <AnnouncementsPopup notes={notes} onClose={onClose} />)
}
