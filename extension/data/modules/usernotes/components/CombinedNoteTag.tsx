/**
 * Inline note badge that merges Toolbox usernotes and native Reddit mod notes,
 * showing whichever is more recent.
 */

import {useEffect, useState,} from 'react'

import {AuthorButton,} from '../../../shared/controls/AuthorButton'
import {useFetched,} from '../../../util/ui/hooks'
import {labelColors, type ModNote,} from '../../shared/modnotes/schema'
import {activeNotes, findSubredditColor, getUser,} from '../../shared/usernotes/moduleapi'
import {noteTypeColorStyle,} from '../../shared/usernotes/noteTypeColorStyle'
import {getSubredditNotes, subscribeSubredditNotes,} from '../../shared/usernotes/store'

/** Props for the CombinedNoteTag component. */
interface Props {
	subreddit: string
	author: string
	/** Text shown when neither a Toolbox note nor a native note exists. */
	defaultText: string
	/** Maximum characters to show from the note text before truncating. */
	maxChars: number
	/** When true, appends the note date to the displayed text. */
	showDate: boolean
	/** Async fetcher for the user's most recent native mod note in this subreddit. */
	getLatestModNote: (subreddit: string, user: string,) => Promise<ModNote | null>
	onClick: React.MouseEventHandler<HTMLButtonElement>
}

/** Renders a note tag showing the most recent note from either Toolbox or native mod notes. */
export function CombinedNoteTag ({
	subreddit,
	author,
	defaultText,
	maxChars,
	showDate,
	getLatestModNote,
	onClick,
}: Props,) {
	const [subData, setSubData,] = useState(() => getSubredditNotes(subreddit,))
	useEffect(() => subscribeSubredditNotes(subreddit, setSubData,), [subreddit,],)

	const nativeNote = useFetched(getLatestModNote(subreddit, author,),)

	if (subData?.error) { return null }

	const toolboxUser = subData ? getUser(subData.notes.users, author,) : undefined
	// Archived and soft-deleted notes don't show on the tag.
	const toolboxVisibleNotes = toolboxUser ? activeNotes(toolboxUser.notes,) : []
	const toolboxNote = toolboxVisibleNotes[0]
	const nativeNoteText = nativeNote?.user_note_data?.note ?? null

	const hasToolbox = toolboxNote != null
	const hasNative = nativeNoteText != null
	const hasBoth = hasToolbox && hasNative

	// When both exist, show whichever is more recent.
	// Both Toolbox `time` and native `created_at` are epoch seconds.
	const showNative = hasNative && (!hasToolbox || nativeNote!.created_at > toolboxNote.time)

	if (showNative) {
		const noteLabel = nativeNote!.user_note_data!.label
		const noteColor = noteLabel != null ? labelColors[noteLabel] : undefined
		// The native note is displayed, so every Toolbox note is hidden behind it.
		// Surface that hidden Toolbox count as a plain `(+N)`. The native side needs no
		// indicator here since its note is the one on screen.
		const countText = toolboxVisibleNotes.length > 0 ? `  (+${toolboxVisibleNotes.length})` : ''
		const title = `${nativeNoteText} (native note)${hasToolbox ? ' (also has Toolbox notes)' : ''}`
		return (
			<AuthorButton
				type="button"
				title={title}
				onClick={onClick}
			>
				<b style={noteColor ? {color: noteColor,} : undefined}>{nativeNoteText}</b>
				<span>{countText}</span>
			</AuthorButton>
		)
	}

	if (hasToolbox) {
		const date = new Date(toolboxNote.time * 1000,)
		let note = toolboxNote.note
		const title = `${note} (${date.toLocaleString()})${hasBoth ? ' (also has a native mod note)' : ''}`
		if (note.length > maxChars) { note = `${note.substring(0, maxChars,)}...` }
		if (showDate) {
			note = `${note} (${
				date.toLocaleDateString(undefined, {year: 'numeric', month: 'numeric', day: 'numeric',},)
			})`
		}
		const color = findSubredditColor(subData!.colors, toolboxNote.type ?? 'none',)
		// Toolbox note is displayed. The number counts the remaining (hidden) Toolbox
		// notes. A native note can't be counted (only the latest is ever fetched), so
		// its existence is shown as a presence-only colored dot rather than a number.
		const toolboxExtra = toolboxVisibleNotes.length - 1
		const countText = toolboxExtra > 0 ? `  (+${toolboxExtra})` : ''
		const nativeLabel = nativeNote?.user_note_data?.label
		// Dot color mirrors the native note's label severity; grey when unlabelled.
		const nativeDotColor = (nativeLabel != null ? labelColors[nativeLabel] : undefined) ?? '#888'
		return (
			<AuthorButton
				type="button"
				style={noteTypeColorStyle(color,)}
				title={title}
				onClick={onClick}
			>
				<b>{note}</b>
				<span>{countText}</span>
				{hasBoth && (
					<span
						aria-label="also has a native mod note"
						style={{
							marginLeft: '3px',
							color: nativeDotColor,
							fontSize: '0.9em',
							lineHeight: 1,
							verticalAlign: 'baseline',
						}}
					>
						●
					</span>
				)}
			</AuthorButton>
		)
	}

	return <AuthorButton type="button" onClick={onClick}>{defaultText}</AuthorButton>
}
