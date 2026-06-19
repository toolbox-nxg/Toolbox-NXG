/** Bracket-style badge that shows the most recent native mod note for a user. */

import {AuthorButton,} from '../../../shared/controls/AuthorButton'
import {classes,} from '../../../util/ui/reactMount'
import css from '../../shared/modnotes/modnotes.module.css'
import {labelColors, ModNote,} from '../../shared/modnotes/schema'

/** Props for the ModNotesBadge component. */
interface ModNotesBadgeProps {
	/** Fallback label text shown when no note is available (default: `'NN'`). */
	label?: string
	user: string
	subreddit: string
	/** The most recent native mod note, or null/undefined if none exists. */
	note?: ModNote | null | undefined
	onClick?: (event: React.MouseEvent<HTMLElement>,) => void
}

/** Renders a button displaying the most recent native mod note text, or a fallback label. */
export function ModNotesBadge ({
	label = 'NN',
	user,
	subreddit,
	note,
	onClick,
}: ModNotesBadgeProps,) {
	let badgeContents: React.ReactNode = label
	if (note && note.user_note_data) {
		const noteLabel = note.user_note_data.label
		const noteColor = noteLabel != null ? labelColors[noteLabel] : undefined
		badgeContents = (
			<b style={{color: noteColor,}}>
				{note.user_note_data.note}
			</b>
		)
	}
	return (
		<AuthorButton
			type="button"
			className={classes('toolbox-modnote-badge', css.noteButton,)}
			tabIndex={0}
			title={`Mod notes for /u/${user} in /r/${subreddit}`}
			onClick={onClick}
		>
			{badgeContents}
		</AuthorButton>
	)
}
