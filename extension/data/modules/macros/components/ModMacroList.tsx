/** Settings UI component for creating, editing, and deleting a subreddit's mod macros. */

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
import {useEffect, useMemo, useRef, useState,} from 'react'

import {getUserFlairTemplates,} from '../../../api/resources/flair'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {ActionSelect,} from '../../../shared/controls/ActionSelect'
import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {Icon,} from '../../../shared/controls/Icon'
import {TextInput,} from '../../../shared/controls/NormalInput'
import {SortModeRef, useSortMode,} from '../../../shared/controls/SortToggleButton'
import {TextareaInput,} from '../../../shared/controls/TextareaInput'
import {negativeTextFeedback,} from '../../../store/feedback'
import {getMarkdownParser,} from '../../../util/ui/markdown'
import {type ConfigState, generateConfigId, normalizeConfig,} from '../../../util/wiki/schemas/config/schema'
import {reloadToolboxConfig, saveMacroConfig,} from '../moduleapi'
import css from './ModMacroList.module.css'

/** Loose shape of a macro entry as stored in the wiki config. */
interface Macro {
	/** Stable identifier (schema v2); preserved across edits, assigned on create. */
	id?: string
	text?: string
	title?: string
	distinguish?: boolean
	sticky?: boolean
	lockreply?: boolean
	replyassubreddit?: boolean
	approve?: boolean
	remove?: boolean
	spam?: boolean
	lockthread?: boolean
	archivemodmail?: boolean
	highlightmodmail?: boolean
	ban?: boolean
	unban?: boolean
	mute?: boolean
	/** Flair template ID to apply to the user. */
	userflair?: string
	userflairtext?: string
	/** Whether to show this macro on posts; defaults to `true` when absent. */
	contextpost?: boolean
	/** Whether to show this macro on comments; defaults to `true` when absent. */
	contextcomment?: boolean
	/** Whether to show this macro in modmail; defaults to `true` when absent. */
	contextmodmail?: boolean
}

/** Macro enriched with a synthetic runtime key for React reconciliation; never persisted. */
interface MacroEntry extends Macro {
	_key: string
}

/** A single user flair template returned by the Reddit API. */
interface UserFlairTemplate {
	id: string
	text: string
}

/** Controlled form state for the macro editor. */
interface MacroFormState {
	text: string
	title: string
	distinguish: boolean
	sticky: boolean
	lockreply: boolean
	replyassubreddit: boolean
	approve: boolean
	remove: boolean
	spam: boolean
	lockthread: boolean
	archivemodmail: boolean
	highlightmodmail: boolean
	ban: boolean
	unban: boolean
	mute: boolean
	userflair: string
	userflairtext: string
	contextpost: boolean
	contextcomment: boolean
	contextmodmail: boolean
	editNote: string
}

/** Converts a stored macro object to the form state, filling in safe defaults. */
function macroToForm (macro: Macro,): MacroFormState {
	return {
		text: macro.text ?? '',
		title: macro.title ?? '',
		distinguish: !!macro.distinguish,
		sticky: !!macro.sticky,
		lockreply: !!macro.lockreply,
		replyassubreddit: !!macro.replyassubreddit,
		approve: !!macro.approve,
		remove: !!macro.remove,
		spam: !!macro.spam,
		lockthread: !!macro.lockthread,
		archivemodmail: !!macro.archivemodmail,
		highlightmodmail: !!macro.highlightmodmail,
		ban: !!macro.ban,
		unban: !!macro.unban,
		mute: !!macro.mute,
		userflair: macro.userflair ?? '',
		userflairtext: macro.userflairtext ?? '',
		contextpost: macro.contextpost !== false,
		contextcomment: macro.contextcomment !== false,
		contextmodmail: macro.contextmodmail !== false,
		editNote: '',
	}
}

