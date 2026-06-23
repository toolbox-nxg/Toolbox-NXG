/**
 * Config tab for mapping report reasons to removal reasons ("suggested removal reasons").
 * Each mapping matches a report (AutoMod/other bot or, optionally, a user report) and
 * pre-selects the chosen removal reason(s) in the removal overlay. Mappings render as
 * collapsed cards (showing the match, the reasons it suggests, and whether user reports
 * are matched) and save individually - like the "Edit removal reasons" / "Edit mod macros"
 * tabs - with the footer hosting an "Add new suggestion" button.
 */

import {useEffect, useMemo, useRef, useState,} from 'react'

import {readFromWiki,} from '../../../api/resources/wiki'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {Icon,} from '../../../shared/controls/Icon'
import {TextInput,} from '../../../shared/controls/NormalInput'
import {generateConfigId,} from '../../../util/wiki/schemas/config/schema'
import type {ConfigState, ToolboxConfig,} from '../../../util/wiki/schemas/config/schema'
import {parseAutomodReasons, staticReasonPart,} from '../automodReasons'
import type {RemovalReason, SuggestedReasonMapping,} from '../schema'
import css from './SuggestedReasonsTab.module.css'

/** Load state of the subreddit's AutoMod report reasons. */
type AutomodLoad = 'loading' | 'ok' | 'error'

/** Ref whose `.current` is called by the parent (footer) to open the add-mapping form. */
type AddRef = {current: (() => void) | null}
/** Ref whose `.current` toggles external controls (the add button) while the add form is open. */
type DisabledRef = {current: ((disabled: boolean,) => void) | null}

/** A committed mapping plus a stable runtime key for React reconciliation; the key is never persisted. */
interface MappingEntry {
	_key: string
	id?: string
	pattern: string
	includeUserReports: boolean
	reasonIds: string[]
}

/** Editable field values for a single mapping, shared by the add and edit forms. */
interface MappingFormValues {
	pattern: string
	includeUserReports: boolean
	reasonIds: string[]
}

/** Props for the SuggestedReasonsTab component. */
interface Props {
	/** Config state object for the current subreddit. */
	state: ConfigState
	/** Optional ref wired up so the parent footer can open the add-mapping form. */
	addRef?: AddRef
	/** Optional ref wired up so the parent can disable the add button while the add form is open. */
	disabledRef?: DisabledRef
	/** Called with the updated config and revision note when a mapping is saved or deleted. */
	onSave: (config: ToolboxConfig, reason: string,) => void
}

/** Builds the initial committed entries from the stored mapping list. */
function toEntries (mappings: SuggestedReasonMapping[], nextKey: () => string,): MappingEntry[] {
	return mappings.map((mapping,) => ({
		_key: nextKey(),
		...(mapping.id ? {id: mapping.id,} : {}),
		pattern: mapping.pattern,
		includeUserReports: !!mapping.includeUserReports,
		reasonIds: [...mapping.reasonIds,],
	}))
}

/** Shared add/edit form for a single mapping; holds its own draft state until saved. */
function MappingForm ({
	initialValues,
	reasons,
	automodReasons,
	saveLabel,
	onSave,
	onCancel,
}: {
	initialValues: MappingFormValues
	reasons: RemovalReason[]
	automodReasons: string[]
	saveLabel: string
	onSave: (values: MappingFormValues,) => void
	onCancel: () => void
},) {
	const [pattern, setPattern,] = useState(initialValues.pattern,)
	const [includeUserReports, setIncludeUserReports,] = useState(initialValues.includeUserReports,)
	const [reasonIds, setReasonIds,] = useState<string[]>(initialValues.reasonIds,)

	function toggleReason (reasonId: string, checked: boolean,) {
		setReasonIds((current,) => (checked ? [...current, reasonId,] : current.filter((id,) => id !== reasonId)))
	}

	const canSave = pattern.trim() !== '' && reasonIds.filter((id,) => id !== '').length > 0

	return (
		<div className={css.cardBody}>
			<label className={css.field}>
				<span className={css.fieldLabel}>When a report contains</span>
				<div className={css.patternRow}>
					<TextInput
						type="text"
						value={pattern}
						placeholder="e.g. low effort post"
						onChange={(e,) => setPattern(e.target.value,)}
					/>
					{automodReasons.length > 0 && (
						<select
							className={css.automodSelect}
							value=""
							onChange={(e,) => {
								// Insert the reason's static text (placeholders dropped) so it matches the
								// substituted report text shown in the queue.
								if (e.target.value) { setPattern(staticReasonPart(e.target.value,),) }
							}}
						>
							<option value="">Insert from AutoMod…</option>
							{automodReasons.map((reason,) => <option key={reason} value={reason}>{reason}</option>)}
						</select>
					)}
				</div>
			</label>

			<CheckboxInput
				label="Also match user reports"
				checked={includeUserReports}
				onChange={(e,) => setIncludeUserReports(e.target.checked,)}
			/>
			<p className={css.fieldHint}>
				Mod and bot reports always match. Enable this to also match reports filed by users (both rule selections
				and free-text reports).
			</p>

			<div className={css.reasonListLabel}>Suggest these removal reason(s):</div>
			<div className={css.reasonList}>
				{reasons.length === 0
					? <span className={css.empty}>No removal reasons configured.</span>
					: reasons.map((reason,) => {
						const id = reason.id ?? ''
						if (!id) { return null }
						return (
							<CheckboxInput
								key={id}
								label={reason.title || '(untitled reason)'}
								checked={reasonIds.includes(id,)}
								onChange={(e,) => toggleReason(id, e.target.checked,)}
							/>
						)
					},)}
			</div>

			<div className={css.editButtons}>
				<ActionButton
					primary
					type="button"
					disabled={!canSave}
					onClick={() => onSave({pattern, includeUserReports, reasonIds,},)}
				>
					{saveLabel}
				</ActionButton>
				<ActionButton type="button" onClick={onCancel}>Cancel</ActionButton>
			</div>
		</div>
	)
}

