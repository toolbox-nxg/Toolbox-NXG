/** Drag-and-drop editable card list of usernote types in the toolbox subreddit config. */

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
import {useEffect, useRef, useState,} from 'react'

import {ActionButton,} from '../../../shared/controls/ActionButton'
import {Icon,} from '../../../shared/controls/Icon'
import {TextInput,} from '../../../shared/controls/NormalInput'
import {SortModeRef, SortToggleButton, useSortMode,} from '../../../shared/controls/SortToggleButton'
import {positiveTextFeedback,} from '../../../store/feedback'
import {
	autoContrastColor,
	colorNameToHex,
	DARK_THEME_BG,
	invertedDarkVariant,
	isReadableOn,
	LIGHT_THEME_BG,
} from '../../../util/data/color'
import createLogger from '../../../util/infra/logging'
import {type ConfigState, generateConfigId,} from '../../../util/wiki/schemas/config/schema'
import {defaultUsernoteTypes, UserNoteColor,} from '../../../util/wiki/schemas/usernotes/schema'
import {getUserNotes, updateUserNotes,} from '../../shared/usernotes/moduleapi'
import {noteTypeColorStyle,} from '../../shared/usernotes/noteTypeColorStyle'
import css from './UsernoteTypeList.module.css'

const log = createLogger('TBConfig',)

/** Internal representation of a usernote type card during editing, augmented with UI state. */
interface UsernoteType {
	/** Stable client-side ID used as the dnd-kit sort key. */
	id: string
	/**
	 * Unique identifier stored in the wiki config and referenced by every note
	 * of this type. Never shown in the UI and never regenerated for existing
	 * types - changing it would orphan existing notes.
	 */
	key: string
	/** Display name shown when adding a note. */
	text: string
	/** Color used in light mode (HTML color name or hex). */
	color: string
	/** Color used in dark mode; falls back to `color` when unset. */
	colorDark?: string
	/** Auto-ban duration in days (0 = permanent), or undefined if auto-ban is disabled. */
	banDuration?: number
	/** Notes of this type older than this many days are archived on save; undefined disables it. */
	autoArchiveDays?: number
	nameError: boolean
	/** Human-readable validation error message to display on the card. */
	errorMsg: string
	/** True while the card shows the delete confirmation bar for an in-use type. */
	confirmingDelete: boolean
}

/**
 * Partial card update where optional fields may be set to `undefined`
 * explicitly (clearing auto-ban/auto-archive under exactOptionalPropertyTypes).
 */
type UsernoteTypePatch = { [K in keyof UsernoteType]?: UsernoteType[K] | undefined }

let idCounter = 0
function fromRaw (raw: UserNoteColor[],): UsernoteType[] {
	return raw.map((t,) => ({
		...t,
		id: `utype-${idCounter++}`,
		nameError: false,
		errorMsg: '',
		confirmingDelete: false,
	}))
}

/** Returns a fresh type key that does not collide with any key already in use. */
function generateTypeKey (usedKeys: Set<string>,): string {
	let key = generateConfigId()
	while (usedKeys.has(key,)) { key = generateConfigId() }
	return key
}

/** Ref whose `.current` is invoked by the parent to trigger saving the type list. */
type SaveRef = {current: (() => void) | null}

