/** Footer for wiki editor tabs: an optional rollback dropdown, a revision-note text input, and a save button. */
import {useRef, useState,} from 'react'

import type {WikiRevision,} from '../../../api/resources/wiki'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {ActionSelect,} from '../../../shared/controls/ActionSelect'
import {TextInput,} from '../../../shared/controls/NormalInput'
import type {HistoryRef,} from './WikiEditorTab'

/** Ref-based callback slot for triggering a save imperatively from a footer button. */
type SaveRef = {current: (() => void) | null}

/** Props for the WikiEditorFooter component. */
interface Props {
	/** Label text shown on the save button. */
	label: string
	/** Ref assigned by the parent; calling `saveRef.current()` triggers a save. */
	saveRef: SaveRef
	/** Ref written by this component so the parent can read the current revision note. */
	revisionNoteRef: {current: string}
	/** Ref the editor tab assigns its wiki-history API into; enables the rollback dropdown when provided. */
	historyRef?: HistoryRef
}

/** Formats one revision as a dropdown label: local timestamp, author, and trimmed note. */
function revisionLabel (revision: WikiRevision,): string {
	const when = new Date(revision.timestamp * 1000,).toLocaleString()
	const reason = revision.reason ? ` - ${revision.reason}` : ''
	return `${when} by ${revision.author}${reason}`
}

/**
 * Renders a revision-note text input and a primary save button, plus a
 * history dropdown when the editor tab provides a wiki-history API. Picking
 * a revision loads it into the editor; the save button then writes it back
 * as a new revision, which is how a wiki rollback works.
 * Writes the current revision note value into `revisionNoteRef` on every keystroke
 * so the parent can read it without subscribing to React state.
 */
export function WikiEditorFooter ({label, saveRef, revisionNoteRef, historyRef,}: Props,) {
	const [revisionNote, setRevisionNote,] = useState('',)
	const [revisions, setRevisions,] = useState<WikiRevision[] | null>(null,)
	const loadingRef = useRef(false,)
	revisionNoteRef.current = revisionNote

	// The list is fetched lazily when the dropdown is first opened (and
	// refreshed on every reopen, which also picks up an editing-side switch in
	// the tab). The fetch targets whatever page the editor currently shows.
	const refreshRevisions = () => {
		const history = historyRef?.current
		if (!history || loadingRef.current) { return }
		loadingRef.current = true
		void history.listRevisions().then((list,) => {
			setRevisions(list,)
		},).catch(() => {
			setRevisions([],)
		},).finally(() => {
			loadingRef.current = false
		},)
	}

	const handleRevisionPick = (e: React.ChangeEvent<HTMLSelectElement>,) => {
		const revision = revisions?.find((r,) => r.id === e.target.value)
		if (revision) { historyRef?.current?.loadRevision(revision,) }
		// Reset to the placeholder so the same revision can be re-picked later.
		e.target.value = ''
	}

	return (
		<>
			{historyRef && (
				<ActionSelect
					name="edit-wikidata-history"
					value=""
					style={{maxWidth: '18em',}}
					onMouseDown={refreshRevisions}
					onFocus={refreshRevisions}
					onChange={handleRevisionPick}
				>
					<option value="" disabled>
						{revisions === null
							? 'History...'
							: revisions.length === 0
							? 'No history found'
							: 'Roll back to...'}
					</option>
					{revisions?.map((revision,) => (
						<option key={revision.id} value={revision.id}>{revisionLabel(revision,)}</option>
					))}
				</ActionSelect>
			)}
			<TextInput
				inFooter
				type="text"
				name="edit-wikidata-note"
				placeholder="wiki page revision reason (optional)"
				value={revisionNote}
				onChange={(e,) => setRevisionNote(e.target.value,)}
			/>
			<ActionButton primary type="button" onClick={() => saveRef.current?.()}>
				{label}
			</ActionButton>
		</>
	)
}
