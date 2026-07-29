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
import {formatRelativeTime,} from '../../../util/data/time'
import {type ConfigState, generateConfigId, type ToolboxConfig,} from '../../../util/wiki/schemas/config/schema'
import {
	containsLiteralChoiceMarker,
	decodeHtmlAngleBrackets,
	htmlFieldsToTokens,
	substitutionTokens,
} from '../../../util/wiki/schemas/shared/tokens'
import type {UserNoteColor,} from '../../../util/wiki/schemas/usernotes/schema'
import {reloadConfigFromWiki,} from '../../config/moduleapi'
import {getRemovalReasonParser,} from '../../shared/removalReasons/parser'
import {getSubredditColors,} from '../../shared/usernotes/moduleapi'
import {noteTypeColorStyle,} from '../../shared/usernotes/noteTypeColorStyle'
import {
	getLastNativeSyncCheck,
	getLastNativeSyncFailure,
	type NativeSyncFailure,
	syncNativeReasons,
} from '../features/syncNativeReasons'
import {stripNativeReasons,} from '../nativeSync'
import type {RemovalReason,} from '../schema'
import css from './RemovalReasonList.module.css'
import {renderReasonHtml,} from './RemovalReasonsOverlay.helpers'

/**
 * The reason fields this editor's form owns: it writes every one of them on save,
 * omitting the ones that are off rather than writing a falsy value.
 *
 * Everything outside this list is carried across an edit untouched (see
 * `handleSaveEdit`). That default-preserve direction is deliberate: the form
 * rebuilds the reason object from its own state, so a field it does not re-emit
 * would otherwise be silently dropped every time a mod saves an edit.
 */
export const formOwnedKeys = [
	'title',
	'text',
	'removePosts',
	'removeComments',
	'flairText',
	'flairCSS',
	'flairTemplateID',
	'default_note',
	'default_note_type',
] as const satisfies ReadonlyArray<keyof RemovalReason>

/** The subset of a reason the form produces; the rest is preserved from the original. */
type FormReason = Pick<RemovalReason, typeof formOwnedKeys[number]>

/** Reason enriched with a synthetic runtime key for React/dnd-kit reconciliation; never persisted. */
interface ReasonEntry extends RemovalReason {
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
	/**
	 * Whether this reason is synced from Reddit's native removal reasons, which owns its
	 * title and message. Both become read-only, since the next sync would overwrite any
	 * edit made here.
	 */
	syncedFromNative?: boolean
	/** Subreddit the reason belongs to, for the link out to Reddit's mod tools. */
	subreddit?: string
	/**
	 * Receives only the fields the form owns ({@link formOwnedKeys}); the caller merges
	 * them over the original so preserved fields survive the edit.
	 */
	onSave: (reason: FormReason, editNote: string,) => void
	onCancel: () => void
}