/** Converts the form state back to a storable macro object (excludes `editNote`). */
function formToMacro (form: MacroFormState,): Macro {
	return {
		text: form.text,
		title: form.title,
		distinguish: form.distinguish,
		sticky: form.sticky,
		lockreply: form.lockreply,
		replyassubreddit: form.replyassubreddit,
		approve: form.approve,
		remove: form.remove,
		spam: form.spam,
		lockthread: form.lockthread,
		archivemodmail: form.archivemodmail,
		highlightmodmail: form.highlightmodmail,
		ban: form.ban,
		unban: form.unban,
		mute: form.mute,
		userflair: form.userflair,
		userflairtext: form.userflairtext,
		contextpost: form.contextpost,
		contextcomment: form.contextcomment,
		contextmodmail: form.contextmodmail,
	}
}

/** Props for the MacroForm component. */
interface MacroFormProps {
	/** The macro being edited (or an empty object for a new macro). */
	macro: Macro
	/** Pre-fetched flair templates, or `null` if they have not been loaded yet. */
	flairTemplates: UserFlairTemplate[] | null
	/** Called to lazily fetch flair templates when the user first opens the flair field. */
	onFlairLoad: () => Promise<UserFlairTemplate[]>
	onSave: (form: MacroFormState,) => void
	onCancel: () => void
	/** Label text for the primary save button. */
	saveLabel: string
}

