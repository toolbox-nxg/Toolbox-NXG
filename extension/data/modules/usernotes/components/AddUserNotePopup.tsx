/** Popup for creating and viewing usernotes, with tabs for both Toolbox notes and native Reddit mod notes. */

import {useEffect, useRef, useState,} from 'react'
import {Provider,} from 'react-redux'

import {usernotes,} from '../../../framework/moduleIds'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {Icon,} from '../../../shared/controls/Icon'
import {RelativeTime,} from '../../../shared/controls/RelativeTime'
import {Window,} from '../../../shared/window/Window'
import {WindowTabs,} from '../../../shared/window/WindowTabs'
import {ModNotesPager,} from '../../shared/modnotes/ModNotesPager'
import {defaultNoteLabelValueToLabelType, labelColors, selectableLabelNames,} from '../../shared/modnotes/schema'
import {proposeOrBan,} from '../../shared/proposals/gateway'

import {createModNote,} from '../../../api/resources/modnotes'
import store from '../../../store'
import {positiveTextFeedback,} from '../../../store/feedback'
import {nowInSeconds,} from '../../../util/data/time'
import createLogger from '../../../util/infra/logging'
import {useSetting,} from '../../../util/ui/hooks'
import {mountPopup,} from '../../../util/ui/reactMount'
import {ExistingNote, formatArchiveAttribution, UserNoteColor,} from '../../../util/wiki/schemas/usernotes/schema'
import {withArchived,} from '../../shared/usernotes/archived'
import {noteTypeColorStyle,} from '../../shared/usernotes/noteTypeColorStyle'
import {
	resolveUsernoteRequirements,
	type SubUsernoteRequire,
	subUsernoteRequireFromConfig,
	unmetUsernoteRequirement,
} from '../../shared/usernotes/requireRules'

import css from './AddUserNotePopup.module.css'

const log = createLogger('UserNotes',)

/** Props for the AddUserNotePopup component. */
export interface AddUserNotePopupProps {
	subreddit: string
	user: string
	/** When true, the "Include link" checkbox is disabled (no linkable context exists). */
	disableLink: boolean
	/**
	 * Removal message URL recorded for the linked thing earlier this page
	 * session, if any. When present, an "Include removal message" toggle is
	 * offered alongside "Include link".
	 */
	messageLink?: string | undefined
	/** Where to position the draggable popup on initial render. */
	initialPosition: {top: number; left: number}
	/** Available note type colors for the subreddit. */
	colors: UserNoteColor[]
	/** Existing notes to show in the history pane. */
	initialNotes: ExistingNote[]
	/** Resolves a note type key to its color/label definition. */
	findColor: (key: string,) => UserNoteColor
	/**
	 * Called when the moderator saves a new note.
	 * @returns The saved note (with server-assigned id/time), or void on failure.
	 */
	onSave: (
		data: {
			note: string
			type: string | undefined
			includeLink: boolean
			includeMessageLink: boolean
			triggerBan: boolean
			banMessage: string
		},
	) => Promise<ExistingNote | void>
	/**
	 * Called when the moderator edits a recently-created note.
	 * @param noteId The note's per-user index.
	 */
	onEditNote: (noteId: number, data: {note: string; type: string | undefined},) => Promise<void>
	/**
	 * Called when the moderator deletes a note. Deletion is real - the note
	 * is removed from the wiki (its index is never reused).
	 * @param noteId The note's per-user index.
	 */
	onRemoveNote: (noteId: number,) => Promise<void>
	/** Archives a note (hidden but kept). Only provided when the layout supports it. */
	onArchiveNote?: ((noteId: number,) => Promise<void>) | undefined
	/** Clears a note's archived state. */
	onUnarchiveNote?: ((noteId: number,) => Promise<void>) | undefined
	/**
	 * Whether archiving is available (NXG-canonical layouts only; the legacy
	 * v6 page can't carry archive attributions).
	 */
	archivingAvailable?: boolean | undefined
	/** The acting moderator's username, for local attribution display. */
	currentUser?: string | undefined
	/** Called after mount to replace the initial history with freshly loaded Toolbox notes. */
	onRefreshNotes?: (() => Promise<ExistingNote[]>) | undefined
	onClose: () => void
	/** Reddit fullname of the linked thing (e.g. a comment or post), used as context for the note. */
	contextID?: string | undefined
	/** Tab index to open by default (0 = Toolbox Notes, 1 = Native Notes). */
	initialTabIndex?: number | undefined
	/** When true, auto-ban options are suppressed since mods cannot be banned. */
	targetIsMod?: boolean | undefined
	/**
	 * The subreddit's usernote save-requirement flags and enforcement mode.
	 * Combined with the acting moderator's personal settings to decide whether a
	 * type/text/link is required before saving; see `resolveUsernoteRequirements`.
	 */
	subRequire?: SubUsernoteRequire | undefined
}

