/** Single row/card for a mod note inside ModNotesPager, with optional delete button. */

import {Icon,} from '../../../shared/controls/Icon'
import {RelativeTime,} from '../../../shared/controls/RelativeTime'
import {link,} from '../../../util/reddit/pageContext'
import {useFetched,} from '../../../util/ui/hooks'
import {getContextURL,} from './helpers'
import css from './modnotes.module.css'
import {labelColors, labelNames, ModNote, typeNames,} from './schema'

/** Props for the NoteTableRow component. */
interface NoteTableRowProps {
	note: ModNote
	/** Called when the user clicks the delete button on a `NOTE`-type entry. */
	onDelete: () => void
	/** When true, renders as a compact card instead of a `<tr>`. */
	card?: boolean
}

/**
 * Renders a single mod note as either a table row (default) or a compact card (when `card` is true).
 */
export function NoteTableRow ({note, onDelete, card = false,}: NoteTableRowProps,) {
	const createdAt = new Date(note.created_at * 1000,)
	let mod = note.operator
	if (note.user_note_data?.label === 'USER_SUMMARY') {
		mod = 'reddit'
	}

	const contextURL = useFetched(getContextURL(note,),)
	const noteText = note.user_note_data?.note
	const label = note.user_note_data?.label
	const action = note.mod_action_data?.action

	if (card) {
		// Mod-action entries carry no user note, so their summary stands in as the card body.
		const actionDetails = note.mod_action_data?.details ? ` (${note.mod_action_data.details})` : ''
		const actionDescription = note.mod_action_data?.description ? `: ${note.mod_action_data.description}` : ''
		const bodyText = noteText
			?? (action ? `Took action "${action}"${actionDetails}${actionDescription}` : undefined)
		return (
			<article className={css.nativeNoteCard}>
				<div className={css.nativeNoteRow}>
					{label
						? (
							<span
								className={css.nativeNoteTypeChip}
								style={{borderColor: labelColors[label], color: labelColors[label],}}
							>
								{labelNames[label] || label}
							</span>
						)
						: note.type !== 'NOTE' && (
							<span className={css.nativeNoteTypeChip}>
								{typeNames[note.type] || note.type}
							</span>
						)}
					<span className={`${css.nativeNoteBody} ${noteText ? '' : css.actionSummary}`}>
						{bodyText && contextURL
							? <a className={css.nativeNoteText} href={contextURL}>{bodyText}</a>
							: <span className={css.nativeNoteText}>{bodyText}</span>}
					</span>
					<span className={css.nativeNoteModChip}>/u/{mod}</span>
					{note.type === 'NOTE' && (
						<button
							type="button"
							aria-label="Delete note"
							data-note-id={note.id}
							className={css.nativeNoteIconButton}
							onClick={() => onDelete()}
						>
							<Icon mood="negative" icon="delete" />
						</button>
					)}
				</div>
				<span className={css.nativeNoteDate}>
					<RelativeTime date={createdAt} />
				</span>
			</article>
		)
	}

	return (
		<tr>
			<td>
				<a href={link(`/user/${encodeURIComponent(mod,)}`,)}>
					/u/{mod}
				</a>
				<br />
				<small>
					{contextURL
						? (
							<a href={contextURL}>
								<RelativeTime date={createdAt} />
							</a>
						)
						: <RelativeTime date={createdAt} />}
				</small>
			</td>
			<td>
				{typeNames[note.type]}
			</td>
			<td>
				{note.mod_action_data?.action && (
					<span className={css.actionSummary}>
						Took action {'"'}
						{note.mod_action_data.action}
						{'"'}
						{note.mod_action_data.details && ` (${note.mod_action_data.details})`}
						{note.mod_action_data.description && `: ${note.mod_action_data.description}`}
					</span>
				)}
				{note.user_note_data?.note && (
					<blockquote>
						{note.user_note_data.label && (
							<span style={{color: labelColors[note.user_note_data.label],}}>
								[{labelNames[note.user_note_data.label] || note.user_note_data.label}]
							</span>
						)} {note.user_note_data.note}
					</blockquote>
				)}
			</td>
			<td>
				{note.type === 'NOTE' && (
					<button
						type="button"
						aria-label="Delete note"
						data-note-id={note.id}
						onClick={() => onDelete()}
					>
						<Icon mood="negative" icon="delete" />
					</button>
				)}
			</td>
		</tr>
	)
}