/** Renders the full macro editing form with all action checkboxes, text fields, and flair selector. */
function MacroForm (
	{macro, flairTemplates: initialTemplates, onFlairLoad, onSave, onCancel, saveLabel,}: MacroFormProps,
) {
	const [form, setForm,] = useState<MacroFormState>(() => macroToForm(macro,))
	const [templates, setTemplates,] = useState<UserFlairTemplate[] | null>(initialTemplates,)

	useEffect(() => {
		if (!templates) {
			void onFlairLoad().then(setTemplates,)
		}
	}, [],)

	const set = (patch: Partial<MacroFormState>,) => setForm((f,) => ({...f, ...patch,}))

	const handleFlairChange = (e: React.ChangeEvent<HTMLSelectElement>,) => {
		const id = e.target.value
		const template = templates?.find((t,) => t.id === id)
		set({userflair: id, userflairtext: template?.text ?? form.userflairtext,},)
	}

	const handleSave = () => {
		if (!form.title.trim()) {
			negativeTextFeedback('Macro title is required',)
			return
		}
		onSave(form,)
	}

	return (
		<div className={css.editForm}>
			<div className={css.editField}>
				<label className={css.editFieldLabel} htmlFor="macro-title-input">Title</label>
				<TextInput
					id="macro-title-input"
					type="text"
					name="macro-title"
					placeholder="Macro title"
					value={form.title}
					onChange={(e,) => set({title: e.target.value,},)}
				/>
			</div>
			<div className={css.editField}>
				<label className={css.editFieldLabel} htmlFor="macro-text-input">Macro text</label>
				<TextareaInput
					id="macro-text-input"
					className={css.editTextarea}
					rows={5}
					placeholder="Macro text (supports markdown)"
					value={form.text}
					onChange={(e,) => set({text: e.target.value,},)}
				/>
			</div>

			<div className={css.actionsGrid}>
				<div className={css.actionGroup}>
					<div className={css.actionGroupLabel}>Reply</div>
					<CheckboxInput
						label="Distinguish"
						checked={form.distinguish}
						onChange={(e,) => set({distinguish: e.target.checked,},)}
					/>
					<CheckboxInput
						label="Sticky comment"
						checked={form.sticky}
						onChange={(e,) => set({sticky: e.target.checked,},)}
					/>
					<CheckboxInput
						label="Lock reply"
						checked={form.lockreply}
						onChange={(e,) => set({lockreply: e.target.checked,},)}
					/>
					<CheckboxInput
						label="Reply as subreddit"
						checked={form.replyassubreddit}
						onChange={(e,) => set({replyassubreddit: e.target.checked,},)}
					/>
				</div>
				<div className={css.actionGroup}>
					<div className={css.actionGroupLabel}>Item</div>
					<CheckboxInput
						label="Approve"
						checked={form.approve}
						onChange={(e,) => set({approve: e.target.checked,},)}
					/>
					<CheckboxInput
						label="Remove"
						checked={form.remove}
						onChange={(e,) => set({remove: e.target.checked,},)}
					/>
					<CheckboxInput
						label="Spam"
						checked={form.spam}
						onChange={(e,) => set({spam: e.target.checked,},)}
					/>
					<CheckboxInput
						label="Lock thread"
						checked={form.lockthread}
						onChange={(e,) => set({lockthread: e.target.checked,},)}
					/>
					<CheckboxInput
						label="Archive modmail"
						checked={form.archivemodmail}
						onChange={(e,) => set({archivemodmail: e.target.checked,},)}
					/>
					<CheckboxInput
						label="Highlight modmail"
						checked={form.highlightmodmail}
						onChange={(e,) => set({highlightmodmail: e.target.checked,},)}
					/>
				</div>
				<div className={css.actionGroup}>
					<div className={css.actionGroupLabel}>User</div>
					<CheckboxInput label="Ban" checked={form.ban} onChange={(e,) => set({ban: e.target.checked,},)} />
					<CheckboxInput
						label="Unban"
						checked={form.unban}
						onChange={(e,) => set({unban: e.target.checked,},)}
					/>
					<CheckboxInput
						label="Mute"
						checked={form.mute}
						onChange={(e,) => set({mute: e.target.checked,},)}
					/>
				</div>
				<div className={css.actionGroup}>
					<div className={css.actionGroupLabel}>Context</div>
					<CheckboxInput
						label="Post"
						checked={form.contextpost}
						onChange={(e,) => set({contextpost: e.target.checked,},)}
					/>
					<CheckboxInput
						label="Comment"
						checked={form.contextcomment}
						onChange={(e,) => set({contextcomment: e.target.checked,},)}
					/>
					<CheckboxInput
						label="Modmail"
						checked={form.contextmodmail}
						onChange={(e,) => set({contextmodmail: e.target.checked,},)}
					/>
				</div>
			</div>

			<div className={css.editField}>
				<div className={css.actionGroupLabel}>User flair</div>
				<ActionSelect
					name="user-flair-id"
					value={form.userflair}
					onChange={handleFlairChange}
				>
					<option value="Select user flair" disabled>Select user flair template</option>
					<option value="">Don&apos;t touch</option>
					{templates?.map((f,) => <option key={f.id} value={f.id}>{f.text}</option>)}
				</ActionSelect>
			</div>

			<div className={css.editField}>
				<label className={css.editFieldLabel} htmlFor="macro-edit-note">Wiki edit note (optional)</label>
				<TextInput
					id="macro-edit-note"
					type="text"
					name="edit-note"
					placeholder="Reason for this wiki edit"
					value={form.editNote}
					onChange={(e,) => set({editNote: e.target.value,},)}
				/>
			</div>

			<div className={css.editButtons}>
				<ActionButton primary type="button" onClick={handleSave}>{saveLabel}</ActionButton>
				<ActionButton type="button" onClick={onCancel}>Cancel</ActionButton>
			</div>
		</div>
	)
}

