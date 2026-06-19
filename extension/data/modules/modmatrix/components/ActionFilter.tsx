/** Hierarchical checkbox panel for filtering which mod-log action types are shown in the matrix. */

import {useEffect, useRef, useState,} from 'react'
import {isFilterItemChecked, toggleFilterItem,} from '../filterUtils'
import css from '../modmatrix.module.css'
import type {ActionInfo, GroupDef,} from '../schema'
import {actionGroups,} from '../schema'

/** Props for the {@link ActionFilter} component. */
interface Props {
	/** All action types available in the subreddit's mod log, keyed by action code. */
	subredditActions: Record<string, ActionInfo>
	/** Currently active filter: `null` means "all visible", an array means only those codes are shown. */
	actionFilter: string[] | null
	/** Called whenever the filter selection changes. */
	onChange: (filter: string[] | null,) => void
}

/**
 * A checkbox that also supports the indeterminate (partially-checked) visual state.
 * @param indeterminate When true the checkbox is rendered in the indeterminate state.
 */
function GroupCheckbox ({id, checked, indeterminate, onChange,}: {
	id: string
	checked: boolean
	indeterminate: boolean
	onChange: (checked: boolean,) => void
},) {
	const ref = useRef<HTMLInputElement>(null,)
	useEffect(() => {
		if (ref.current) { ref.current.indeterminate = indeterminate }
	}, [indeterminate,],)
	return (
		<input
			ref={ref}
			type="checkbox"
			id={id}
			checked={checked}
			onChange={(e,) => onChange(e.target.checked,)}
		/>
	)
}

/**
 * Renders a collapsible tree of checkboxes for filtering the displayed action columns.
 *
 * Actions are grouped by the top-level categories defined in {@link actionGroups}; actions that
 * do not belong to any known group are collected under "Other".
 */