/** Renders a draggable popup with Toolbox and Native Notes tabs for adding, editing, and viewing usernotes. */
export function AddUserNotePopup ({
	subreddit,
	user,
	disableLink,
	messageLink,
	initialPosition,
	colors,
	initialNotes,
	findColor,
	onSave,
	onEditNote,
	onRemoveNote,
	onArchiveNote,
	onUnarchiveNote,
	archivingAvailable = false,
	currentUser,
	onRefreshNotes,
	onClose,
	contextID,
	initialTabIndex = 0,
	targetIsMod = false,
	subRequire,
}: AddUserNotePopupProps,) {
	const inputRef = useRef<HTMLInputElement>(null,)
	const nativeInputRef = useRef<HTMLInputElement>(null,)
	const [noteText, setNoteText,] = useState('',)
	const [includeLink, setIncludeLink,] = useState(!disableLink,)
	const [includeMessageLink, setIncludeMessageLink,] = useState(true,)
	const [selectedType, setSelectedType,] = useState<string | undefined>(initialNotes[0]?.type,)
	const [notes, setNotes,] = useState(initialNotes,)
	const [error, setError,] = useState<string | undefined>()
	const [activeTabIndex, setActiveTabIndex,] = useState(initialTabIndex,)
	const [editableNoteIds, setEditableNoteIds,] = useState<Set<number>>(() => new Set())
	const [editingNoteId, setEditingNoteId,] = useState<number | undefined>()
	const [saving, setSaving,] = useState(false,)
	const [busyNoteIds, setBusyNoteIds,] = useState<Set<number>>(() => new Set())
	const [showArchived, setShowArchived,] = useState(false,)
	const [triggerBan, setTriggerBan,] = useState(true,)
	const [banMessage, setBanMessage,] = useState('',)
	const notesTouchedRef = useRef(false,)

	const defaultNoteLabel = useSetting(usernotes, 'defaultNoteLabel', 'none',)
	const closePopupAfterNoteSave = useSetting(usernotes, 'closePopupAfterNoteSave', true,)

	// Effective save requirements: the moderator's personal settings combined
	// with the subreddit's flags (the more restrictive wins under suggest/require).
	const personalRequire = {
		type: !!useSetting(usernotes, 'requireNoteType', false,),
		text: !!useSetting(usernotes, 'requireNoteText', true,),
		link: !!useSetting(usernotes, 'requireNoteLink', false,),
	}
	const effectiveRequire = resolveUsernoteRequirements(
		subRequire ?? subUsernoteRequireFromConfig(undefined,),
		personalRequire,
	)

	// The draft note's current contents, checked against the requirements. A link
	// is only enforceable in add mode with a linkable context; edit mode has no
	// link control and no-link contexts can't attach one.
	const usernoteDraft = {
		hasText: !!noteText.trim(),
		hasType: selectedType !== undefined,
		hasLink: includeLink,
		linkEnforceable: editingNoteId === undefined && !disableLink,
	}
	// One source of truth for the gate and the save handler, so the disabled
	// button and the validation can never disagree.
	const requirementMessage = unmetUsernoteRequirement(effectiveRequire, usernoteDraft,)
	// Even with every requirement off, an entirely empty note (no text, no type)
	// has nothing to save.
	const nothingToSave = !usernoteDraft.hasText && !usernoteDraft.hasType
	const saveDisabled = saving || requirementMessage !== null || nothingToSave

	const [nativeNoteText, setNativeNoteText,] = useState('',)
	const [selectedNativeLabel, setSelectedNativeLabel,] = useState<string | undefined>(
		// An unmapped or `none` default label intentionally leaves the native label
		// unset; fall back to `undefined` explicitly so that case reads as deliberate.
		() => defaultNoteLabelValueToLabelType[defaultNoteLabel as string] ?? undefined,
	)
	const [nativeSaving, setNativeSaving,] = useState(false,)
	const [nativeError, setNativeError,] = useState<string | undefined>()
	const [nativeRefreshKey, setNativeRefreshKey,] = useState(0,)
	const [nativeTriggerBan, setNativeTriggerBan,] = useState(true,)
	const [nativeBanDays, setNativeBanDays,] = useState(7,)
	const [nativeBanMessage, setNativeBanMessage,] = useState('',)

	useEffect(() => {
		if (activeTabIndex === 0) { inputRef.current?.focus({preventScroll: true,},) }
		else { nativeInputRef.current?.focus({preventScroll: true,},) }
	}, [activeTabIndex,],)

	useEffect(() => {
		if (!onRefreshNotes) { return }
		let alive = true
		onRefreshNotes().then((freshNotes,) => {
			if (!alive || notesTouchedRef.current) { return }
			setNotes(freshNotes,)
		},).catch((error,) => {
			log.error('Failed to refresh usernotes:', error,)
		},)
		return () => {
			alive = false
		}
	}, [onRefreshNotes,],)

	useEffect(() => {
		setNativeTriggerBan(true,)
		setNativeBanDays(7,)
		setNativeBanMessage('',)
	}, [selectedNativeLabel,],)

	useEffect(() => {
		setTriggerBan(true,)
		setBanMessage('',)
	}, [selectedType,],)

	const currentColor = selectedType !== undefined ? colors.find((c,) => c.key === selectedType) : undefined
	const autoBanDuration = currentColor?.banDuration
	const hasAutoBan = autoBanDuration !== undefined

	async function handleSave () {
		if (requirementMessage) {
			setError(requirementMessage,)
			return
		}
		if (nothingToSave) {
			setError('Add note text or a type',)
			return
		}
		setError(undefined,)
		setSaving(true,)
		notesTouchedRef.current = true
		try {
			if (editingNoteId !== undefined) {
				const editedText = noteText.trim()
				await onEditNote(editingNoteId, {note: editedText, type: selectedType,},)
				setNotes((prev,) =>
					prev.map((note,) =>
						note.id === editingNoteId
							? {...note, note: editedText, type: selectedType ?? '',}
							: note
					)
				)
				cancelEdit()
			} else {
				const savedNote = await onSave({
					note: noteText.trim(),
					type: selectedType,
					includeLink: includeLink && !disableLink,
					includeMessageLink: includeMessageLink && !!messageLink,
					triggerBan: hasAutoBan && triggerBan && !targetIsMod,
					banMessage,
				},)
				if (closePopupAfterNoteSave) {
					onClose()
					return
				}
				if (savedNote) {
					setNotes((prev,) => [savedNote, ...prev.filter((note,) => note.id !== savedNote.id),])
					setEditableNoteIds((prev,) => new Set(prev,).add(savedNote.id,))
				}
				setNoteText('',)
			}
		} catch (error) {
			log.error('Failed to save usernote:', error,)
			setError('Failed to save note',)
		} finally {
			setSaving(false,)
		}
	}

	/** Runs a per-note action with busy tracking, applying `update` to the local list on success. */
	function runNoteAction (
		noteId: number,
		action: (noteId: number,) => Promise<void>,
		update: (notes: ExistingNote[],) => ExistingNote[],
		failureMessage: string,
	) {
		notesTouchedRef.current = true
		setBusyNoteIds((prev,) => new Set(prev,).add(noteId,))
		action(noteId,).then(() => {
			setNotes(update,)
			if (editingNoteId === noteId) { cancelEdit() }
		},).catch((error,) => {
			log.error(failureMessage, error,)
			setError(failureMessage,)
		},).finally(() => {
			setBusyNoteIds((prev,) => {
				const next = new Set(prev,)
				next.delete(noteId,)
				return next
			},)
		},)
	}

	function handleRemove (noteId: number,) {
		runNoteAction(noteId, onRemoveNote, (prev,) => prev.filter((n,) => n.id !== noteId), 'Failed to delete note',)
		setEditableNoteIds((prev,) => {
			const next = new Set(prev,)
			next.delete(noteId,)
			return next
		},)
	}

	function handleArchive (noteId: number,) {
		if (!onArchiveNote) { return }
		runNoteAction(noteId, onArchiveNote, (prev,) =>
			prev.map((n,) =>
				n.id === noteId
					? withArchived(n, {by: currentUser ?? '', at: nowInSeconds(),},)
					: n
			), 'Failed to archive note',)
	}

	function handleUnarchive (noteId: number,) {
		if (!onUnarchiveNote) { return }
		runNoteAction(
			noteId,
			onUnarchiveNote,
			(prev,) => prev.map((n,) => n.id === noteId ? withArchived(n,) : n),
			'Failed to unarchive note',
		)
	}

	/** Human-readable actor for an archive attribution. */
	function toggleType (key: string,) {
		setSelectedType((prev,) => (prev === key ? undefined : key))
	}

	function startEdit (note: ExistingNote,) {
		setEditingNoteId(note.id,)
		setNoteText(note.note,)
		setSelectedType(note.type || undefined,)
		setError(undefined,)
		inputRef.current?.focus()
	}

	function cancelEdit () {
		setEditingNoteId(undefined,)
		setNoteText('',)
		setError(undefined,)
	}

	async function handleNativeSave () {
		if (!nativeNoteText.trim()) {
			setNativeError('Note text is required',)
			return
		}
		setNativeError(undefined,)
		setNativeSaving(true,)
		try {
			await createModNote({
				user,
				subreddit,
				redditID: contextID,
				note: nativeNoteText.trim(),
				label: selectedNativeLabel,
			},)
			if (nativeTriggerBan && (selectedNativeLabel === 'BAN' || selectedNativeLabel === 'PERMA_BAN')) {
				await proposeOrBan(
					{subreddit, itemId: user, itemKind: 'user', link: `https://www.reddit.com/user/${user}`,},
					{
						permanent: selectedNativeLabel === 'PERMA_BAN',
						days: nativeBanDays,
						note: nativeNoteText.trim(),
						message: nativeBanMessage,
					},
				)
			}
			positiveTextFeedback('Note saved',)
			setNativeNoteText('',)
			setNativeRefreshKey((k,) => k + 1)
			onClose()
		} catch (error) {
			log.error('Failed to create native note:', error,)
			setNativeError('Failed to save note',)
		} finally {
			setNativeSaving(false,)
		}
	}

	const archivedNotes = notes.filter((note,) => note.archived)
	const visibleNotes = showArchived ? notes : notes.filter((note,) => !note.archived)

	const toolboxNotesContent = (
		<div className={css.toolboxLayout}>
			<section className={css.historyPane} aria-label="Toolbox note history">
				{visibleNotes.length === 0 && (
					<div className={css.emptyHistory}>
						{notes.length === 0
							? 'No Toolbox notes for this user.'
							: 'No active Toolbox notes for this user.'}
					</div>
				)}
				{visibleNotes.map((note,) => {
					const info = findColor(note.type,)
					const canEdit = editableNoteIds.has(note.id,)
					const isBusy = busyNoteIds.has(note.id,)
					const isHidden = note.archived !== undefined
					const timeEl = <RelativeTime date={new Date(note.time * 1000,)} />
					return (
						<article
							className={`${css.noteCard} ${note.link ? css.noteCardLinked : ''} ${
								isHidden ? css.noteCardHidden : ''
							}`}
							key={note.id}
						>
							{note.link && (
								<a href={note.link} className={css.noteCardLink} tabIndex={-1} aria-hidden="true" />
							)}
							<div className={css.noteRow}>
								{info && info.text && info.key !== 'none' && (
									<span
										className={css.noteTypeChip}
										style={{...noteTypeColorStyle(info,), borderColor: 'currentcolor',}}
									>
										{info.text}
									</span>
								)}
								<span className={css.noteBody}>
									<span
										className={note.link
											? `${css.noteText} ${css.noteTextLinked}`
											: css.noteText}
									>
										{note.note}
									</span>
								</span>
								<a href={`/user/${note.mod}`} className={css.noteModChip}>/u/{note.mod}</a>
								<div className={css.noteActions}>
									{note.messageLink && (
										<a
											href={note.messageLink}
											className={`${css.iconButton} ${css.messageLinkAnchor}`}
											title="view removal message"
											aria-label="View removal message"
											target="_blank"
											rel="noreferrer"
										>
											<Icon icon="modmail" />
										</a>
									)}
									{canEdit && !isHidden && (
										<button
											type="button"
											className={css.iconButton}
											title="edit note"
											aria-label="Edit note"
											disabled={saving || isBusy}
											onClick={() => startEdit(note,)}
										>
											<Icon icon="edit" />
										</button>
									)}
									{archivingAvailable && !isHidden && (
										<button
											type="button"
											className={css.iconButton}
											title="archive note"
											aria-label="Archive note"
											disabled={saving || isBusy}
											onClick={() => handleArchive(note.id,)}
										>
											<Icon icon="archive" />
										</button>
									)}
									{note.archived && (
										<button
											type="button"
											className={css.iconButton}
											title="unarchive note"
											aria-label="Unarchive note"
											disabled={saving || isBusy}
											onClick={() => handleUnarchive(note.id,)}
										>
											<Icon icon="unarchive" />
										</button>
									)}
									<button
										type="button"
										className={css.iconButton}
										title="delete note"
										aria-label="Delete note"
										disabled={saving || isBusy}
										onClick={() => handleRemove(note.id,)}
									>
										<Icon icon="delete" mood="negative" />
									</button>
								</div>
							</div>
							<span className={css.noteDate}>
								{timeEl}
								{note.archived && (
									<span className={css.noteStatus}>
										{' '}- archived {formatArchiveAttribution(note.archived.by,)}{' '}
										<RelativeTime date={new Date(note.archived.at * 1000,)} />
									</span>
								)}
							</span>
						</article>
					)
				},)}
				{archivedNotes.length > 0 && (
					<button
						type="button"
						className={css.textButton}
						onClick={() => setShowArchived((prev,) => !prev)}
					>
						{showArchived
							? 'Hide archived notes'
							: `Show archived notes (${archivedNotes.length})`}
					</button>
				)}
			</section>
			<section
				className={css.composerPane}
				aria-label={editingNoteId === undefined ? 'Create Toolbox note' : 'Edit Toolbox note'}
			>
				<div className={css.composerHeader}>
					<span>{editingNoteId === undefined ? 'Add Toolbox note' : 'Edit recent note'}</span>
					{editingNoteId === undefined && (
						<div className={css.includeLinkGroup}>
							{messageLink && (
								<label className={css.includeLink}>
									<input
										type="checkbox"
										className={css.toggle}
										checked={includeMessageLink}
										disabled={saving}
										onChange={(event,) => setIncludeMessageLink(event.target.checked,)}
									/>
									<span>Include removal message link</span>
								</label>
							)}
							<label className={css.includeLink}>
								<input
									type="checkbox"
									className={css.toggle}
									checked={includeLink}
									disabled={disableLink || saving}
									onChange={(event,) => setIncludeLink(event.target.checked,)}
								/>
								<span>Include link</span>
							</label>
						</div>
					)}
					{editingNoteId !== undefined && (
						<button type="button" className={css.textButton} onClick={cancelEdit} disabled={saving}>
							Cancel
						</button>
					)}
				</div>
				<div className={css.types}>
					<div className={css.typeList}>
						{colors.map((info,) => (
							<button
								type="button"
								key={info.key}
								className={`${css.typeButton} ${selectedType === info.key ? css.selectedType : ''}`}
								style={noteTypeColorStyle(info,)}
								aria-pressed={selectedType === info.key}
								onClick={() => toggleType(info.key,)}
								disabled={saving}
							>
								{info.text}
							</button>
						))}
					</div>
				</div>
				<input
					ref={inputRef}
					type="text"
					className={`${css.noteInput} toolbox-input`}
					placeholder="Add a note..."
					value={noteText}
					onChange={(event,) => {
						setNoteText(event.target.value,)
						if (error) { setError(undefined,) }
					}}
					onKeyDown={(event,) => {
						if (event.key === 'Enter') {
							event.preventDefault()
							handleSave()
						}
					}}
				/>
				{editingNoteId === undefined && hasAutoBan && triggerBan && (
					<textarea
						className={`${css.banMessageInput} toolbox-input`}
						placeholder="ban note to user"
						rows={2}
						value={banMessage}
						disabled={saving}
						onChange={(event,) => setBanMessage(event.target.value,)}
					/>
				)}
				<div className={css.composerFooter}>
					{editingNoteId === undefined && hasAutoBan && (
						<label className={css.includeBan}>
							<input
								type="checkbox"
								className={css.toggle}
								checked={triggerBan && !targetIsMod}
								disabled={saving || targetIsMod}
								onChange={(event,) => setTriggerBan(event.target.checked,)}
							/>
							<span>
								{targetIsMod
									? `${
										autoBanDuration === 0
											? 'Issue Permanent Ban'
											: `Issue ${autoBanDuration} Day Ban`
									} (user is a mod)`
									: autoBanDuration === 0
									? 'Issue Permanent Ban'
									: `Issue ${autoBanDuration} Day Ban`}
							</span>
						</label>
					)}
					{error && <span className={css.error}>{error}</span>}
					<ActionButton type="button" primary disabled={saveDisabled} onClick={handleSave}>
						{saving ? 'Saving...' : editingNoteId === undefined ? `Save for /r/${subreddit}` : 'Save Edit'}
					</ActionButton>
				</div>
			</section>
		</div>
	)

	const nativeNotesContent = (
		<div className={css.toolboxLayout}>
			<section className={css.historyPane} aria-label="Native note history">
				<ModNotesPager key={nativeRefreshKey} user={user} subreddit={subreddit} filter="NOTE" />
			</section>
			<section className={css.composerPane} aria-label="Create native note">
				<div className={css.composerHeader}>
					<span>Add native note</span>
				</div>
				<div className={css.types}>
					<div className={css.typeList}>
						{Object.entries(selectableLabelNames,).map(([key, name,],) => (
							<button
								type="button"
								key={key}
								className={`${css.typeButton} ${selectedNativeLabel === key ? css.selectedType : ''}`}
								style={{color: labelColors[key],}}
								aria-pressed={selectedNativeLabel === key}
								onClick={() => setSelectedNativeLabel((prev,) => prev === key ? undefined : key)}
								disabled={nativeSaving}
							>
								{name}
							</button>
						))}
					</div>
				</div>
				<input
					ref={nativeInputRef}
					type="text"
					className={`${css.noteInput} toolbox-input`}
					placeholder="Add a note..."
					value={nativeNoteText}
					disabled={nativeSaving}
					onChange={(event,) => {
						setNativeNoteText(event.target.value,)
						if (nativeError) { setNativeError(undefined,) }
					}}
					onKeyDown={(event,) => {
						if (event.key === 'Enter') {
							event.preventDefault()
							handleNativeSave()
						}
					}}
				/>
				{(selectedNativeLabel === 'BAN' || selectedNativeLabel === 'PERMA_BAN') && nativeTriggerBan
					&& !targetIsMod && (
						<textarea
							className={`${css.banMessageInput} toolbox-input`}
							placeholder="ban note to user"
							rows={2}
							value={nativeBanMessage}
							disabled={nativeSaving}
							onChange={(event,) => setNativeBanMessage(event.target.value,)}
						/>
					)}
				<div className={css.composerFooter}>
					{selectedNativeLabel === 'PERMA_BAN' && (
						<label className={css.nativeBanRow}>
							<input
								type="checkbox"
								className={css.toggle}
								checked={nativeTriggerBan && !targetIsMod}
								disabled={nativeSaving || targetIsMod}
								onChange={(e,) => setNativeTriggerBan(e.target.checked,)}
							/>
							<span>Issue Permanent Ban{targetIsMod ? ' (user is a mod)' : ''}</span>
						</label>
					)}
					{selectedNativeLabel === 'BAN' && (
						<label className={css.nativeBanRow}>
							<input
								type="checkbox"
								className={css.toggle}
								checked={nativeTriggerBan && !targetIsMod}
								disabled={nativeSaving || targetIsMod}
								onChange={(e,) => setNativeTriggerBan(e.target.checked,)}
							/>
							<span>Issue Ban{targetIsMod ? ' (user is a mod)' : ' for'}</span>
							{!targetIsMod && (
								<>
									<input
										type="number"
										className={`${css.banDaysInput} toolbox-input`}
										min={1}
										max={999}
										value={nativeBanDays}
										disabled={nativeSaving || !nativeTriggerBan}
										onChange={(e,) => {
											const v = parseInt(e.target.value, 10,)
											if (!isNaN(v,) && v >= 1 && v <= 999) { setNativeBanDays(v,) }
										}}
									/>
									<span>days</span>
								</>
							)}
						</label>
					)}
					{nativeError && <span className={css.error}>{nativeError}</span>}
					<ActionButton type="button" primary disabled={nativeSaving} onClick={handleNativeSave}>
						{nativeSaving ? 'Saving...' : `Save for /r/${subreddit}`}
					</ActionButton>
				</div>
			</section>
		</div>
	)

	const tabs = [
		{title: 'Toolbox Notes', content: toolboxNotesContent,},
		{title: 'Native Notes', content: nativeNotesContent,},
	]

	return (
		<Window
			title={
				<span>
					Usernotes - <a href={`/user/${user}`}>/u/{user}</a>
				</span>
			}
			draggable
			initialPosition={initialPosition}
			className={css.popup}
			onClose={onClose}
			footer={undefined}
		>
			<WindowTabs
				tabs={tabs}
				defaultTabIndex={initialTabIndex}
				onTabChange={setActiveTabIndex}
			/>
		</Window>
	)
}

/**
 * Mounts the AddUserNotePopup as a managed popup and returns a cleanup function.
 * @param props Popup props; `onClose` is supplied by the popup manager.
 */
export function showAddUserNotePopup (
	props: Omit<AddUserNotePopupProps, 'onClose'>,
) {
	return mountPopup(
		(onClose,) => (
			<Provider store={store}>
				<AddUserNotePopup {...props} onClose={onClose} />
			</Provider>
		),
		undefined,
		// Per-target: notes for distinct users coexist; re-opening the same user's
		// notes reveals the live popup instead of mounting a duplicate (losing typed text).
		`usernote:${props.subreddit}:${props.user}`,
	)
}
