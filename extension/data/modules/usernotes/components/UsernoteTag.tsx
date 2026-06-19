/** Inline Toolbox-only usernote tag that shows the most recent note for a user in a given subreddit. */

import {useEffect, useState,} from 'react'

import {GeneralButton,} from '../../../shared/controls/GeneralButton'
import {activeNotes, findSubredditColor, getUser,} from '../../shared/usernotes/moduleapi'
import {noteTypeColorStyle,} from '../../shared/usernotes/noteTypeColorStyle'
import {getSubredditNotes, type SubredditNoteState, subscribeSubredditNotes,} from '../../shared/usernotes/store'

/** Props for the UsernoteTag component. */
interface Props {
	subreddit: string
	author: string
	/** Text shown when no Toolbox note exists for this user. */
	defaultText: string
	/** Maximum characters to show from the note text before truncating. */
	maxChars: number
	/** When true, appends the note date to the displayed text. */
	showDate: boolean
	onNoteTagClick: (event: React.MouseEvent<HTMLButtonElement>,) => void
}

/** Renders a button showing the most recent Toolbox usernote for a user. */
export function UsernoteTag ({subreddit, author, defaultText, maxChars, showDate, onNoteTagClick,}: Props,) {
	const [subData, setSubData,] = useState<SubredditNoteState | undefined>(() => getSubredditNotes(subreddit,))

	useEffect(() => subscribeSubredditNotes(subreddit, setSubData,), [subreddit,],)

	if (subData?.error) { return null }

	const u = subData ? getUser(subData.notes.users, author,) : undefined
	// Archived and soft-deleted notes don't show on the tag.
	const visibleNotes = u ? activeNotes(u.notes,) : []
	if (!subData || visibleNotes.length < 1) {
		return <GeneralButton type="button" onClick={onNoteTagClick}>{defaultText}</GeneralButton>
	}

	const noteData = visibleNotes[0]!
	const date = new Date(noteData.time * 1000,)
	let note = noteData.note
	const title = `${note} (${date.toLocaleString()})`

	if (note.length > maxChars) { note = `${note.substring(0, maxChars,)}...` }
	if (showDate) {
		note = `${note} (${date.toLocaleDateString(undefined, {year: 'numeric', month: 'numeric', day: 'numeric',},)})`
	}

	const color = findSubredditColor(subData.colors, noteData.type ?? 'none',)
	const countText = visibleNotes.length > 1 ? `  (+${visibleNotes.length - 1})` : ''

	return (
		<GeneralButton
			type="button"
			style={noteTypeColorStyle(color,)}
			title={title}
			onClick={onNoteTagClick}
		>
			<b>{note}</b>
			<span>{countText}</span>
		</GeneralButton>
	)
}
