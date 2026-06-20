/**
 * Config tab for mapping report reasons to removal reasons ("suggested removal reasons").
 * Each mapping matches a report (AutoMod/other bot or, optionally, a user report) and
 * pre-selects the chosen removal reason(s) in the overlay - and, when one-click is enabled,
 * exposes a one-click apply button on matching queue items.
 */

import {useEffect, useRef, useState,} from 'react'

import {readFromWiki,} from '../../../api/resources/wiki'
import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {EnforcementModeRadio,} from '../../../shared/controls/EnforcementModeRadio'
import {TextInput,} from '../../../shared/controls/NormalInput'
import {positiveTextFeedback,} from '../../../store/feedback'
import {type SaveRef, useSaveRef,} from '../../../util/ui/hooks'
import type {ConfigState,} from '../../../util/wiki/schemas/config/schema'
import {parseAutomodReasons, staticReasonPart,} from '../automodReasons'
import type {RemovalReason, SuggestedReasonMapping,} from '../schema'
import css from './SuggestedReasonsTab.module.css'

/** Load state of the subreddit's AutoMod report reasons. */
type AutomodLoad = 'loading' | 'ok' | 'error'

/** A mapping row in local editor state, with a stable React key. */
interface RowState {
	key: string
	id?: string
	pattern: string
	matchType: 'substring' | 'regex'
	reporter: string
	includeUserReports: boolean
	reasonIds: string[]
	oneClick: boolean
}

/** Props for the SuggestedReasonsTab component. */
interface Props {
	/** Config state object for the current subreddit. */
	state: ConfigState
	/** Optional ref wired up so the parent can trigger saving. */
	saveRef?: SaveRef
	/** Called with the updated config and revision note when the user saves. */
	onSave: (config: any, reason: string,) => void
}

/** Builds the initial editor rows from the stored mapping list. */
function toRows (mappings: SuggestedReasonMapping[], nextKey: () => string,): RowState[] {
	return mappings.map((mapping,) => ({
		key: nextKey(),
		...(mapping.id ? {id: mapping.id,} : {}),
		pattern: mapping.pattern,
		matchType: mapping.matchType === 'regex' ? 'regex' : 'substring',
		reporter: mapping.reporter ?? '',
		includeUserReports: !!mapping.includeUserReports,
		reasonIds: [...mapping.reasonIds,],
		oneClick: !!mapping.oneClick,
	}))
}