/** Blank values for the add-mapping form. */
const emptyMappingValues: MappingFormValues = {pattern: '', includeUserReports: false, reasonIds: [],}

/** Renders the suggested-reasons mapping editor within the toolbox subreddit config overlay. */
export function SuggestedReasonsTab ({state, addRef, disabledRef, onSave,}: Props,) {
	const rr = state.config.removalReasons ?? {}
	const reasons: RemovalReason[] = Array.isArray(rr.reasons,) ? rr.reasons : []
	const reasonTitleById = useMemo(
		() => new Map(reasons.filter((reason,) => reason.id).map((reason,) => [reason.id as string, reason.title,]),),
		[reasons,],
	)

	const keyCounter = useRef(0,)
	const nextKey = () => `mapping-${keyCounter.current++}`
	const [entries, setEntries,] = useState<MappingEntry[]>(() => toEntries(rr.suggestedReasons ?? [], nextKey,))
	// Which mapping card is expanded for editing (`null` = none), and whether the add form is open.
	const [editingKey, setEditingKey,] = useState<string | null>(null,)
	const [showAddForm, setShowAddForm,] = useState(false,)

	// Report reasons pulled from the subreddit's AutoMod config, offered as a pick-list on each
	// pattern field. Best-effort: a missing page or read error surfaces a note rather than failing.
	const [automodReasons, setAutomodReasons,] = useState<string[]>([],)
	const [automodLoad, setAutomodLoad,] = useState<AutomodLoad>('loading',)
	useEffect(() => {
		const subreddit = state.subreddit
		if (!subreddit) {
			setAutomodLoad('error',)
			return
		}
		let cancelled = false
		setAutomodLoad('loading',)
		void readFromWiki(subreddit, 'config/automoderator',).then((result,) => {
			if (cancelled) { return }
			if (result.ok) {
				setAutomodReasons(parseAutomodReasons(result.data,),)
				setAutomodLoad('ok',)
			} else {
				setAutomodLoad('error',)
			}
		},)
		return () => {
			cancelled = true
		}
	}, [state.subreddit,],)

	// Expose the add action to the footer's "Add new suggestion" button, and keep that button
	// disabled while the add form is already open (mirrors the removal-reasons / macros tabs).
	const handleAddRef = useRef<() => void>(() => {},)
	handleAddRef.current = () => {
		setEditingKey(null,)
		setShowAddForm(true,)
	}
	useEffect(() => {
		if (!addRef) { return }
		addRef.current = () => handleAddRef.current()
		return () => {
			addRef.current = null
		}
	}, [],) // eslint-disable-line react-hooks/exhaustive-deps
	useEffect(() => {
		disabledRef?.current?.(showAddForm,)
	}, [showAddForm,],) // eslint-disable-line react-hooks/exhaustive-deps

	// Serializes the full mapping list to config and pushes it upstream. The whole list is written
	// each time (the wiki stores one object), but the trigger and revision note are per-mapping.
	function persistEntries (newEntries: MappingEntry[], note: string,) {
		const mappings: SuggestedReasonMapping[] = []
		for (const entry of newEntries) {
			const pattern = entry.pattern.trim()
			const reasonIds = entry.reasonIds.filter((id,) => id !== '')
			if (!pattern || reasonIds.length === 0) { continue }
			const mapping: SuggestedReasonMapping = {pattern, reasonIds,}
			if (entry.id) { mapping.id = entry.id }
			if (entry.includeUserReports) { mapping.includeUserReports = true }
			mappings.push(mapping,)
		}
		state.config.removalReasons = {
			...rr,
			reasons,
			...(mappings.length ? {suggestedReasons: mappings,} : {}),
		}
		if (!mappings.length) { delete state.config.removalReasons.suggestedReasons }
		onSave(state.config, note,)
		setEntries(newEntries,)
	}

	function handleSaveEdit (key: string, values: MappingFormValues, index: number,) {
		const newEntries = entries.map((entry,) =>
			entry._key === key
				? {...entry, ...values, id: entry.id ?? generateConfigId(),}
				: entry
		)
		persistEntries(newEntries, `update suggested mapping #${index + 1}`,)
		setEditingKey(null,)
	}

	function handleSaveNew (values: MappingFormValues,) {
		const newEntries = [...entries, {_key: nextKey(), id: generateConfigId(), ...values,},]
		persistEntries(newEntries, 'add suggested mapping',)
		setShowAddForm(false,)
	}

	function handleDelete (key: string, index: number,) {
		if (!confirm('This will delete this suggested mapping, are you sure?',)) { return }
		persistEntries(entries.filter((entry,) => entry._key !== key), `delete suggested mapping #${index + 1}`,)
		setEditingKey((current,) => (current === key ? null : current))
	}

	/** The selected reasons' titles, for the collapsed summary. */
	function selectedReasonTitles (entry: MappingEntry,): string[] {
		return entry.reasonIds
			.filter((id,) => id !== '')
			.map((id,) => reasonTitleById.get(id,) || '(untitled reason)')
	}

	return (
		<div id="toolbox-suggested-reasons" className={css.root}>
			<p className={css.intro}>
				Map report text to removal reasons so the matched reasons are pre-selected when you open the removal
				overlay on a queue item. Reports from any moderator or bot (AutoMod is the common case) are matched by
				default; enable “Also match user reports” on a mapping to include user reports as well.
			</p>

			{automodLoad === 'loading' && (
				<p className={css.automodNote}>Loading report reasons from your AutoMod config…</p>
			)}
			{automodLoad === 'error' && (
				<p className={css.automodNote}>
					Couldn&apos;t read your AutoMod config — type the reason text manually.
				</p>
			)}
			{automodLoad === 'ok' && automodReasons.length === 0 && (
				<p className={css.automodNote}>
					No <code>action: report</code> rules with an <code>action_reason</code>{' '}
					were found in your AutoMod config — type the reason text manually.
				</p>
			)}

			{reasons.length === 0 && (
				<p className={css.empty}>
					Add removal reasons first (in the &quot;Edit removal reasons&quot; tab) so you can map reports to
					them.
				</p>
			)}

			<div className={css.cardList}>
				{entries.map((entry, index,) => {
					const isEditing = editingKey === entry._key
					const titles = selectedReasonTitles(entry,)
					return (
						<div key={entry._key} className={css.card}>
							<div className={css.cardHeader}>
								<span className={css.cardTitle}>
									{entry.pattern.trim() || <em className={css.untitled}>Untitled</em>}
								</span>
								<div className={css.cardActions}>
									<button
										type="button"
										className={`${css.iconButton} ${isEditing ? css.iconButtonActive : ''}`}
										title={isEditing ? 'Close editor' : 'Edit'}
										onClick={() => setEditingKey(isEditing ? null : entry._key,)}
									>
										<Icon icon={isEditing ? 'close' : 'edit'} />
									</button>
									<button
										type="button"
										className={css.iconButton}
										title="Remove this mapping"
										onClick={() => handleDelete(entry._key, index,)}
									>
										<Icon icon="delete" mood="negative" />
									</button>
								</div>
							</div>

							{isEditing
								? (
									<MappingForm
										initialValues={entry}
										reasons={reasons}
										automodReasons={automodReasons}
										saveLabel="Save mapping"
										onSave={(values,) => handleSaveEdit(entry._key, values, index,)}
										onCancel={() => setEditingKey(null,)}
									/>
								)
								: (
									<div className={css.summary}>
										<div className={css.summaryRow}>
											<span className={css.summaryLabel}>Suggests</span>
											<span>
												{titles.length
													? titles.join(', ',)
													: <em className={css.untitled}>no reasons selected</em>}
											</span>
										</div>
										<div className={css.summaryRow}>
											<span className={css.summaryLabel}>Matches</span>
											<span>
												mod &amp; bot reports{entry.includeUserReports ? ' + user reports' : ''}
											</span>
										</div>
									</div>
								)}
						</div>
					)
				},)}
			</div>

			{showAddForm && (
				<div className={`${css.card} ${css.addCard}`}>
					<div className={css.cardHeader}>
						<span className={css.cardTitle}>New mapping</span>
					</div>
					<MappingForm
						initialValues={emptyMappingValues}
						reasons={reasons}
						automodReasons={automodReasons}
						saveLabel="Save new mapping"
						onSave={handleSaveNew}
						onCancel={() => setShowAddForm(false,)}
					/>
				</div>
			)}
		</div>
	)
}
