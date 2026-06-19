/** Paginated list of mod notes for a given user/subreddit pair, with delete support. */

import {map, page, pipeAsync,} from 'iter-ops'
import {useCallback, useMemo, useState,} from 'react'

import {deleteModNote, getAllModNotes,} from '../../../api/resources/modnotes'
import {Pager,} from '../../../shared/window/Pager'
import {negativeTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import createLogger from '../../../util/infra/logging'
import css from './modnotes.module.css'
import {NoteTableRow,} from './NoteTableRow'

const log = createLogger('modnotes',)

/** Props for the ModNotesPager component. */
interface ModNotesPagerProps {
	/** Reddit username to display notes for. */
	user: string
	subreddit: string
	/** Optional note type filter passed to the API (e.g. `'NOTE'` to show only manual notes). */
	filter?: string
}

/**
 * Renders a paginated table (or card list when filter is `'NOTE'`) of Reddit mod notes
 * for a given user/subreddit, with a delete button on each note.
 */
export function ModNotesPager ({user, subreddit, filter: noteFilter,}: ModNotesPagerProps,) {
	const [refreshKey, setRefreshKey,] = useState(0,)
	const notesOnly = noteFilter === 'NOTE'

	const deleteNote = useCallback(async (noteID: string,) => {
		try {
			await deleteModNote({user, subreddit, id: noteID,},)
			positiveTextFeedback('Note removed!',)
			setRefreshKey((k,) => k + 1)
		} catch (error) {
			log.error('Failed to delete note:', error,)
			negativeTextFeedback('Failed to delete note',)
		}
	}, [user, subreddit,],)

	const pages = useMemo(
		() =>
			pipeAsync(
				getAllModNotes(subreddit, user, noteFilter,),
				page(20,),
				map((pageItems,) =>
					notesOnly
						? (
							<div className={css.nativeNoteList}>
								{pageItems.map((note,) => (
									<NoteTableRow
										key={note.id}
										note={note}
										notesOnly
										onDelete={() => deleteNote(note.id,)}
									/>
								))}
							</div>
						)
						: (
							<table className={css.noteTable}>
								<thead>
									<tr>
										<th>Author</th>
										<th>Type</th>
										<th>Details</th>
										<th></th>
									</tr>
								</thead>
								<tbody>
									{pageItems.map((note,) => (
										<NoteTableRow
											key={note.id}
											note={note}
											onDelete={() => deleteNote(note.id,)}
										/>
									))}
								</tbody>
							</table>
						)
				),
			),
		[subreddit, user, noteFilter, notesOnly, refreshKey, deleteNote,],
	)

	return (
		<Pager
			controlPosition="bottom"
			emptyContent={<p>No notes</p>}
			pages={pages}
		/>
	)
}