function MacroCard ({
	macro,
	dndId,
	index,
	subreddit,
	isEditing,
	collapsed,
	flairTemplates,
	parser,
	onEdit,
	onDelete,
	onSave,
	onCancel,
	onFlairLoad,
}: {
	macro: Macro
	/** Stable client-side ID used as the dnd-kit sort key. */
	dndId: string
	index: number
	subreddit: string
	isEditing: boolean
	/** True in sort mode: only the header renders, making reordering easier. */
	collapsed: boolean
	flairTemplates: UserFlairTemplate[] | null
	parser: ReturnType<typeof getMarkdownParser>
	onEdit: () => void
	onDelete: () => void
	onSave: (form: MacroFormState,) => void
	onCancel: () => void
	onFlairLoad: () => Promise<UserFlairTemplate[]>
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

	const rawText = macro.text ?? ''
	const previewHtml = useMemo(() => rawText ? parser.render(rawText,) : '', [rawText, parser,],)

	useEffect(() => {
		const el = previewRef.current
		if (!el) { return }
		setOverflows(el.scrollHeight > el.clientHeight + 2,)
	}, [previewHtml,],)

	const contexts: string[] = []
	if (macro.contextpost !== false) { contexts.push('Post',) }
	if (macro.contextcomment !== false) { contexts.push('Comment',) }
	if (macro.contextmodmail !== false) { contexts.push('Modmail',) }

	return (
		<div ref={setNodeRef} style={dragStyle} className={css.card} data-macro={index} data-subreddit={subreddit}>
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
				<span className={css.cardTitle}>{macro.title || <em className={css.untitled}>Untitled</em>}</span>
				<div className={css.contextBadges}>
					{contexts.map((context,) => (
						<span key={context} className={css.contextBadge}>{context}</span>
					))}
				</div>
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
						: <span className={css.noText}>(no macro text)</span>}
				</>
			)}
			{!collapsed && isEditing && (
				<div className={css.editWrap}>
					<MacroForm
						macro={macro}
						flairTemplates={flairTemplates}
						onFlairLoad={onFlairLoad}
						onSave={onSave}
						onCancel={onCancel}
						saveLabel="Save macro"
					/>
				</div>
			)}
		</div>
	)
}

/** Ref used by a parent settings tab to imperatively trigger adding a new macro. */
type AddRef = {current: (() => void) | null}
/** Ref used by a parent settings tab to disable external controls while the add form is open. */
type DisabledRef = {current: ((disabled: boolean,) => void) | null}

/** Props for the ModMacroList component. */
export interface ModMacroListProps {
	/** Shared config state object passed down from the settings framework. */
	state: ConfigState
	/** Optional ref wired up by the parent tab to trigger opening the "add macro" form. */
	addRef?: AddRef
	/** Optional ref wired up by the parent tab to disable save/add buttons while the form is open. */
	disabledRef?: DisabledRef
	/** Optional ref connecting the list to a footer Reorder toggle. */
	sortRef?: SortModeRef
}

