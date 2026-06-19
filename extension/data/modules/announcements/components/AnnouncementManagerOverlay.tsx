/** Management overlay: list existing announcements, remove them, or start a new one. */

import {useCallback, useEffect, useState,} from 'react'

import {ActionButton,} from '../../../shared/controls/ActionButton'
import {reactAlert,} from '../../../shared/controls/ReactAlert'
import {Backdrop,} from '../../../shared/window/Backdrop'
import {Window,} from '../../../shared/window/Window'
import {negativeTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import {nowInSeconds,} from '../../../util/data/time'
import {getAnnouncements, removeAnnouncement,} from '../publish'
import type {AnnouncementNote,} from '../types'
import {openAnnouncementBuilder,} from './AnnouncementBuilderPopup'
import {formatDate,} from './AnnouncementCard'
import css from './AnnouncementManagerOverlay.module.css'

interface Props {
	/** Closes (unmounts) the overlay. */
	onClose: () => void
}

type LoadState =
	| {status: 'loading'}
	| {status: 'error'; reason: string}
	| {status: 'ready'; notes: AnnouncementNote[]}

/**
 * Lists every announcement on the wiki (including scheduled and past ones) with
 * a remove action, plus a button to compose a new one not tied to a post.
 */
export function AnnouncementManagerOverlay ({onClose,}: Props,) {
	const [state, setState,] = useState<LoadState>({status: 'loading',},)
	const [busyId, setBusyId,] = useState<string | null>(null,)

	const load = useCallback(async () => {
		setState({status: 'loading',},)
		const result = await getAnnouncements()
		setState(result.ok ? {status: 'ready', notes: result.notes,} : {status: 'error', reason: result.reason,},)
	}, [],)

	useEffect(() => {
		load()
	}, [load,],)

	/** Confirms, removes a note, then refreshes the list. */
	const handleRemove = async (note: AnnouncementNote,) => {
		const confirmed = await reactAlert({
			message: `Remove the announcement "${note.title}"? This cannot be undone.`,
		},)
		if (!confirmed) {
			return
		}
		setBusyId(note.id,)
		const result = await removeAnnouncement(note.id,)
		setBusyId(null,)
		if (result.ok) {
			positiveTextFeedback('Announcement removed',)
			load()
		} else {
			negativeTextFeedback(result.reason, {duration: 8000,},)
		}
	}

	const nowSeconds = nowInSeconds()

	const toolbar = (
		<div className={css.toolbar}>
			<ActionButton primary onClick={() => openAnnouncementBuilder({onSaved: load,},)}>
				New announcement
			</ActionButton>
			<ActionButton onClick={load} disabled={state.status === 'loading'}>Refresh</ActionButton>
		</div>
	)

	const footer = <ActionButton onClick={onClose}>Close</ActionButton>

	return (
		<Backdrop onClickOutside={onClose}>
			<Window
				title="Manage announcements"
				toolbar={toolbar}
				footer={footer}
				closable
				onClose={onClose}
				className={css.window}
			>
				<div className={css.content}>
					{state.status === 'loading' && <p className={css.message}>Loading...</p>}
					{state.status === 'error' && <p className={css.error}>{state.reason}</p>}
					{state.status === 'ready' && state.notes.length === 0 && (
						<p className={css.message}>No announcements yet.</p>
					)}
					{state.status === 'ready' && state.notes.map((note,) => {
						const scheduled = note.publishAt != null && note.publishAt > nowSeconds
						return (
							<div key={note.id} className={css.row}>
								<div className={css.rowMain}>
									<div className={css.rowTitle}>{note.title}</div>
									<div className={css.rowMeta}>
										{note.publishAt != null && <span>{formatDate(note.publishAt,)}</span>}
										{scheduled && <span className={css.badge}>Scheduled</span>}
										{note.buildTypes
											&& <span className={css.badge}>{note.buildTypes.join(', ',)}</span>}
									</div>
								</div>
								<div className={css.rowActions}>
									{scheduled && (
										<ActionButton
											onClick={() =>
												openAnnouncementBuilder({initialNote: note, onSaved: load,},)}
										>
											Edit
										</ActionButton>
									)}
									<ActionButton
										onClick={() => handleRemove(note,)}
										disabled={busyId === note.id}
									>
										{busyId === note.id ? 'Removing...' : 'Remove'}
									</ActionButton>
								</div>
							</div>
						)
					},)}
				</div>
			</Window>
		</Backdrop>
	)
}