function SortableTypeCard ({
	type,
	usageCount,
	collapsed,
	onChange,
	onRemove,
}: {
	type: UsernoteType
	/** Number of existing notes referencing this type, or undefined while unknown. */
	usageCount: number | undefined
	/** True in sort mode: only headers render, making reordering easier. */
	collapsed: boolean
	onChange: (patch: UsernoteTypePatch,) => void
	onRemove: () => void
},) {
	const {attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,} = useSortable({
		id: type.id,
	},)
	const style = {
		transform: CSS.Transform.toString(transform,),
		transition,
		opacity: isDragging ? 0.5 : undefined,
	}

	const lightHex = colorNameToHex(type.color,)
	const darkHex = type.colorDark ? colorNameToHex(type.colorDark,) : lightHex
	const lightUnreadable = !!type.color && !isReadableOn(lightHex, LIGHT_THEME_BG,)
	const darkUnreadable = !!(type.color || type.colorDark) && !isReadableOn(darkHex, DARK_THEME_BG,)

	/** Deletes immediately for unused types; in-use types get a confirmation bar first. */
	const requestRemove = () => {
		if ((usageCount ?? 0) > 0) { onChange({confirmingDelete: true,},) }
		else { onRemove() }
	}

	return (
		<div ref={setNodeRef} style={style} className={css.card}>
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
				<span className={css.cardTitle}>
					<span className={css.typePreview} style={noteTypeColorStyle(type,)}>
						{type.text || <em className={css.untitled}>Untitled</em>}
					</span>
				</span>
				{usageCount !== undefined && usageCount > 0 && (
					<span className={css.usageChip} title="Existing notes using this type">
						{usageCount} note{usageCount === 1 ? '' : 's'}
					</span>
				)}
				<div className={css.cardActions}>
					<button
						type="button"
						className={css.deleteButton}
						onClick={requestRemove}
						title="Remove"
					>
						<Icon icon="delete" mood="negative" />
					</button>
				</div>
			</div>
			{!collapsed && type.confirmingDelete && (
				<div className={css.confirmRow}>
					<span className={css.confirmText}>
						Delete this type? {usageCount} existing note{usageCount === 1 ? '' : 's'}{' '}
						use it and will display without a type.
					</span>
					<ActionButton inline type="button" onClick={onRemove}>Delete</ActionButton>
					<ActionButton inline type="button" onClick={() => onChange({confirmingDelete: false,},)}>
						Cancel
					</ActionButton>
				</div>
			)}
			{!collapsed && (
				<div className={css.cardBody}>
					<label className={css.field}>
						<span className={css.fieldLabel}>Name</span>
						<TextInput
							className={type.nameError ? css.inputError : undefined}
							name="type-name"
							placeholder="name (shown when adding a note)"
							type="text"
							value={type.text}
							onChange={(e,) => onChange({text: e.target.value, nameError: false, errorMsg: '',},)}
						/>
					</label>
					{type.errorMsg && <span className={css.fieldError}>{type.errorMsg}</span>}
					<div className={css.fieldRow}>
						<div className={css.field}>
							<div className={css.colorControl}>
								<span className={css.fieldLabel}>Light mode color</span>
								<input
									type="color"
									className={css.colorPicker}
									title="Color used in light mode"
									value={lightHex}
									onChange={(e,) => onChange({color: e.target.value,},)}
								/>
							</div>
							{lightUnreadable && (
								<span className={css.contrastWarning}>
									Hard to read on light backgrounds{' '}
									<button
										type="button"
										className={css.autoContrastLink}
										title="Adjust the lightness just enough to be readable"
										onClick={() =>
											onChange({color: autoContrastColor(lightHex, LIGHT_THEME_BG,),},)}
									>
										Auto-contrast?
									</button>
								</span>
							)}
						</div>
						<div className={css.field}>
							<div className={css.colorControl}>
								<span className={css.fieldLabel}>Dark mode color</span>
								<input
									type="color"
									className={css.colorPicker}
									title="Color used in dark mode"
									value={darkHex}
									onChange={(e,) => onChange({colorDark: e.target.value,},)}
								/>
								<ActionButton
									inline
									type="button"
									title="Compute a dark mode color from the light mode color"
									onClick={() => onChange({colorDark: invertedDarkVariant(lightHex,),},)}
								>
									Suggest from light
								</ActionButton>
							</div>
							{darkUnreadable && (
								<span className={css.contrastWarning}>
									Hard to read on dark backgrounds{' '}
									<button
										type="button"
										className={css.autoContrastLink}
										title="Adjust the lightness just enough to be readable"
										onClick={() =>
											onChange({colorDark: autoContrastColor(darkHex, DARK_THEME_BG,),},)}
									>
										Auto-contrast?
									</button>
								</span>
							)}
						</div>
					</div>
					<div className={css.fieldRow}>
						<div className={css.field}>
							<span className={css.fieldLabel}>Auto-ban</span>
							<div className={css.durationRow}>
								<select
									className={css.durationSelect}
									value={type.banDuration === undefined
										? 'off'
										: type.banDuration === 0
										? 'permanent'
										: 'temporary'}
									onChange={(e,) => {
										const mode = e.target.value
										if (mode === 'off') { onChange({banDuration: undefined,},) }
										else if (mode === 'permanent') { onChange({banDuration: 0,},) }
										else {onChange({
												banDuration: type.banDuration && type.banDuration > 0
													? type.banDuration
													: 7,
											},)}
									}}
								>
									<option value="off">Off</option>
									<option value="temporary">Temporary</option>
									<option value="permanent">Permanent</option>
								</select>
								{type.banDuration !== undefined && type.banDuration > 0 && (
									<>
										<TextInput
											name="type-ban-days"
											type="number"
											min={1}
											max={999}
											className={css.daysInput}
											title="Ban duration in days"
											value={String(type.banDuration,)}
											onChange={(e,) => {
												const parsed = parseInt(e.target.value, 10,)
												if (!isNaN(parsed,) && parsed >= 1) {
													onChange({banDuration: parsed,},)
												}
											}}
										/>
										<span className={css.daysLabel}>days</span>
									</>
								)}
							</div>
						</div>
						<div className={css.field}>
							<span className={css.fieldLabel}>Auto-archive</span>
							<div className={css.durationRow}>
								<select
									className={css.durationSelect}
									title="Archive notes of this type once they reach a certain age"
									value={type.autoArchiveDays === undefined
										? 'off'
										: type.autoArchiveDays === 0
										? 'immediately'
										: 'after'}
									onChange={(e,) => {
										const mode = e.target.value
										if (mode === 'off') { onChange({autoArchiveDays: undefined,},) }
										else if (mode === 'immediately') { onChange({autoArchiveDays: 0,},) }
										else {onChange({
												autoArchiveDays: type.autoArchiveDays && type.autoArchiveDays > 0
													? type.autoArchiveDays
													: 90,
											},)}
									}}
								>
									<option value="off">Off</option>
									<option value="immediately">Immediately</option>
									<option value="after">After</option>
								</select>
								{type.autoArchiveDays !== undefined && type.autoArchiveDays > 0 && (
									<>
										<TextInput
											name="type-archive-days"
											type="number"
											min={1}
											max={9999}
											className={css.daysInput}
											title="Auto-archive age in days"
											value={String(type.autoArchiveDays,)}
											onChange={(e,) => {
												const parsed = parseInt(e.target.value, 10,)
												if (!isNaN(parsed,) && parsed >= 1) {
													onChange({autoArchiveDays: parsed,},)
												}
											}}
										/>
										<span className={css.daysLabel}>days</span>
									</>
								)}
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

/** Renders a sortable, editable card list of usernote type definitions for the toolbox subreddit config. */
export function UsernoteTypeList (
	{state, saveRef, sortRef,}: {state: ConfigState; saveRef?: SaveRef; sortRef?: SortModeRef},
) {
	const [types, setTypes,] = useState<UsernoteType[]>([],)
	/** Notes-per-type-key tally for usage chips and safe delete; null until loaded. */
	const [usageCounts, setUsageCounts,] = useState<Map<string, number> | null>(null,)
	/** True in sort mode: cards collapse to headers to make reordering easier. */
	const sorting = useSortMode(sortRef,)
	const subreddit = state.subreddit ?? ''

	useEffect(() => {
		if (!subreddit) { return }
		let cancelled = false
		const skipCache = document.body.classList.contains('toolbox-wiki-edited',)
		getUserNotes(subreddit, skipCache,).then((notes,) => {
			if (cancelled) { return }
			setTypes(fromRaw(notes.types?.length ? notes.types : defaultUsernoteTypes,),)
			const counts = new Map<string, number>()
			for (const user of Object.values(notes.users,)) {
				for (const note of user.notes) {
					if (note.type) { counts.set(note.type, (counts.get(note.type,) ?? 0) + 1,) }
				}
			}
			setUsageCounts(counts,)
		},).catch(() => {
			// No notes page or load failure: show defaults, counts stay unknown.
			if (!cancelled) { setTypes(fromRaw(defaultUsernoteTypes,),) }
		},)
		return () => {
			cancelled = true
		}
	}, [],)

	const sensors = useSensors(
		useSensor(PointerSensor,),
		useSensor(KeyboardSensor, {coordinateGetter: sortableKeyboardCoordinates,},),
	)

	const handleDragEnd = (event: DragEndEvent,) => {
		const {active, over,} = event
		if (over && active.id !== over.id) {
			setTypes((prev,) => {
				const oldIndex = prev.findIndex((t,) => t.id === active.id)
				const newIndex = prev.findIndex((t,) => t.id === over.id)
				return arrayMove(prev, oldIndex, newIndex,)
			},)
		}
	}

	const updateType = (index: number, patch: UsernoteTypePatch,) => {
		setTypes((prev,) => prev.map((t, i,) => i === index ? {...t, ...patch,} as UsernoteType : t))
	}

	const addType = () => {
		setTypes((prev,) => [...prev, {
			id: `utype-${idCounter++}`,
			key: generateTypeKey(new Set(prev.map((t,) => t.key),),),
			text: '',
			color: '#ffffff',
			nameError: false,
			errorMsg: '',
			confirmingDelete: false,
		},])
	}

	const removeType = (index: number,) => {
		setTypes((prev,) => prev.filter((_, i,) => i !== index))
	}

	const handleSaveRef = useRef<() => void>(() => {},)

	const handleSave = () => {
		log.debug('Saving usernote types',)
		log.debug(`  Num types: ${types.length}`,)

		let hasError = false
		const seenKeys = new Set<string>()
		const validated = types.map((t,) => {
			const nameError = !t.text
			if (nameError) { hasError = true }
			// Entries from hand-edited configs can lack a key; assign one so the
			// type is addressable. Existing keys are never touched.
			const key = t.key || generateTypeKey(seenKeys,)
			seenKeys.add(key,)
			return {...t, key, nameError, errorMsg: nameError ? 'Name cannot be empty.' : '',}
		},)

		setTypes(validated,)

		if (hasError) {
			log.debug('  Failed validation',)
			return
		}

		const serialized: UserNoteColor[] = validated.map(
			({key, text, color, colorDark, banDuration, autoArchiveDays,},) => {
				const lightHex = colorNameToHex(color,).toLowerCase()
				const darkHex = colorDark ? colorNameToHex(colorDark,).toLowerCase() : undefined
				return {
					key,
					text,
					color,
					// Only persist a dark color that actually differs from the light one.
					...(colorDark && darkHex !== lightHex && {colorDark,}),
					...(banDuration !== undefined && {banDuration,}),
					...(autoArchiveDays !== undefined && {autoArchiveDays,}),
				}
			},
		)
		// Merge the type list into the live dataset so a note another mod added
		// while this config panel was open isn't overwritten by a stale snapshot.
		void updateUserNotes(subreddit, (fresh,) => {
			fresh.types = serialized
			return 'Updated usernote types'
		},).then(() => {
			positiveTextFeedback('Usernote types saved',)
		},)
	}
	handleSaveRef.current = handleSave
	useEffect(() => {
		if (!saveRef) { return }
		saveRef.current = () => handleSaveRef.current()
		return () => {
			saveRef.current = null
		}
	}, [],)

	return (
		<div id="toolbox-config-usernote-types" className={css.root}>
			<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
				<SortableContext items={types.map((t,) => t.id)} strategy={verticalListSortingStrategy}>
					<div id="toolbox-config-usernote-type-list" className={css.cardList}>
						{types.map((type, i,) => (
							<SortableTypeCard
								key={type.id}
								type={type}
								usageCount={usageCounts?.get(type.key,) ?? (usageCounts ? 0 : undefined)}
								collapsed={sorting}
								onChange={(patch,) => updateType(i, patch,)}
								onRemove={() => removeType(i,)}
							/>
						))}
					</div>
				</SortableContext>
			</DndContext>
			<ActionButton primary type="button" onClick={addType}>
				<Icon icon="addCircle" />
				Add usernote type
			</ActionButton>
		</div>
	)
}

/**
 * Footer for the usernote types tab: the sort-mode toggle and the primary
 * save button. Connected to the list through {@link SortModeRef}.
 */
export function UsernoteTypeListFooter ({sortRef, onSave,}: {sortRef: SortModeRef; onSave: () => void},) {
	return (
		<>
			<SortToggleButton sortRef={sortRef} />
			<ActionButton primary type="button" onClick={onSave}>
				Save usernote types
			</ActionButton>
		</>
	)
}