/** Explains that Reddit owns a synced reason's title and message, and links to where to change them. */
function ManagedByRedditHint ({subreddit,}: {subreddit: string | undefined},) {
	return (
		<div className={css.lockedHint}>
			Managed by Reddit. {subreddit
				? (
					<a
						// Reddit keeps native removal reasons under Saved Responses in the new mod
						// tools; the old /r/<sub>/about/removal path is not where they live.
						href={`https://sh.reddit.com/mod/${subreddit}/saved-responses/removals`}
						target="_blank"
						rel="noopener noreferrer"
					>
						Edit in Mod Tools
					</a>
				)
				: 'Edit in Mod Tools'} &ndash; the next sync overwrites changes made here.
		</div>
	)
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
	syncedFromNative,
	subreddit,
	onSave,
	onCancel,
}: ReasonFormProps,) {
	const [title, setTitle,] = useState(initialValues.title ?? '',)
	const [text, setText,] = useState(initialValues.text ?? '',)
	/** The message textarea, for inserting a `{choice}` starter block at the cursor. */
	const textRef = useRef<HTMLTextAreaElement>(null,)
	// Live "what this renders to" preview, toggled from the Message text label row.
	// Reuses the overlay's token-aware renderer so {input}/{textarea}/{choice} fields
	// preview as the actual controls, not literal tokens.
	const [showPreview, setShowPreview,] = useState(false,)
	const previewParser = useMemo(() => getRemovalReasonParser(), [],)
	// Only render the preview while it's actually shown - it defaults hidden, so otherwise every
	// keystroke would run the full token-aware render to build HTML that's never mounted.
	const previewHtml = useMemo(
		() => showPreview && text.trim() ? renderReasonHtml(previewParser, decodeHtmlAngleBrackets(text,),) : '',
		[showPreview, text, previewParser,],
	)
	// A marker no control gets rendered for is sent verbatim, option list and all, so it is
	// flagged here as well as in the overlay - this is where it can actually be fixed. Healed
	// the same way the overlay heals it, so a legacy `<select>` isn't reported as broken.
	const literalChoiceMarker = useMemo(
		() => containsLiteralChoiceMarker(htmlFieldsToTokens(decodeHtmlAngleBrackets(text,),),),
		[text,],
	)
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
					// readOnly rather than disabled: the value stays in form state so it
					// round-trips unchanged on save, and the text stays selectable.
					readOnly={syncedFromNative}
					onChange={(e,) => setTitle(e.target.value,)}
				/>
				{syncedFromNative && <ManagedByRedditHint subreddit={subreddit} />}
			</div>
			<div className={css.editField}>
				<div className={css.fieldLabelRow}>
					<label className={css.editFieldLabel} htmlFor={`${idPrefix}-text`}>Message text</label>
					<button
						type="button"
						className={css.previewToggle}
						aria-pressed={showPreview}
						onClick={() => setShowPreview((shown,) => !shown)}
					>
						{showPreview ? 'Edit' : 'Preview'}
					</button>
				</div>
				{showPreview
					? (
						<div className={`${css.previewWrap} ${css.editPreview}`}>
							{previewHtml
								? (
									<div
										className={css.previewFull}
										dangerouslySetInnerHTML={{__html: previewHtml,}}
									/>
								)
								: <span className={css.previewEmpty}>Nothing to preview yet.</span>}
						</div>
					)
					: syncedFromNative
					// Nothing can be inserted into a read-only message, so the token chips and
					// the insert-choice button are omitted rather than shown inert.
					? (
						<>
							<TextareaInput
								id={`${idPrefix}-text`}
								ref={textRef}
								rows={5}
								placeholder={textPlaceholder}
								value={text}
								readOnly
								onChange={(e,) => setText(e.target.value,)}
							/>
							<ManagedByRedditHint subreddit={subreddit} />
						</>
					)
					: (
						<>
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
									A {'{choice}'} on its own line, followed by a {'- '}{' '}
									list, becomes a pick-one control.
								</span>
							</div>
							{literalChoiceMarker && (
								<div className={css.fieldWarning}>
									A {'{choice}'} here has no {'- '}{' '}
									option list under it, so it will be sent as text - marker and all - instead of
									becoming a pick-one control.
								</div>
							)}
						</>
					)}
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
	onDetachNative,
	onSave,
	onCancel,
	onFlairLoad,
	onNoteColorLoad,
}: {
	reason: RemovalReason
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
	/** Detaches a synced reason from Reddit; absent for reasons that were never synced. */
	onDetachNative: () => void
	onSave: (updated: FormReason, editNote: string,) => void
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
				{(reason.default_note || noteTypeColor || reason.nativeReasonId) && (
					<div className={css.headerChips}>
						{reason.nativeReasonId && (
							<span
								className={`${css.headerChip} ${css.nativeChip}`}
								title="Synced from Reddit's native removal reasons. Title and message are managed in Mod Tools."
							>
								Native
							</span>
						)}
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
					{reason.nativeReasonId && (
						<button
							type="button"
							className={css.iconButton}
							onClick={onDetachNative}
							title="Convert to a toolbox reason (stops syncing with Reddit)"
						>
							<Icon icon="tbSettingLink" />
						</button>
					)}
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
					{...(reason.nativeReasonId ? {syncedFromNative: true,} : {})}
					{...(subreddit ? {subreddit,} : {})}
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
	/** Optional ref wired up so the parent's "Sync now" button can force a native reason sync. */
	/** Called with the updated config and revision note when any reason is saved or deleted. */
	/**
	 * Persists the config. May return a promise: the sync toggle has to wait for the write
	 * before syncing, because the sync re-reads the config from the wiki.
	 */
	onSave: (config: ToolboxConfig, reason: string,) => void | Promise<unknown>
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
	const [flairTemplates, setFlairTemplates,] = useState<FlairTemplate[] | null>(
		state.postFlairTemplates as FlairTemplate[] | null,
	)
	const [noteColors, setNoteColors,] = useState<UserNoteColor[] | null>(null,)
	const [syncNotice, setSyncNotice,] = useState('',)
	const [nativeSyncEnabled, setNativeSyncEnabled,] = useState(
		state.config.removalReasons?.nativeSync?.enabled === true,
	)
	const rootRef = useRef<HTMLDivElement>(null,)
	const idCounterRef = useRef(0,)

	const parser = useMemo(() => getRemovalReasonParser(), [],)

	const subreddit = state.subreddit ?? ''

	// Sync status, shown beside the toggle. `lastSyncedAt` only moves when a sync actually
	// changed something, so it is labelled as such; the last-checked time is what shows the
	// sync is alive, and is local to this browser.
	const nativeSync = state.config.removalReasons?.nativeSync
	const lastSyncedAt = nativeSync?.lastSyncedAt
	const syncPersistedOn = nativeSync?.enabled === true
	const [lastCheckedAt, setLastCheckedAt,] = useState<number | undefined>(undefined,)
	const [lastFailure, setLastFailure,] = useState<NativeSyncFailure | undefined>(undefined,)
	// Bumped after every sync run so the two stamps below are re-read. They live in the cache
	// rather than in the config, so a run that just failed - the case this status line exists
	// for - moves them without anything in this component's props changing.
	const [syncStatusNonce, setSyncStatusNonce,] = useState(0,)

	useEffect(() => {
		if (!syncPersistedOn) {
			setLastCheckedAt(undefined,)
			setLastFailure(undefined,)
			return
		}
		let valid = true
		void Promise.all([getLastNativeSyncCheck(subreddit,), getLastNativeSyncFailure(subreddit,),],)
			.then(([checked, failure,],) => {
				if (!valid) { return }
				setLastCheckedAt(checked,)
				setLastFailure(failure,)
			},)
		return () => {
			valid = false
		}
	}, [subreddit, syncPersistedOn, syncStatusNonce,],)

	/** Assigns a stable runtime key to each reason for React/dnd-kit reconciliation. */
	const toEntries = (raw: RemovalReason[],): ReasonEntry[] =>
		raw.map((r,) => ({...r, _key: `reason-${idCounterRef.current++}`,}))

	/**
	 * Runs the native reason sync and folds the result back into the list. Sequenced after
	 * the reasons are loaded so a sync never races the initial read.
	 */
	const runSync = async (force: boolean,) => {
		if (!subreddit) { return }
		const outcome = await syncNativeReasons(subreddit, force ? {force: true,} : undefined,)
		// The run moved the persisted check/failure stamps; re-read them so the status line
		// reflects what just happened rather than what it was at mount.
		setSyncStatusNonce((nonce,) => nonce + 1)
		if (outcome.status === 'synced') {
			const config = await reloadConfigFromWiki(subreddit,)
			if (config) { state.config = config }
			setReasons(toEntries(state.config.removalReasons?.reasons ?? [],),)
			const parts = [
				outcome.added ? `${outcome.added} added` : '',
				outcome.updated ? `${outcome.updated} updated` : '',
				outcome.removed ? `${outcome.removed} removed` : '',
			].filter(Boolean,)
			setSyncNotice(`Synced from Reddit: ${parts.join(', ',)}.`,)
		} else if (force) {
			setSyncNotice(
				outcome.status === 'unchanged'
					? 'Already up to date with Reddit.'
					// Distinct from "up to date": nothing was imported because there is nothing
					// to import. Saying otherwise reads as success and hides the real next step.
					: outcome.status === 'noneUpstream'
					? 'This subreddit has no removal reasons set up on Reddit, so there was nothing to import. '
						+ 'Add them in Reddit\'s mod tools, then sync again.'
					: outcome.status === 'allIgnored'
					? 'Every removal reason from Reddit has been deleted or converted here, so nothing was '
						+ 'imported. Turn the sync above off and back on to start over.'
					: outcome.status === 'redirected'
					? 'This subreddit takes its removal reasons from another subreddit; nothing to sync.'
					: outcome.status === 'disabled'
					? 'Turn on "Import Reddit\'s removal reasons and keep them up to date" above first.'
					: 'Could not reach Reddit\'s removal reasons.',
			)
		}
	}

	useEffect(() => {
		if (document.body.classList.contains('toolbox-wiki-edited',)) {
			void reloadConfigFromWiki(subreddit,).then((config,) => {
				if (!config) { return }
				state.config = config
				setReasons(toEntries(config.removalReasons?.reasons ?? [],),)
				void runSync(false,)
			},)
		} else {
			setReasons(toEntries(state.config.removalReasons?.reasons ?? [],),)
			void runSync(false,)
		}
	}, [],) // eslint-disable-line react-hooks/exhaustive-deps

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
	}, [sorting,],)

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
		const saved = onSave(state.config, note,)
		setReasons(newReasons,)
		return saved
	}

	const handleSaveEdit = (index: number, updated: FormReason, editNote: string,) => {
		const newReasons = [...reasons,]
		const original = reasons[index]!
		// The form rebuilds the reason object from its own state, so anything it does not
		// re-emit would be lost. Drop only the fields the form owns and let the rest ride
		// through untouched - that keeps `nativeReasonId`, `editable`, and any field added
		// to the schema later, without having to remember to carry each one by hand.
		// Form-owned keys must come exclusively from `updated`: the form deliberately omits
		// `removeComments` / `default_note` / `default_note_type` when they are off, and a
		// plain merge over the original would resurrect the previous value instead.
		const preserved: Partial<ReasonEntry> = {...original,}
		for (const key of formOwnedKeys) { delete preserved[key] }
		newReasons[index] = {
			id: original.id ?? generateConfigId(),
			...preserved,
			...updated,
			_key: original._key,
		}
		persistReasons(newReasons, `${editNote || 'update'}, reason #${index + 1}`,)
		setEditingIndex(null,)
	}

	/**
	 * Turns the sync on or off. This tab has no global save button - every other action here
	 * persists as it happens - so the toggle writes immediately rather than waiting.
	 */
	const handleSyncToggle = (enabled: boolean,) => {
		if (!state.config.removalReasons) { return }
		let newReasons = reasons
		if (!enabled) {
			// Turning the sync off takes the imported reasons with it, and clears the whole
			// bookkeeping block rather than just the flag, so re-enabling is a clean full
			// re-import - the only way back for a reason deleted locally and thereby ignored.
			const stripped = stripNativeReasons(reasons,)
			if (
				stripped.removed > 0
				&& !confirm(
					`Turning off syncing will remove ${stripped.removed} imported removal `
						+ `${stripped.removed === 1 ? 'reason' : 'reasons'} from toolbox, along with any flair and `
						+ 'usernote settings you added to them. They are left in place on Reddit. Are you sure?',
				)
			) {
				return
			}
			newReasons = stripped.reasons as ReasonEntry[]
			delete state.config.removalReasons.nativeSync
		} else {
			state.config.removalReasons.nativeSync = {...state.config.removalReasons.nativeSync, enabled: true,}
		}
		setNativeSyncEnabled(enabled,)
		setSyncNotice('',)
		const saved = persistReasons(
			newReasons,
			enabled ? 'turn on Reddit removal reason sync' : 'turn off Reddit removal reason sync',
		)
		// Pull straight away on enable, so the reasons appear without a second click - but only
		// once the write has landed. The sync re-reads the config from the wiki, so starting it
		// first reads the copy from before the toggle and reports that syncing is switched off.
		if (enabled) { void Promise.resolve(saved,).then(() => runSync(true,)) }
	}

	/**
	 * Converts a synced reason into an ordinary toolbox one: drops the link to Reddit so the
	 * wording becomes editable and stops being overwritten, and records the native id as
	 * ignored so the next sync does not simply import it again alongside the copy.
	 */
	const handleDetachNative = (index: number,) => {
		const entry = reasons[index]
		const nativeReasonId = entry?.nativeReasonId
		if (!entry || !nativeReasonId) { return }
		if (
			!confirm(
				'This reason will stop syncing with Reddit. Its title and message become yours to edit, '
					+ 'and later changes in Reddit\'s mod tools will no longer reach it. The Reddit reason '
					+ 'itself is left alone, and will not be imported again. Continue?',
			)
		) { return }

		const nativeSyncState = state.config.removalReasons.nativeSync
		if (nativeSyncState) {
			// Same list the delete path uses: without it the merge sees an unclaimed native id
			// and appends a fresh copy, leaving the moderator with two of the same reason.
			state.config.removalReasons.nativeSync = {
				...nativeSyncState,
				ignored: [...new Set([...nativeSyncState.ignored ?? [], nativeReasonId,],),],
			}
		}
		const {nativeReasonId: _detached, ...detachedReason} = entry
		const newReasons = [...reasons,]
		newReasons[index] = detachedReason as ReasonEntry
		persistReasons(newReasons, `stop syncing reason #${index + 1} with Reddit`,)
	}

	const handleDelete = (index: number,) => {
		const nativeReasonId = reasons[index]?.nativeReasonId
		const prompt = nativeReasonId
			? 'This reason is synced from Reddit. Deleting it here also stops it being re-imported, '
				+ 'but leaves it in place on Reddit. Are you sure?'
			: 'This will delete this removal reason, are you sure?'
		if (!confirm(prompt,)) { return }
		if (nativeReasonId) {
			// Without recording it, the next sync would simply re-import the reason and the
			// delete would appear to undo itself.
			const nativeSync = state.config.removalReasons.nativeSync ?? {}
			state.config.removalReasons.nativeSync = {
				...nativeSync,
				ignored: [...new Set([...nativeSync.ignored ?? [], nativeReasonId,],),],
			}
		}
		const newReasons = reasons.filter((_, i,) => i !== index)
		persistReasons(newReasons, `delete reason #${index + 1}`,)
		if (editingIndex === index) { setEditingIndex(null,) }
	}

	const handleSaveNew = (reason: FormReason, editNote: string,) => {
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
			<div className={css.syncSection}>
				<div className={css.syncRow}>
					<CheckboxInput
						label="Import Reddit's removal reasons and keep them up to date"
						checked={nativeSyncEnabled}
						onChange={(e,) => handleSyncToggle(e.target.checked,)}
					/>
					{nativeSyncEnabled && (
						<div className={css.syncAction}>
							<ActionButton
								type="button"
								title="Re-import this subreddit's removal reasons from Reddit now"
								onClick={() => {
									setSyncNotice('Syncing from Reddit...',)
									void runSync(true,)
								}}
							>
								Sync from Reddit
							</ActionButton>
							<span className={css.syncStatus}>
								{lastSyncedAt
									? `Last imported a change on ${new Date(lastSyncedAt,).toLocaleString()}.`
									: 'Nothing imported yet.'}
								{lastCheckedAt === undefined
									? ''
									: ` Last checked ${formatRelativeTime(new Date(lastCheckedAt,),)}.`}
							</span>
						</div>
					)}
				</div>
				<span className={css.syncHint}>
					From Reddit&apos;s mod tools, under Saved Responses &rarr; Removals - not your community rules. Only
					the imported reasons are kept in step with Reddit; the ones you write here are never touched. Reddit
					owns each imported reason&apos;s title and message, while its flair, usernote defaults and
					post/comment settings stay here. Turning this off removes the imported reasons again, leaving them
					in place on Reddit.
				</span>
				{lastFailure && (
					<p className={css.syncFailure}>
						{lastFailure.stage === 'fetch'
							? 'Could not read Reddit\'s removal reasons'
							: 'Could not save the reasons imported from Reddit'}{' '}
						{formatRelativeTime(new Date(lastFailure.at,),)}: {lastFailure.message}.{' '}
						{lastFailure.stage === 'save'
							? 'Toolbox has stopped retrying for now; if this is a permissions problem, ask for the "wiki" moderator permission.'
							: 'Toolbox will try again shortly.'} Press <strong>Sync from Reddit</strong>{' '}
						above to retry immediately.
					</p>
				)}
			</div>
			{syncNotice && <div className={css.syncNotice}>{syncNotice}</div>}
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
								onDetachNative={() => handleDetachNative(i,)}
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