/** Renders the full list of mod macros for a subreddit with inline editing and delete support. */
export function ModMacroList ({state, addRef, disabledRef, sortRef,}: ModMacroListProps,) {
	const [macros, setMacros,] = useState<MacroEntry[]>([],)
	const [editingIndex, setEditingIndex,] = useState<number | null>(null,)
	const [showAddForm, setShowAddForm,] = useState(false,)
	const [flairTemplates, setFlairTemplates,] = useState<UserFlairTemplate[] | null>(state.userFlairTemplates,)
	const rootRef = useRef<HTMLDivElement>(null,)
	const idCounterRef = useRef(0,)
	const parser = useMemo(() => getMarkdownParser(), [],)

	const subreddit = state.subreddit ?? ''

	/** Assigns a stable runtime key to each macro for React reconciliation. */
	const toEntries = (raw: Macro[],): MacroEntry[] =>
		raw.map((m,) => ({...m, _key: `macro-${idCounterRef.current++}`,}))

	useEffect(() => {
		if (document.body.classList.contains('toolbox-wiki-edited',)) {
			reloadToolboxConfig(subreddit,).then((config,) => {
				if (!config) { return }
				normalizeConfig(config,)
				state.config = config
				setMacros(toEntries(config.modMacros ?? [],),)
			},)
		} else {
			setMacros(toEntries(state.config.modMacros ?? [],),)
		}
	}, [],)

	const loadFlairTemplates = async (): Promise<UserFlairTemplate[]> => {
		if (flairTemplates) { return flairTemplates }
		const templates: UserFlairTemplate[] = await getUserFlairTemplates(subreddit,)
		state.userFlairTemplates = templates
		setFlairTemplates(templates,)
		return templates
	}

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
			setMacros((prev,) => {
				const oldIndex = prev.findIndex((m,) => m._key === active.id)
				const newIndex = prev.findIndex((m,) => m._key === over.id)
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
		state.config.modMacros = macros.map(({_key: _, ...rest},) => rest)
		saveMacroConfig(subreddit, state.config, 'Reordering mod macros from toolbox config.',)
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
	}
	useEffect(() => {
		if (!addRef) { return }
		addRef.current = () => handleAddRef.current()
		return () => {
			addRef.current = null
		}
	}, [],)

	const handleSaveEdit = (index: number, form: MacroFormState,) => {
		const newMacros = [...macros,]
		// The form rebuilds the macro object; carry the stable id over so edits
		// don't reset it.
		newMacros[index] = {
			id: macros[index]?.id ?? generateConfigId(),
			...formToMacro(form,),
			_key: macros[index]!._key,
		}
		const editNote = `${form.editNote || 'update'}, macro #${index + 1}`
		state.config.modMacros = newMacros.map(({_key: _, ...rest},) => rest)
		// This save serializes the whole list, so any pending reorder is
		// persisted along with it.
		orderDirtyRef.current = false
		saveMacroConfig(subreddit, state.config, editNote,)
		setMacros(newMacros,)
		setEditingIndex(null,)
	}

	const handleDelete = (index: number,) => {
		if (!confirm('This will delete this mod macro, are you sure?',)) { return }
		const newMacros = macros.filter((_, i,) => i !== index)
		state.config.modMacros = newMacros.map(({_key: _, ...rest},) => rest)
		// Serializes the whole list, carrying any pending reorder with it.
		orderDirtyRef.current = false
		saveMacroConfig(subreddit, state.config, `delete macro #${index + 1}`,)
		setMacros(newMacros,)
		if (editingIndex === index) { setEditingIndex(null,) }
	}

	const handleSaveNew = (form: MacroFormState,) => {
		if (!state.config.modMacros) { state.config.modMacros = [] }
		const newMacros = [
			...macros,
			{id: generateConfigId(), ...formToMacro(form,), _key: `macro-${idCounterRef.current++}`,},
		]
		const editNote = `create new macro${form.editNote ? `, ${form.editNote}` : ''}`
		state.config.modMacros = newMacros.map(({_key: _, ...rest},) => rest)
		// Serializes the whole list, carrying any pending reorder with it.
		orderDirtyRef.current = false
		saveMacroConfig(subreddit, state.config, editNote,)
		setMacros(newMacros,)
		setShowAddForm(false,)
	}

	const emptyMacro: Macro = {}

	return (
		<div ref={rootRef} className={css.root}>
			<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
				<SortableContext items={macros.map((m,) => m._key)} strategy={verticalListSortingStrategy}>
					<div id="toolbox-mod-macros-list" className={css.cardList}>
						{macros.map((macro, i,) => (
							<MacroCard
								key={macro._key}
								macro={macro}
								dndId={macro._key}
								index={i}
								subreddit={subreddit}
								isEditing={editingIndex === i}
								collapsed={sorting}
								flairTemplates={flairTemplates}
								parser={parser}
								onEdit={() => {
									if (editingIndex === i) {
										setEditingIndex(null,)
									} else {
										setEditingIndex(i,)
										void loadFlairTemplates()
									}
								}}
								onDelete={() => handleDelete(i,)}
								onSave={(form,) => handleSaveEdit(i, form,)}
								onCancel={() => setEditingIndex(null,)}
								onFlairLoad={loadFlairTemplates}
							/>
						))}
					</div>
				</SortableContext>
			</DndContext>
			{showAddForm && (
				<div id="toolbox-add-mod-macro-form" className={`${css.card} ${css.addCard}`}>
					<div className={css.cardHeader}>
						<span className={css.cardTitle}>New mod macro</span>
					</div>
					<div className={css.editWrap}>
						<MacroForm
							macro={emptyMacro}
							flairTemplates={flairTemplates}
							onFlairLoad={loadFlairTemplates}
							onSave={handleSaveNew}
							onCancel={() => setShowAddForm(false,)}
							saveLabel="Save new macro"
						/>
					</div>
				</div>
			)}
		</div>
	)
}