/** Renders the suggested-reasons mapping editor within the toolbox subreddit config overlay. */
export function SuggestedReasonsTab ({state, saveRef, onSave,}: Props,) {
	const rr = state.config.removalReasons ?? {}
	const reasons: RemovalReason[] = Array.isArray(rr.reasons,) ? rr.reasons : []

	const keyCounter = useRef(0,)
	const nextKey = () => `row-${keyCounter.current++}`
	const [rows, setRows,] = useState<RowState[]>(() => toRows(rr.suggestedReasons ?? [], nextKey,))

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

	function updateRow (key: string, patch: Partial<RowState>,) {
		setRows((current,) => current.map((row,) => (row.key === key ? {...row, ...patch,} : row)))
	}

	function addRow () {
		setRows((current,) => [
			...current,
			{
				key: nextKey(),
				pattern: '',
				matchType: 'substring',
				reporter: '',
				includeUserReports: false,
				reasonIds: [],
				oneClick: false,
			},
		])
	}

	function removeRow (key: string,) {
		setRows((current,) => current.filter((row,) => row.key !== key))
	}

	function toggleReason (key: string, reasonId: string, checked: boolean,) {
		setRows((current,) =>
			current.map((row,) => {
				if (row.key !== key) { return row }
				const reasonIds = checked
					? [...row.reasonIds, reasonId,]
					: row.reasonIds.filter((id,) => id !== reasonId)
				return {...row, reasonIds,}
			},)
		)
	}

	function handleSave () {
		if (!state.subreddit) { return }
		const mappings: SuggestedReasonMapping[] = []
		for (const row of rows) {
			const pattern = row.pattern.trim()
			const reasonIds = row.reasonIds.filter((id,) => id !== '')
			if (!pattern || reasonIds.length === 0) { continue }
			const mapping: SuggestedReasonMapping = {pattern, reasonIds,}
			if (row.id) { mapping.id = row.id }
			if (row.matchType === 'regex') { mapping.matchType = 'regex' }
			if (row.reporter.trim()) { mapping.reporter = row.reporter.trim() }
			if (row.includeUserReports) { mapping.includeUserReports = true }
			if (row.oneClick) { mapping.oneClick = true }
			mappings.push(mapping,)
		}
		state.config.removalReasons = {
			...rr,
			reasons,
			...(mappings.length ? {suggestedReasons: mappings,} : {}),
		}
		if (!mappings.length) { delete state.config.removalReasons.suggestedReasons }
		onSave(state.config, 'updated suggested removal reasons',)
		positiveTextFeedback('Suggested removal reasons are saved',)
	}
	useSaveRef(saveRef, handleSave,)

	return (
		<div id="toolbox-suggested-reasons">
			<p className={css.intro}>
				Map report reasons to removal reasons so they're pre-selected (and optionally one-click removable) in
				the queue. AutoMod is the common case, but any reporter's text can match.
			</p>

			{automodLoad === 'loading' && (
				<p className={css.automodNote}>Loading report reasons from your AutoMod config…</p>
			)}
			{automodLoad === 'error' && (
				<p className={css.automodNote}>Couldn't read your AutoMod config — type the reason text manually.</p>
			)}
			{automodLoad === 'ok' && automodReasons.length === 0 && (
				<p className={css.automodNote}>
					No <code>action: report</code> rules with an <code>action_reason</code>{' '}
					were found in your AutoMod config — type the reason text manually.
				</p>
			)}

			{reasons.length === 0 && (
				<p className={css.empty}>
					Add removal reasons first (in the "Edit removal reasons" tab) so you can map reports to them.
				</p>
			)}

			{rows.map((row, index,) => (
				<div key={row.key} className={css.mappingCard}>
					<div className={css.mappingHeader}>
						<span>Mapping {index + 1}</span>
						<button
							type="button"
							className={css.deleteButton}
							title="Remove this mapping"
							onClick={() => removeRow(row.key,)}
						>
							🗑
						</button>
					</div>

					<label className={css.field}>
						<span className={css.fieldLabel}>When a report matches</span>
						<TextInput
							type="text"
							value={row.pattern}
							placeholder="e.g. low effort post"
							onChange={(e,) => updateRow(row.key, {pattern: e.target.value,},)}
						/>
						{automodReasons.length > 0 && (
							<select
								className={css.automodSelect}
								value=""
								onChange={(e,) => {
									// Insert the reason's static text (placeholders dropped) so it matches the
									// substituted report text shown in the queue.
									if (e.target.value) {
										updateRow(row.key, {pattern: staticReasonPart(e.target.value,),},)
									}
								}}
							>
								<option value="">Insert from AutoMod…</option>
								{automodReasons.map((reason,) => <option key={reason} value={reason}>{reason}</option>)}
							</select>
						)}
					</label>

					<div className={css.inlineRow}>
						<EnforcementModeRadio
							name={`match-type-${row.key}`}
							options={[
								{val: 'substring', label: 'Contains text',},
								{val: 'regex', label: 'Regex',},
							]}
							value={row.matchType}
							onChange={(value,) =>
								updateRow(row.key, {matchType: value === 'regex' ? 'regex' : 'substring',},)}
						/>
					</div>

					<label className={css.field}>
						<span className={css.fieldLabel}>Reporter (optional — any mod if blank)</span>
						<TextInput
							type="text"
							value={row.reporter}
							placeholder="e.g. AutoModerator"
							onChange={(e,) => updateRow(row.key, {reporter: e.target.value,},)}
						/>
					</label>

					<CheckboxInput
						label="Also match free-text user reports"
						checked={row.includeUserReports}
						onChange={(e,) => updateRow(row.key, {includeUserReports: e.target.checked,},)}
					/>

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
										checked={row.reasonIds.includes(id,)}
										onChange={(e,) => toggleReason(row.key, id, e.target.checked,)}
									/>
								)
							},)}
					</div>

					<CheckboxInput
						label="Show a one-click &quot;Apply&quot; button on matching queue items"
						checked={row.oneClick}
						onChange={(e,) => updateRow(row.key, {oneClick: e.target.checked,},)}
					/>
				</div>
			))}

			<button type="button" onClick={addRow}>+ Add mapping</button>
		</div>
	)
}