export function ActionFilter ({subredditActions, actionFilter, onChange,}: Props,) {
	const [showGroups, setShowGroups,] = useState(false,)
	const [expandedGroups, setExpandedGroups,] = useState<Set<string>>(new Set(),)

	const allCodes = Object.keys(subredditActions,)

	const titleToCode = new Map<string, string>()
	for (const [code, info,] of Object.entries(subredditActions,)) {
		titleToCode.set(info.title.toLowerCase(), code,)
	}

	function titlesToCodes (titles: string[],): string[] {
		return titles.flatMap((t,) => {
			const code = titleToCode.get(t.toLowerCase(),)
			return code !== undefined ? [code,] : []
		},)
	}

	function allGroupTitles (group: GroupDef,): string[] {
		return [...(group.items ?? []), ...(group.subs ?? []).flatMap((s,) => s.items),]
	}

	function isChecked (code: string,): boolean {
		return isFilterItemChecked(actionFilter, code,)
	}
	function areAllChecked (codes: string[],): boolean {
		return codes.length === 0 || codes.every((c,) => isChecked(c,))
	}
	function isPartiallyChecked (codes: string[],): boolean {
		return codes.some((c,) => isChecked(c,)) && !codes.every((c,) => isChecked(c,))
	}

	function toggleCodes (codes: string[], checkAll: boolean,) {
		if (checkAll) {
			if (actionFilter === null) { return }
			const next = [...new Set([...actionFilter, ...codes,],),]
			onChange(next.length === allCodes.length ? null : next,)
		} else {
			const base = actionFilter === null ? [...allCodes,] : [...actionFilter,]
			onChange(base.filter((c,) => !codes.includes(c,)),)
		}
	}

	function handleItemToggle (code: string, checked: boolean,) {
		onChange(toggleFilterItem(actionFilter, allCodes, code, checked,),)
	}

	function toggleExpanded (key: string,) {
		setExpandedGroups((prev,) => {
			const next = new Set(prev,)
			if (next.has(key,)) { next.delete(key,) }
			else { next.add(key,) }
			return next
		},)
	}

	const categorizedCodes = new Set(
		actionGroups.flatMap((g,) => titlesToCodes(allGroupTitles(g,),)),
	)
	const otherCodes = allCodes.filter((c,) => !categorizedCodes.has(c,))

	return (
		<div className={css.actionFilterSection}>
			<div className={css.actionFilterBody}>
				<div className={css.actionFilterAllRow}>
					<button
						type="button"
						className={css.filterGroupChevron}
						onClick={() => setShowGroups((v,) => !v)}
						aria-expanded={showGroups}
					>
						{showGroups ? '▾' : '▸'}
					</button>
					<GroupCheckbox
						id="mm-actionfilter-all"
						checked={actionFilter === null}
						indeterminate={actionFilter !== null && actionFilter.length > 0}
						onChange={(checked,) => onChange(checked ? null : [],)}
					/>
					<button
						type="button"
						className={css.filterGroupToggle}
						onClick={() => setShowGroups((v,) => !v)}
						aria-expanded={showGroups}
					>
						Show/Hide All
					</button>
				</div>
				{showGroups && <div className={css.filterGroups}>
					{actionGroups.map((group,) => {
						const groupCodes = titlesToCodes(allGroupTitles(group,),)
						if (groupCodes.length === 0) { return null }
						const isExpanded = expandedGroups.has(group.label,)
						return (
							<div key={group.label} className={css.filterGroup}>
								<div className={css.filterGroupRow}>
									<button
										type="button"
										className={css.filterGroupChevron}
										onClick={() => toggleExpanded(group.label,)}
										aria-expanded={isExpanded}
									>
										{isExpanded ? '▾' : '▸'}
									</button>
									<GroupCheckbox
										id={`mm-actionfilter-group-${group.label}`}
										checked={areAllChecked(groupCodes,)}
										indeterminate={isPartiallyChecked(groupCodes,)}
										onChange={(checked,) => toggleCodes(groupCodes, checked,)}
									/>
									<button
										type="button"
										className={css.filterGroupToggle}
										onClick={() => toggleExpanded(group.label,)}
										aria-expanded={isExpanded}
									>
										{group.label}
									</button>
								</div>
								{isExpanded && (
									<div className={css.filterGroupItems}>
										{group.items && titlesToCodes(group.items,).map((code,) => (
											<label key={code} className={css.filterItemLabel}>
												<input
													type="checkbox"
													id={`mm-actionfilter-${code}`}
													checked={isChecked(code,)}
													onChange={(e,) => handleItemToggle(code, e.target.checked,)}
												/>
												{subredditActions[code]?.title ?? code}
											</label>
										))}
										{(group.subs ?? []).map((subreddit,) => {
											const subCodes = titlesToCodes(subreddit.items,)
											if (subCodes.length === 0) { return null }
											const subKey = `${group.label}:${subreddit.label}`
											const subExpanded = expandedGroups.has(subKey,)
											return (
												<div key={subreddit.label} className={css.filterSubGroup}>
													<div className={css.filterGroupRow}>
														<button
															type="button"
															className={css.filterGroupChevron}
															onClick={() => toggleExpanded(subKey,)}
															aria-expanded={subExpanded}
														>
															{subExpanded ? '▾' : '▸'}
														</button>
														<GroupCheckbox
															id={`mm-actionfilter-subreddit-${subreddit.label}`}
															checked={areAllChecked(subCodes,)}
															indeterminate={isPartiallyChecked(subCodes,)}
															onChange={(checked,) => toggleCodes(subCodes, checked,)}
														/>
														<button
															type="button"
															className={css.filterGroupToggle}
															onClick={() => toggleExpanded(subKey,)}
															aria-expanded={subExpanded}
														>
															{subreddit.label}
														</button>
													</div>
													{subExpanded && (
														<div className={css.filterGroupItems}>
															{subCodes.map((code,) => (
																<label key={code} className={css.filterItemLabel}>
																	<input
																		type="checkbox"
																		id={`mm-actionfilter-${code}`}
																		checked={isChecked(code,)}
																		onChange={(e,) =>
																			handleItemToggle(code, e.target.checked,)}
																	/>
																	{subredditActions[code]?.title ?? code}
																</label>
															))}
														</div>
													)}
												</div>
											)
										},)}
									</div>
								)}
							</div>
						)
					},)}
					{otherCodes.length > 0 && (
						<div className={css.filterGroup}>
							<div className={css.filterGroupRow}>
								<button
									type="button"
									className={css.filterGroupChevron}
									onClick={() => toggleExpanded('__other__',)}
									aria-expanded={expandedGroups.has('__other__',)}
								>
									{expandedGroups.has('__other__',) ? '▾' : '▸'}
								</button>
								<GroupCheckbox
									id="mm-actionfilter-group-other"
									checked={areAllChecked(otherCodes,)}
									indeterminate={isPartiallyChecked(otherCodes,)}
									onChange={(checked,) => toggleCodes(otherCodes, checked,)}
								/>
								<button
									type="button"
									className={css.filterGroupToggle}
									onClick={() => toggleExpanded('__other__',)}
									aria-expanded={expandedGroups.has('__other__',)}
								>
									Other
								</button>
							</div>
							{expandedGroups.has('__other__',) && (
								<div className={css.filterGroupItems}>
									{otherCodes.map((code,) => (
										<label key={code} className={css.filterItemLabel}>
											<input
												type="checkbox"
												id={`mm-actionfilter-${code}`}
												checked={isChecked(code,)}
												onChange={(e,) => handleItemToggle(code, e.target.checked,)}
											/>
											{subredditActions[code]?.title ?? code}
										</label>
									))}
								</div>
							)}
						</div>
					)}
				</div>}
			</div>
		</div>
	)
}
