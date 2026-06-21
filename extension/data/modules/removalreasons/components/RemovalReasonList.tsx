/** Editable list of removal reasons for a subreddit's toolbox config, with inline add/edit/delete support. */

import {
	closestCenter,
	DndContext,
	DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from '@dnd-kit/core'
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {CSS,} from '@dnd-kit/utilities'
import {useCallback, useEffect, useMemo, useRef, useState,} from 'react'

import {getLinkFlairTemplates,} from '../../../api/resources/flair'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {ActionSelect,} from '../../../shared/controls/ActionSelect'
import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {Icon,} from '../../../shared/controls/Icon'
import {TextInput,} from '../../../shared/controls/NormalInput'
import {SortModeRef, useSortMode,} from '../../../shared/controls/SortToggleButton'
import {TextareaInput,} from '../../../shared/controls/TextareaInput'
import {TokenChips,} from '../../../shared/controls/TokenChips'
import {type ConfigState, generateConfigId,} from '../../../util/wiki/schemas/config/schema'
import {decodeHtmlAngleBrackets, substitutionTokens,} from '../../../util/wiki/schemas/shared/tokens'
import type {UserNoteColor,} from '../../../util/wiki/schemas/usernotes/schema'
import {reloadConfigFromWiki,} from '../../config/moduleapi'
import {getRemovalReasonParser,} from '../../shared/removalReasons/parser'
import {getSubredditColors,} from '../../shared/usernotes/moduleapi'
import {noteTypeColorStyle,} from '../../shared/usernotes/noteTypeColorStyle'
import css from './RemovalReasonList.module.css'
import {renderReasonHtml,} from './RemovalReasonsOverlay.helpers'

/** A single removal reason entry as stored in the toolbox wiki config. */
interface Reason {
	/** Stable identifier (schema v2); preserved across edits, assigned on create. */
	id?: string
	text: string
	title?: string
	/** Whether the reason applies to posts (defaults to true when undefined). */
	removePosts?: boolean
	/**
	 * Tri-state comment applicability: `true` always shows the reason for
	 * comments, absent defers to the mod's "enable removal reasons for
	 * comments" setting, and `false` (written only by 6.x) always hides it.
	 * This editor writes `true` or omits the key - never `false`.
	 */
	removeComments?: boolean
	flairText?: string
	flairCSS?: string
	flairTemplateID?: string
	editable?: boolean
	default_note?: string
	default_note_type?: string
}

/** Reason enriched with a synthetic runtime key for React/dnd-kit reconciliation; never persisted. */
interface ReasonEntry extends Reason {
	_key: string
}

/** A Reddit link-flair template returned by the flair API. */
interface FlairTemplate {
	id: string
	text: string
	css_class: string
}

/** Initial field values for the shared reason form. */
interface ReasonFormValues {
	title?: string
	text?: string
	removePosts?: boolean
	removeComments?: boolean
	flairText?: string
	flairCSS?: string
	flairTemplateID?: string
	default_note?: string
	default_note_type?: string
}

/** Props for the shared add/edit form. */
interface ReasonFormProps {
	/** Initial field values - seeded from the reason being edited, or blank for a new reason. */
	initialValues: ReasonFormValues
	/** Prefix applied to HTML `id` attributes to avoid collisions when two forms are visible. */
	idPrefix: string
	/** Pre-loaded flair templates, or null if not yet fetched. */
	flairTemplates: FlairTemplate[] | null
	/** Lazily loads flair templates on demand. */
	onFlairLoad: () => Promise<FlairTemplate[]>
	/** Pre-loaded usernote colors, or null if not yet fetched. */
	noteColors: UserNoteColor[] | null
	/** Lazily loads usernote colors on demand. */
	onNoteColorLoad: () => Promise<UserNoteColor[]>
	/** Label for the primary save button. */
	saveLabel: string
	/** Optional placeholder for the message-text textarea. */
	textPlaceholder?: string
	onSave: (reason: Reason, editNote: string,) => void
	onCancel: () => void
}

/** Shared form for both adding and editing a removal reason. */
function ReasonForm ({
	initialValues,
	idPrefix,
	flairTemplates: initialTemplates,
	onFlairLoad,
	noteColors: initialColors,
	onNoteColorLoad,
	saveLabel,
	textPlaceholder,
	onSave,
	onCancel,
}: ReasonFormProps,) {
	const [title, setTitle,] = useState(initialValues.title ?? '',)
	const [text, setText,] = useState(initialValues.text ?? '',)
	/** The message textarea, for inserting a `{choice}` starter block at the cursor. */
	const textRef = useRef<HTMLTextAreaElement>(null,)
	const [removePosts, setRemovePosts,] = useState(initialValues.removePosts !== false,)
	const [removeComments, setRemoveComments,] = useState(!!initialValues.removeComments,)
	const [flairText, setFlairText,] = useState(initialValues.flairText ?? '',)
	const [flairCSS, setFlairCSS,] = useState(initialValues.flairCSS ?? '',)
	const [flairTemplateID, setFlairTemplateID,] = useState(initialValues.flairTemplateID ?? '',)
	const [editNote, setEditNote,] = useState('',)
	const [templates, setTemplates,] = useState<FlairTemplate[] | null>(initialTemplates,)
	const [defaultNote, setDefaultNote,] = useState(initialValues.default_note ?? '',)
	const [defaultNoteType, setDefaultNoteType,] = useState(initialValues.default_note_type ?? '',)
	const [colors, setColors,] = useState<UserNoteColor[] | null>(initialColors,)

	useEffect(() => {
		if (!templates) {
			void onFlairLoad().then(setTemplates,)
		}
		if (!colors) {
			void onNoteColorLoad().then(setColors,)
		}
	}, [],) // eslint-disable-line react-hooks/exhaustive-deps

	/** Updates flair text/CSS to match the selected template. */
	const handleFlairChange = (e: React.ChangeEvent<HTMLSelectElement>,) => {
		const id = e.target.value
		setFlairTemplateID(id,)
		const template = templates?.find((t,) => t.id === id)
		if (template) {
			setFlairText(template.text,)
			setFlairCSS(template.css_class,)
		}
	}

	/** Splices a `{choice}` starter block into the message text at the cursor. */
	const handleInsertChoice = () => {
		const textarea = textRef.current
		const at = textarea?.selectionStart ?? text.length
		// Lead with blank lines so the marker lands on its own line wherever the
		// caret is; the parser needs the marker and its list on fresh lines.
		const template = '\n\n{choice}\n- Option 1\n- Option 2\n\n'
		const caret = at + template.indexOf('Option 1',)
		setText((prev,) => prev.slice(0, at,) + template + prev.slice(at,))
		// Restore focus with the caret placed on the first option's text.
		requestAnimationFrame(() => {
			textarea?.focus()
			textarea?.setSelectionRange(caret, caret + 'Option 1'.length,)
		},)
	}

	const handleSave = () => {
		onSave(
			{
				text,
				title,
				removePosts,
				// Only ever write `true` - an unchecked box omits the key instead of
				// writing `false`. An absent flag means "defer to the mod's 'enable
				// removal reasons for comments' setting" in the overlay filter, so
				// stamping `false` here would permanently opt the reason out of
				// comments and render that setting inert (the 6.x editor's behavior).
				// Re-saving a reason that carried an explicit `false` heals it too.
				...(removeComments ? {removeComments: true,} : {}),
				flairText,
				flairCSS,
				flairTemplateID,
				...(defaultNote ? {default_note: defaultNote,} : {}),
				...(defaultNoteType ? {default_note_type: defaultNoteType,} : {}),
			},
			editNote,
		)
	}

	return (
		<div className={css.editForm}>
			<div className={css.editField}>
				<label className={css.editFieldLabel} htmlFor={`${idPrefix}-title`}>Title</label>
				<TextInput
					id={`${idPrefix}-title`}
					type="text"
					placeholder="Removal reason title"
					value={title}
					onChange={(e,) => setTitle(e.target.value,)}
				/>
			</div>
			<div className={css.editField}>
				<label className={css.editFieldLabel} htmlFor={`${idPrefix}-text`}>Message text</label>
				<TokenChips tokens={substitutionTokens} inputRef={textRef} onChange={setText}>
					<TextareaInput
						id={`${idPrefix}-text`}
						ref={textRef}
						rows={5}
						placeholder={textPlaceholder}
						value={text}
						onChange={(e,) => setText(e.target.value,)}
					/>
				</TokenChips>
				<div className={css.fieldHint}>
					<ActionButton
						type="button"
						title="Insert a pick-one choice field at the cursor"
						onClick={handleInsertChoice}
					>
						Insert {'{choice}'} field
					</ActionButton>
					<span>
						A {'{choice}'} on its own line, followed by a {'- '} list, becomes a pick-one control.
					</span>
				</div>
			</div>
			<div className={css.editField}>
				<span className={css.editFieldLabel}>Use for</span>
				<div className={css.checkboxRow}>
					<CheckboxInput
						label="Posts"
						checked={removePosts}
						onChange={(e,) => setRemovePosts(e.target.checked,)}
					/>
					<CheckboxInput
						label="Comments"
						checked={removeComments}
						onChange={(e,) => setRemoveComments(e.target.checked,)}
					/>
				</div>
			</div>
			<div className={css.editField}>
				<span className={css.editFieldLabel}>Flair</span>
				<div className={css.flairRow}>
					<TextInput
						type="text"
						placeholder="Flair text"
						value={flairText}
						onChange={(e,) => setFlairText(e.target.value,)}
					/>
					<TextInput
						type="text"
						placeholder="Flair CSS class"
						value={flairCSS}
						onChange={(e,) => setFlairCSS(e.target.value,)}
					/>
				</div>
				<ActionSelect
					name="flair-id"
					value={flairTemplateID}
					onChange={handleFlairChange}
				>
					<option value="Select flair" disabled>Select a flair template</option>
					<option value="">None</option>
					{templates?.map((f,) => <option key={f.id} value={f.id}>{f.text}</option>)}
				</ActionSelect>
			</div>
			<div className={css.editField}>
				<label className={css.editFieldLabel} htmlFor={`${idPrefix}-default-note`}>
					Default usernote (optional)
				</label>
				<TextInput
					id={`${idPrefix}-default-note`}
					type="text"
					placeholder="Pre-filled note text when this reason is selected"
					value={defaultNote}
					onChange={(e,) => setDefaultNote(e.target.value,)}
				/>
				{colors && colors.length > 0 && (
					<div className={css.noteTypeChips} style={{marginTop: '6px',}}>
						{colors.map((color,) => (
							<button
								key={color.key}
								type="button"
								className={[
									css.noteTypeChip,
									defaultNoteType === color.key ? css.noteTypeChipSelected : '',
								].join(' ',)}
								style={noteTypeColorStyle(color,)}
								onClick={() => setDefaultNoteType((prev,) => prev === color.key ? '' : color.key)}
							>
								{color.text}
							</button>
						))}
					</div>
				)}
				{!colors && (
					<p style={{fontSize: '0.9167em', margin: '0.3333em 0 0', opacity: 0.7,}}>
						Loading note types...
					</p>
				)}
			</div>
			<div className={css.editField}>
				<label className={css.editFieldLabel} htmlFor={`${idPrefix}-note`}>
					Wiki revision note (optional)
				</label>
				<TextInput
					id={`${idPrefix}-note`}
					type="text"
					placeholder="Reason for wiki edit"
					value={editNote}
					onChange={(e,) => setEditNote(e.target.value,)}
				/>
			</div>
			<div className={css.editButtons}>
				<ActionButton primary type="button" onClick={handleSave}>{saveLabel}</ActionButton>
				<ActionButton type="button" onClick={onCancel}>Cancel</ActionButton>
			</div>
		</div>
	)
}

function ReasonCard ({
	reason,
	dndId,
	index,
	subreddit,
	isEditing,
	collapsed,
	flairTemplates,
	noteColors,
	parser,
	onEdit,
	onDelete,
	onSave,
	onCancel,
	onFlairLoad,
	onNoteColorLoad,
}: {
	reason: Reason
	/** Stable client-side ID used as the dnd-kit sort key. */
	dndId: string
	index: number
	subreddit: string
	isEditing: boolean
	/** True in sort mode: only the header renders, making reordering easier. */
	collapsed: boolean
	flairTemplates: FlairTemplate[] | null
	noteColors: UserNoteColor[] | null
	parser: ReturnType<typeof getRemovalReasonParser>
	onEdit: () => void
	onDelete: () => void
	onSave: (updated: Reason, editNote: string,) => void
	onCancel: () => void
	onFlairLoad: () => Promise<FlairTemplate[]>
	onNoteColorLoad: () => Promise<UserNoteColor[]>
},) {
	const [expanded, setExpanded,] = useState(false,)
	const [overflows, setOverflows,] = useState(false,)
	const previewRef = useRef<HTMLDivElement>(null,)
	const {attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,} = useSortable({
		id: dndId,
	},)
	const dragStyle = {
		transform: CSS.Transform.toString(transform,),
		transition,
		opacity: isDragging ? 0.5 : undefined,
	}

	const rawText = reason.text
	// Full token-aware rendering so fill-in fields ({input: ...}, {choice}) preview
	// as the controls mods will actually see, not as literal tokens.
	const previewHtml = useMemo(
		() => rawText ? renderReasonHtml(parser, decodeHtmlAngleBrackets(rawText,),) : '',
		[rawText, parser,],
	)

	useEffect(() => {
		const el = previewRef.current
		if (!el) { return }
		setOverflows(el.scrollHeight > el.clientHeight + 2,)
	}, [previewHtml,],)

	const noteTypeColor = reason.default_note_type && noteColors
		? noteColors.find((c,) => c.key === reason.default_note_type)
		: undefined

	return (
		<div ref={setNodeRef} style={dragStyle} className={css.card} data-reason={index} data-subreddit={subreddit}>
			<div className={css.cardHeader}>
				<button
					ref={setActivatorNodeRef}
					type="button"
					className={css.dragHandle}
					{...attributes}
					{...listeners}
					title="Drag to reorder"
				>
					<Icon icon="dragHandle" />
				</button>
				<span className={css.cardTitle}>{reason.title || <em className={css.untitled}>Untitled</em>}</span>
				{(reason.default_note || noteTypeColor) && (
					<div className={css.headerChips}>
						{noteTypeColor && (
							<span
								className={css.headerChip}
								style={noteTypeColorStyle(noteTypeColor,)}
								title={`Default note type: ${noteTypeColor.text}`}
							>
								{noteTypeColor.text}
							</span>
						)}
						{reason.default_note && (
							<span
								className={css.headerChip}
								title={`Default note: ${reason.default_note}`}
							>
								{reason.default_note}
							</span>
						)}
					</div>
				)}
				<div className={css.cardActions}>
					<button
						type="button"
						className={`${css.iconButton} ${isEditing ? css.iconButtonActive : ''}`}
						onClick={onEdit}
						title={isEditing ? 'Close editor' : 'Edit'}
					>
						<Icon icon={isEditing ? 'close' : 'edit'} />
					</button>
					<button type="button" className={css.iconButton} onClick={onDelete} title="Delete">
						<Icon icon="delete" mood="negative" />
					</button>
				</div>
			</div>
			{!collapsed && !isEditing && (
				<>
					{rawText
						? (
							<div className={css.previewWrap}>
								<div
									ref={previewRef}
									className={expanded ? css.previewFull : css.previewClamped}
									dangerouslySetInnerHTML={{__html: previewHtml,}}
								/>
								{(overflows || expanded) && (
									<button
										type="button"
										className={css.expandToggle}
										onClick={() => setExpanded((v,) => !v)}
									>
										{expanded ? 'Show less' : 'Show more'}
									</button>
								)}
							</div>
						)
						: <span className={css.noText}>(no message text)</span>}
				</>
			)}
			{!collapsed && isEditing && (
				<ReasonForm
					initialValues={reason}
					idPrefix={`edit-reason-${index}`}
					flairTemplates={flairTemplates}
					onFlairLoad={onFlairLoad}
					noteColors={noteColors}
					onNoteColorLoad={onNoteColorLoad}
					saveLabel="Save reason"
					onSave={onSave}
					onCancel={onCancel}
				/>
			)}
		</div>
	)
}

/** Ref whose `.current` is called by the parent to trigger the add-reason form. */
type AddRef = {current: (() => void) | null}
/** Ref whose `.current` is called by the parent to enable/disable external controls while the form is open. */
type DisabledRef = {current: ((disabled: boolean,) => void) | null}

/** Props for the RemovalReasonList component. */
export interface RemovalReasonListProps {
	/** Config state object for the current subreddit. */
	state: ConfigState
	/** Optional ref wired up so the parent can open the add-reason form programmatically. */
	addRef?: AddRef
	/** Optional ref wired up so the parent can disable controls while the add form is open. */
	disabledRef?: DisabledRef
	/** Optional ref connecting the list to a footer Reorder toggle. */
	sortRef?: SortModeRef
	/** Called with the updated config and revision note when any reason is saved or deleted. */
	onSave: (config: any, reason: string,) => void
}

/**
 * Blank initial values for the add-reason form. `removeComments` is left
 * absent (not `false`) so a new reason defers to each mod's "enable removal
 * reasons for comments" setting until someone checks the Comments box.
 */
const emptyReasonValues: ReasonFormValues = {
	title: '',
	text: '',
	removePosts: true,
	flairText: '',
	flairCSS: '',
	flairTemplateID: '',
}

/** Renders the full list of editable removal reasons for a subreddit's toolbox config. */
export function RemovalReasonList ({state, addRef, disabledRef, sortRef, onSave,}: RemovalReasonListProps,) {
	const [reasons, setReasons,] = useState<ReasonEntry[]>([],)
	const [editingIndex, setEditingIndex,] = useState<number | null>(null,)
	const [showAddForm, setShowAddForm,] = useState(false,)
	const [flairTemplates, setFlairTemplates,] = useState<FlairTemplate[] | null>(state.postFlairTemplates,)
	const [noteColors, setNoteColors,] = useState<UserNoteColor[] | null>(null,)
	const rootRef = useRef<HTMLDivElement>(null,)
	const idCounterRef = useRef(0,)

	const parser = useMemo(() => getRemovalReasonParser(), [],)

	const subreddit = state.subreddit ?? ''

	/** Assigns a stable runtime key to each reason for React/dnd-kit reconciliation. */
	const toEntries = (raw: Reason[],): ReasonEntry[] =>
		raw.map((r,) => ({...r, _key: `reason-${idCounterRef.current++}`,}))

	useEffect(() => {
		if (document.body.classList.contains('toolbox-wiki-edited',)) {
			reloadConfigFromWiki(subreddit,).then((config,) => {
				if (!config) { return }
				state.config = config
				setReasons(toEntries(config.removalReasons?.reasons ?? [],),)
			},)
		} else {
			setReasons(toEntries(state.config.removalReasons?.reasons ?? [],),)
		}
	}, [],)

	// Stabilized so child `ReasonForm`/`ReasonCard` instances get a constant
	// reference; their mount-once loader effects depend on these callbacks but
	// suppress exhaustive-deps, so an unstable identity would silently desync.
	const loadFlairTemplates = useCallback(async (): Promise<FlairTemplate[]> => {
		if (flairTemplates) { return flairTemplates }
		const templates: FlairTemplate[] = await getLinkFlairTemplates(subreddit,)
		state.postFlairTemplates = templates
		setFlairTemplates(templates,)
		return templates
	}, [flairTemplates, subreddit, state,],)

	const loadNoteColors = useCallback(async (): Promise<UserNoteColor[]> => {
		if (noteColors) { return noteColors }
		const colors = await getSubredditColors(subreddit,)
		setNoteColors(colors,)
		return colors
	}, [noteColors, subreddit,],)

	// Eagerly fetch note colors so header chips can display type names and colors at rest.
	useEffect(() => {
		if (reasons.some((r,) => r.default_note_type)) {
			void loadNoteColors()
		}
	}, [reasons,],) // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		disabledRef?.current?.(showAddForm,)
		if (showAddForm) {
			const el = rootRef.current
			if (!el) { return }
			let parent = el.parentElement
			while (parent) {
				if (parent.scrollHeight > parent.clientHeight) {
					parent.scrollTo({top: parent.scrollHeight, behavior: 'smooth',},)
					break
				}
				parent = parent.parentElement
			}
		}
	}, [showAddForm,],)

	/** True in sort mode: cards collapse to headers to make reordering easier. */
	const sorting = useSortMode(sortRef,)
	/** Set when a drag changed the order; the save happens once on leaving sort mode. */
	const orderDirtyRef = useRef(false,)
	const prevSortingRef = useRef(false,)

	const sensors = useSensors(
		useSensor(PointerSensor,),
		useSensor(KeyboardSensor, {coordinateGetter: sortableKeyboardCoordinates,},),
	)

	const handleDragEnd = (event: DragEndEvent,) => {
		const {active, over,} = event
		if (over && active.id !== over.id) {
			orderDirtyRef.current = true
			setReasons((prev,) => {
				const oldIndex = prev.findIndex((r,) => r._key === active.id)
				const newIndex = prev.findIndex((r,) => r._key === over.id)
				return arrayMove(prev, oldIndex, newIndex,)
			},)
		}
	}

	/**
	 * Persists the current order if a drag changed it since the last save.
	 * Lives in a ref (reassigned every render so it always sees the latest
	 * list) because it must also run from the unmount cleanup below.
	 */
	const flushPendingOrderRef = useRef(() => {},)
	flushPendingOrderRef.current = () => {
		if (!orderDirtyRef.current) { return }
		orderDirtyRef.current = false
		if (!state.config.removalReasons || typeof state.config.removalReasons !== 'object') {
			state.config.removalReasons = {reasons: [],}
		}
		state.config.removalReasons.reasons = reasons.map(({_key: _, ...rest},) => rest)
		onSave(state.config, 'Reordering removal reasons from toolbox config.',)
	}

	// Entering sort mode closes any open editor; leaving it persists the new
	// order (once, and only when a drag actually changed it).
	useEffect(() => {
		if (sorting) {
			setEditingIndex(null,)
			setShowAddForm(false,)
		} else if (prevSortingRef.current) {
			flushPendingOrderRef.current()
		}
		prevSortingRef.current = sorting
	}, [sorting,],) // eslint-disable-line react-hooks/exhaustive-deps

	// Safety net: cards can be dragged in either view and the overlay can close
	// (or the tab switch away, which unmounts) at any time - persist a dirty
	// order on unmount so the reorder is never silently dropped.
	useEffect(() => () => flushPendingOrderRef.current(), [],)

	const handleAddRef = useRef<() => void>(() => {},)
	handleAddRef.current = () => {
		setShowAddForm(true,)
		void loadFlairTemplates()
		void loadNoteColors()
	}
	useEffect(() => {
		if (!addRef) { return }
		addRef.current = () => handleAddRef.current()
		return () => {
			addRef.current = null
		}
	}, [],)

	// Persist a reason list to config and push it upstream. Strips the local `_key` field,
	// clears any pending reorder (the whole list is serialized here, carrying the reorder
	// with it), fires onSave, and updates local state.
	const persistReasons = (newReasons: ReasonEntry[], note: string,) => {
		if (!state.config.removalReasons || typeof state.config.removalReasons !== 'object') {
			state.config.removalReasons = {reasons: [],}
		}
		state.config.removalReasons.reasons = newReasons.map(({_key: _, ...rest},) => rest)
		orderDirtyRef.current = false
		onSave(state.config, note,)
		setReasons(newReasons,)
	}

	const handleSaveEdit = (index: number, updated: Reason, editNote: string,) => {
		const newReasons = [...reasons,]
		// The form rebuilds the reason object; carry the stable id over so edits
		// don't reset it.
		newReasons[index] = {
			id: reasons[index]?.id ?? generateConfigId(),
			...updated,
			_key: reasons[index]!._key,
		}
		persistReasons(newReasons, `${editNote || 'update'}, reason #${index + 1}`,)
		setEditingIndex(null,)
	}

	const handleDelete = (index: number,) => {
		if (!confirm('This will delete this removal reason, are you sure?',)) { return }
		const newReasons = reasons.filter((_, i,) => i !== index)
		persistReasons(newReasons, `delete reason #${index + 1}`,)
		if (editingIndex === index) { setEditingIndex(null,) }
	}

	const handleSaveNew = (reason: Reason, editNote: string,) => {
		const newReasons = [
			...reasons,
			{id: generateConfigId(), ...reason, _key: `reason-${idCounterRef.current++}`,},
		]
		const note = editNote ? `create new reason, ${editNote}` : 'create new reason'
		persistReasons(newReasons, note,)
		setShowAddForm(false,)
	}

	return (
		<div ref={rootRef} className={css.root}>
			<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
				<SortableContext items={reasons.map((r,) => r._key)} strategy={verticalListSortingStrategy}>
					<div id="toolbox-removal-reasons-list" className={css.cardList}>
						{reasons.map((reason, i,) => (
							<ReasonCard
								key={reason._key}
								reason={reason}
								dndId={reason._key}
								index={i}
								subreddit={subreddit}
								isEditing={editingIndex === i}
								collapsed={sorting}
								flairTemplates={flairTemplates}
								noteColors={noteColors}
								parser={parser}
								onEdit={() => {
									if (editingIndex === i) {
										setEditingIndex(null,)
									} else {
										setEditingIndex(i,)
										void loadFlairTemplates()
										void loadNoteColors()
									}
								}}
								onDelete={() => handleDelete(i,)}
								onSave={(updated, note,) => handleSaveEdit(i, updated, note,)}
								onCancel={() => setEditingIndex(null,)}
								onFlairLoad={loadFlairTemplates}
								onNoteColorLoad={loadNoteColors}
							/>
						))}
					</div>
				</SortableContext>
			</DndContext>
			{showAddForm && (
				<div id="toolbox-add-removal-reason-form" className={`${css.card} ${css.addCard}`}>
					<div className={css.cardHeader}>
						<span className={css.cardTitle}>New removal reason</span>
					</div>
					<ReasonForm
						initialValues={emptyReasonValues}
						idPrefix="add-reason"
						flairTemplates={flairTemplates}
						onFlairLoad={loadFlairTemplates}
						noteColors={noteColors}
						onNoteColorLoad={loadNoteColors}
						saveLabel="Save new reason"
						textPlaceholder="Reason comment text (optional if only using flair)"
						onSave={handleSaveNew}
						onCancel={() => setShowAddForm(false,)}
					/>
				</div>
			)}
		</div>
	)
}
