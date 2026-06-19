/** Settings tab for managing a subreddit's domain tags: add, edit, remove, and import from another subreddit. */
import {useCallback, useEffect, useRef, useState,} from 'react'

import {ActionButton,} from '../../../shared/controls/ActionButton'
import {Icon,} from '../../../shared/controls/Icon'
import {TextInput,} from '../../../shared/controls/NormalInput'
import {colorNameToHex, getBestTextColor,} from '../../../util/data/color'
import {defaultDomainTagsData,} from '../../../util/wiki/schemas/domaintags/schema'
import {fetchDomainTagsFromSubreddit, getDomainTagsData, saveDomainTagsData,} from '../moduleapi'
import type {DomainTag, DomainTagsData,} from '../schema'
import css from './DomainTagsTab.module.css'

/** A ref whose `.current` holds a function the parent settings dialog calls when a footer button is clicked. */
type SaveRef = {current: (() => void) | null}

/** Internal editing representation of a domain tag row, augmented with UI state. */
interface TagRow {
	/** Stable client-side ID used as the React list key (domains may be edited/duplicated mid-edit). */
	id: string
	/** The domain name or glob pattern (e.g. `i.imgur.com`, `*.blogspot.com`). */
	name: string
	/** The tag color as a hex string (the `<input type="color">` requires hex). */
	color: string
	/** Optional free-text note. */
	note: string
	/** Optional removal-rate alert threshold (0-100), as a string for the number input. */
	threshold: string
	/** True when this row failed validation on the last save attempt. */
	error: boolean
}

/**
 * Builds editor rows from stored {@link DomainTag}s, normalizing colors to hex for the color input.
 * @param tags The stored domain tags to convert.
 * @param makeId Generates a stable client-side row ID for each row's React key.
 */
function toRows (tags: DomainTag[], makeId: () => string,): TagRow[] {
	return tags.map((tag,) => ({
		id: makeId(),
		name: tag.name,
		color: colorNameToHex(tag.color,),
		note: tag.note ?? '',
		threshold: tag.removalThreshold !== undefined ? String(tag.removalThreshold,) : '',
		error: false,
	}))
}

/** Props for the DomainTagsTab component. */
interface Props {
	/** The subreddit whose domain tags are being managed. */
	subreddit: string
	/** Ref through which the parent footer triggers a save of the edited tag list and settings. */
	saveRef?: SaveRef
	/** Ref through which the parent footer triggers loading tags from another subreddit. */
	importRef?: SaveRef
}

/**
 * Renders the Domain Tags settings tab: a toggle for the count indicator display, an
 * editable table of the subreddit's domain tags with add/remove controls, plus an import
 * field for loading tags from another subreddit into the editor.
 *
 * Loads and saves its own {@link DomainTagsData} independently of the main toolbox config,
 * since domain tags now live on a dedicated wiki page (`toolbox-nxg/domain-tags`).
 */
export function DomainTagsTab ({subreddit, saveRef, importRef,}: Props,) {
	const [importFrom, setImportFrom,] = useState('',)
	const [sourceData, setSourceData,] = useState<DomainTagsData>(defaultDomainTagsData,)
	const [showCounts, setShowCounts,] = useState(false,)
	const [rows, setRows,] = useState<TagRow[]>([],)

	// Per-instance monotonic counter for stable row keys (TagRow.id is React-key-only,
	// never persisted), kept in a ref so re-renders don't reset it. Memoized so it's a
	// stable dependency for the load effect below.
	const idCounterRef = useRef(0,)
	const makeId = useCallback(() => `dtag-${idCounterRef.current++}`, [],)

	// Load domain tags data on mount.
	useEffect(() => {
		let active = true
		getDomainTagsData(subreddit,).then((data,) => {
			if (!active) { return }
			setSourceData(data,)
			setShowCounts(data.showCounts,)
			setRows(toRows(data.tags, makeId,),)
		},).catch(() => {},)
		return () => {
			active = false
		}
	}, [subreddit, makeId,],)

	// Keep refs to the live values so the save/import callbacks registered once below always
	// operate on the latest editor state rather than a stale closure capture.
	const rowsRef = useRef(rows,)
	rowsRef.current = rows
	const showCountsRef = useRef(showCounts,)
	showCountsRef.current = showCounts
	const sourceDataRef = useRef(sourceData,)
	sourceDataRef.current = sourceData
	const importFromRef = useRef(importFrom,)
	importFromRef.current = importFrom

	const updateName = (index: number, name: string,) => {
		setRows((prev,) => prev.map((r, i,) => i === index ? {...r, name, error: false,} : r))
	}
	const updateColor = (index: number, color: string,) => {
		setRows((prev,) => prev.map((r, i,) => i === index ? {...r, color,} : r))
	}
	const updateNote = (index: number, note: string,) => {
		setRows((prev,) => prev.map((r, i,) => i === index ? {...r, note,} : r))
	}
	const updateThreshold = (index: number, threshold: string,) => {
		setRows((prev,) => prev.map((r, i,) => i === index ? {...r, threshold,} : r))
	}
	const removeRow = (index: number,) => {
		setRows((prev,) => prev.filter((_, i,) => i !== index))
	}
	const addRow = () => {
		setRows((prev,) => [
			...prev,
			{id: makeId(), name: '', color: '#cee3f8', note: '', threshold: '', error: false,},
		])
	}

	async function handleImport () {
		if (!importFromRef.current) { return }
		const imported = await fetchDomainTagsFromSubreddit(importFromRef.current,)
		if (imported) {
			setRows(toRows(imported, makeId,),)
		}
	}

	function handleSave () {
		// Validate: every row needs a non-empty domain, and domains must be unique. Trim first
		// so stray whitespace can't create a "different" duplicate or an effectively-empty name.
		const seen = new Set<string>()
		let hasError = false
		const validated = rowsRef.current.map((r,) => {
			const name = r.name.trim()
			const error = !name || seen.has(name,)
			if (error) { hasError = true }
			else { seen.add(name,) }
			return {...r, name, error,}
		},)
		setRows(validated,)
		if (hasError) { return }

		const data = sourceDataRef.current
		const tags: DomainTag[] = validated.map((r,) => {
			// Preserve existing approval/removal counts from the loaded data; saving from the
			// settings tab must not reset counts accumulated over time.
			const existing = data.tags.find((t,) => t.name === r.name)
			const parsedThreshold = r.threshold !== '' ? parseInt(r.threshold, 10,) : undefined
			const tag: DomainTag = {
				name: r.name,
				color: r.color,
				approvalCount: existing?.approvalCount ?? 0,
				removalCount: existing?.removalCount ?? 0,
			}
			if (r.note) { tag.note = r.note }
			if (parsedThreshold !== undefined && !isNaN(parsedThreshold,)) { tag.removalThreshold = parsedThreshold }
			return tag
		},)

		const updated: DomainTagsData = {
			ver: data.ver,
			showCounts: showCountsRef.current,
			tags,
		}

		void saveDomainTagsData(subreddit, updated, 'updated domain tags',)
	}

	useEffect(() => {
		if (saveRef) { saveRef.current = () => handleSave() }
		if (importRef) { importRef.current = () => void handleImport() }
		return () => {
			if (saveRef) { saveRef.current = null }
			if (importRef) { importRef.current = null }
		}
	}, [],)

	return (
		<div className={css.root}>
			<div className={css.importField}>
				<label className={css.fieldLabel} htmlFor="domain-import-from">
					Import domain tags from /r/:
				</label>
				<TextInput
					id="domain-import-from"
					type="text"
					value={importFrom}
					onChange={(e,) => setImportFrom(e.target.value,)}
				/>
				<span className={css.fieldHint}>
					Requires wiki mod access in the import source. The import button in the footer loads its tags into
					the table below, replacing the current list; nothing is saved until you click Save.
				</span>
			</div>

			<label className={css.toggleRow}>
				<input
					type="checkbox"
					checked={showCounts}
					onChange={(e,) => setShowCounts(e.target.checked,)}
				/>
				Show approval/removal counts in domain tag indicators
			</label>

			<div className={css.preview}>
				<div className={css.previewTitle}>Domain tags</div>
				{rows.length === 0
					? <p className={css.noTags}>No domain tags configured for this subreddit yet.</p>
					: (
						<table className={css.previewTable}>
							<thead>
								<tr>
									<th>Domain</th>
									<th>Color</th>
									<th>Note</th>
									<th title="Removal-rate alert threshold (0–100%)">Alert&nbsp;%</th>
									<th>Preview</th>
									<th>▲&nbsp;App.</th>
									<th>▼&nbsp;Rem.</th>
									<th className={css.actionCol} />
								</tr>
							</thead>
							<tbody>
								{rows.map((row, i,) => {
									const existing = sourceData.tags.find((t,) => t.name === row.name)
									const textColor = getBestTextColor(row.color,)
									return (
										<tr key={row.id}>
											<td>
												<TextInput
													className={row.error ? css.inputError : undefined}
													type="text"
													placeholder="e.g. i.imgur.com or *.blogspot.com"
													value={row.name}
													onChange={(e,) => updateName(i, e.target.value,)}
												/>
											</td>
											<td>
												<input
													type="color"
													className={css.colorPicker}
													value={row.color}
													onChange={(e,) => updateColor(i, e.target.value,)}
												/>
											</td>
											<td>
												<TextInput
													type="text"
													placeholder="Optional note..."
													value={row.note}
													onChange={(e,) => updateNote(i, e.target.value,)}
												/>
											</td>
											<td>
												<input
													type="number"
													className={css.thresholdInput}
													placeholder="-"
													min={0}
													max={100}
													value={row.threshold}
													onChange={(e,) => updateThreshold(i, e.target.value,)}
												/>
											</td>
											<td>
												<span
													className={css.tagPill}
													style={{backgroundColor: row.color, color: textColor,}}
													title={row.note || undefined}
												>
													{row.name || 'preview'}
												</span>
											</td>
											<td className={css.countCell}>{existing?.approvalCount ?? 0}</td>
											<td className={css.countCell}>{existing?.removalCount ?? 0}</td>
											<td className={css.actionCol}>
												<button
													type="button"
													className={css.deleteButton}
													onClick={() => removeRow(i,)}
													title="Remove domain tag"
												>
													<Icon icon="delete" mood="negative" />
												</button>
											</td>
										</tr>
									)
								},)}
							</tbody>
						</table>
					)}
				<ActionButton type="button" onClick={addRow}>
					<Icon icon="addCircle" />
					Add domain tag
				</ActionButton>
			</div>
		</div>
	)
}
