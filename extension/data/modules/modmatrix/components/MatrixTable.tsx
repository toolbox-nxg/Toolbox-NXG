/** Sortable matrix table showing mod-log action counts per moderator, with drilldown support. */

import React, {useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,} from 'react'
import {link,} from '../../../util/reddit/pageContext'
import {classes,} from '../../../util/ui/reactMount'
import css from '../modmatrix.module.css'
import type {ColumnGroup, MatrixState,} from '../schema'
import {buildActionGroupMap, buildColumnGroups, sortActionCodes,} from '../schema'
import {DrilldownPopover,} from './DrilldownPopover'
import {StylesReadyContext,} from './MatrixStyleProvider'
import {Sparkline,} from './Sparkline'

const downSortingIcon =
	'iVBORw0KGgoAAAANSUhEUgAAAA8AAAAPCAYAAAA71pVKAAAAQklEQVQoU2NkoAAwUqCXYVQziaGHLcD+4zEDRT2u0MZmAIZafFGFbABWdYTiGWQATjWENOMNQoo1M5EYQ3DlFNkMAOsiBBL3uxzDAAAAAElFTkSuQmCC'
const upSortingIcon =
	'iVBORw0KGgoAAAANSUhEUgAAAA8AAAAPCAYAAAA71pVKAAAAQ0lEQVQoU2NkoAAwUqCXAaSZiVwDKLaZXIvBzsYH/gMlcarBpxmkEQawqsOlGFkjTgOwacamEasBhPyMN0BGNZOY1gDYfgQSUTVBXwAAAABJRU5ErkJggg=='

/** Props for the {@link MatrixTable} component. */
interface Props {
	state: MatrixState
	/** Moderator usernames in the desired display order (sorted alphabetically by default). */
	sortedMods: string[]
	/** Called when the user clicks a column header to change the sort. */
	onSort: (key: string,) => void
}

/** Tracks which cell triggered an open {@link DrilldownPopover}. */
interface DrilldownState {
	mod: string
	actionCode: string
	/** Viewport X coordinate of the click that opened the popover. */
	x: number
	/** Viewport Y coordinate of the click that opened the popover. */
	y: number
}

/**
 * Renders the CSS-sprite action icon for a given action code, falling back to a "?" placeholder
 * when the stylesheet has not yet applied a background image for that class.
 */
function ActionIcon ({actionCode, title,}: {actionCode: string; title: string},) {
	const stylesReady = useContext(StylesReadyContext,)
	const ref = useRef<HTMLAnchorElement>(null,)
	const [hasIcon, setHasIcon,] = useState(true,)

	useEffect(() => {
		if (!stylesReady || !ref.current) { return }
		const bg = getComputedStyle(ref.current,).backgroundImage
		setHasIcon(bg !== 'none',)
	}, [stylesReady,],)

	return (
		<>
			<a
				ref={ref}
				className={`modactions ${actionCode}`}
				title={title}
				style={hasIcon ? undefined : {display: 'none',}}
			/>
			{!hasIcon && <span className={css.actionFallbackIcon} title={title}>?</span>}
		</>
	)
}

/**
 * Compares two values for `Array.sort`, applying the table's sort direction. Equal values keep
 * their order; otherwise the larger value sorts first when descending.
 * @param a First value.
 * @param b Second value.
 * @param direction `1` for descending (larger/later first), `-1` for ascending.
 * @returns A negative, zero, or positive number suitable for a `sort` comparator.
 */
function directedComparison<T extends number | string,> (a: T, b: T, direction: 1 | -1,): number {
	if (a === b) { return 0 }
	return a > b ? direction * -1 : direction
}

/**
 * Returns a sorted copy of `mods` according to the current sort key and direction.
 * @param mods The moderator names to sort.
 * @param state The current matrix state (sorting and per-moderator data).
 * @param visibleActionCodes Action codes currently visible after filtering, used for total/percentage sorts.
 * @param groups Column groups, used to compute group-subtotal sorts.
 */
function sortRows (mods: string[], state: MatrixState, visibleActionCodes: string[], groups: ColumnGroup[],): string[] {
	const {currentSorting, subredditModerators,} = state
	const {key, direction,} = currentSorting

	return [...mods,].sort((a, b,) => {
		if (key == null) { return 0 }
		if (key === 'name') {
			return directedComparison(a.toLowerCase(), b.toLowerCase(), direction,)
		}
		if (key === '__total__' || key === '__pct__') {
			const at = visibleActionCodes.reduce((s, c,) => s + (subredditModerators[a]?.[c] ?? 0), 0,)
			const bt = visibleActionCodes.reduce((s, c,) => s + (subredditModerators[b]?.[c] ?? 0), 0,)
			return directedComparison(at, bt, direction,)
		}
		if (key.startsWith('__grp:',)) {
			const groupLabel = key.slice(6,)
			const group = groups.find((g,) => g.label === groupLabel)
			const at = (group?.codes ?? []).reduce((s, c,) => s + (subredditModerators[a]?.[c] ?? 0), 0,)
			const bt = (group?.codes ?? []).reduce((s, c,) => s + (subredditModerators[b]?.[c] ?? 0), 0,)
			return directedComparison(at, bt, direction,)
		}
		const av = subredditModerators[a]?.[key] ?? 0
		const bv = subredditModerators[b]?.[key] ?? 0
		return directedComparison(av, bv, direction,)
	},)
}

/**
 * A button that displays a formatted action count and opens the drilldown popover when clicked.
 * @param count Raw action count to display.
 * @param onClick Handler receiving the mouse event so the popover can be positioned.
 */
function CellButton ({
	count,
	title,
	onClick,
}: {
	count: number
	title: string
	onClick: (e: React.MouseEvent,) => void
},) {
	return (
		<button
			type="button"
			className={css.actionNumber}
			title={title}
			onClick={onClick}
		>
			{count.toLocaleString()}
		</button>
	)
}

/** Renders the full mod-log matrix table, including grouped headers, moderator rows, and totals footer. */
export function MatrixTable ({state, sortedMods, onSort,}: Props,) {
	const {
		subredditActions,
		subredditUrl,
		actionFilter,
		modFilter,
		currentSorting,
		showPercentages,
		hideZeroColumns,
		hideZeroMods,
		showSparklines,
		modTimeline,
		timelineDays,
	} = state

	const [expandedGroups, setExpandedGroups,] = useState<Set<string>>(new Set(),)
	const [drilldown, setDrilldown,] = useState<DrilldownState | null>(null,)

	const containerRef = useRef<HTMLDivElement>(null,)
	const tableRef = useRef<HTMLTableElement>(null,)
	const pctThRef = useRef<HTMLTableCellElement>(null,)
	const sparklineThRef = useRef<HTMLTableCellElement>(null,)

	useLayoutEffect(() => {
		const sparkW = sparklineThRef.current?.offsetWidth ?? 0
		const pctW = pctThRef.current?.offsetWidth ?? 0
		const table = tableRef.current
		if (table) {
			table.style.setProperty('--toolbox-sticky-pct-right', `${sparkW}px`,)
			table.style.setProperty('--toolbox-sticky-total-right', `${sparkW + pctW}px`,)
		}
	}, [showSparklines, showPercentages,],)

	const actionCodes = sortActionCodes(Object.keys(subredditActions,), subredditActions,)

	const groupMap = useMemo(
		() => buildActionGroupMap(subredditActions,),
		[subredditActions,],
	)

	const allGroups = useMemo(
		() => buildColumnGroups(actionCodes, groupMap,),
		[actionCodes, groupMap,],
	)

	const zeroCols = useMemo(() => {
		if (!hideZeroColumns) { return new Set<string>() }
		const zero = new Set<string>()
		for (const code of actionCodes) {
			const hasAny = sortedMods.some((mod,) => {
				if (modFilter !== null && !modFilter.includes(mod,)) { return false }
				return (state.subredditModerators[mod]?.[code] ?? 0) > 0
			},)
			if (!hasAny) { zero.add(code,) }
		}
		return zero
	}, [hideZeroColumns, actionCodes, sortedMods, modFilter, state.subredditModerators,],)

	// Codes visible after action filter + zero hiding
	const visibleActionCodes = useMemo(() =>
		actionCodes.filter((code,) => {
			if (zeroCols.has(code,)) { return false }
			if (actionFilter !== null && !actionFilter.includes(code,)) { return false }
			return true
		},), [actionCodes, zeroCols, actionFilter,],)

	// Groups filtered to only those with at least one visible code
	const visibleGroups = useMemo(() =>
		allGroups
			.map((g,) => ({...g, codes: g.codes.filter((c,) => visibleActionCodes.includes(c,)),}))
			.filter((g,) => g.codes.length > 0), [allGroups, visibleActionCodes,],)

	const zeroMods = useMemo(() => {
		if (!hideZeroMods) { return new Set<string>() }
		const zero = new Set<string>()
		for (const mod of sortedMods) {
			if (modFilter !== null && !modFilter.includes(mod,)) { continue }
			const total = visibleActionCodes.reduce(
				(s, a,) => s + (state.subredditModerators[mod]?.[a] ?? 0),
				0,
			)
			if (total === 0) { zero.add(mod,) }
		}
		return zero
	}, [hideZeroMods, sortedMods, modFilter, visibleActionCodes, state.subredditModerators,],)

	const anyExpanded = visibleGroups.some((g,) => expandedGroups.has(g.label,))

	const displayMods = useMemo(
		() => sortRows(sortedMods, state, visibleActionCodes, visibleGroups,),
		[sortedMods, state, visibleActionCodes, visibleGroups,],
	)

	const grandTotal = useMemo(() =>
		displayMods.reduce((sum, mod,) => {
			if (modFilter !== null && !modFilter.includes(mod,)) { return sum }
			if (zeroMods.has(mod,)) { return sum }
			return sum + visibleActionCodes.reduce((s, a,) => s + (state.subredditModerators[mod]?.[a] ?? 0), 0,)
		}, 0,), [displayMods, state, modFilter, zeroMods, visibleActionCodes,],)

	function toggleGroup (label: string,) {
		setExpandedGroups((prev,) => {
			const next = new Set(prev,)
			if (next.has(label,)) { next.delete(label,) }
			else { next.add(label,) }
			return next
		},)
	}

	function sortIcon (sortKey: string,) {
		if (currentSorting.key !== sortKey) { return null }
		const src = currentSorting.direction === -1
			? `data:image/png;base64,${upSortingIcon}`
			: `data:image/png;base64,${downSortingIcon}`
		return <img src={src} alt="" className={css.sortingIcon} />
	}

	function handleCellClick (mod: string, actionCode: string, e: React.MouseEvent,) {
		e.stopPropagation()
		setDrilldown({mod, actionCode, x: e.clientX, y: e.clientY,},)
	}

	return (
		<div ref={containerRef} className={css.tableContainer}>
			<table
				ref={tableRef}
				className={css.table}
			>
				<thead>
					{/* Group header row */}
					<tr>
						<th onClick={() => onSort('name',)} rowSpan={anyExpanded ? 2 : 1}>
							Moderator {sortIcon('name',)}
						</th>
						{visibleGroups.map((group,) => {
							const isExpanded = expandedGroups.has(group.label,)
							const colSpan = isExpanded ? group.codes.length + 1 : 1
							return (
								<th
									key={group.label}
									colSpan={colSpan}
									className={css.groupHeader}
								>
									<button
										type="button"
										className={css.groupExpandButton}
										onClick={() => toggleGroup(group.label,)}
										aria-expanded={isExpanded}
										title={isExpanded ? `Collapse ${group.label}` : `Expand ${group.label}`}
									>
										{isExpanded ? '▾' : '▸'}
									</button>
									<button
										type="button"
										className={css.groupSortButton}
										onClick={() => onSort(`__grp:${group.label}`,)}
										title={`Sort by ${group.label} total`}
									>
										{group.label} {sortIcon(`__grp:${group.label}`,)}
									</button>
								</th>
							)
						},)}
						<th
							rowSpan={anyExpanded ? 2 : 1}
							className={css.actionTotal}
							onClick={() => onSort('__total__',)}
						>
							Total{sortIcon('__total__',)}
						</th>
						{showPercentages && (
							<th
								ref={pctThRef}
								rowSpan={anyExpanded ? 2 : 1}
								className={css.actionPercentage}
								onClick={() => onSort('__pct__',)}
							>
								%{sortIcon('__pct__',)}
							</th>
						)}
						{showSparklines && (
							<th ref={sparklineThRef} rowSpan={anyExpanded ? 2 : 1} className={css.sparklineCol}>
								Activity
							</th>
						)}
					</tr>
					{/* Individual action code row - only rendered when at least one group is expanded */}
					{anyExpanded && (
						<tr>
							{visibleGroups.map((group,) => {
								const isExpanded = expandedGroups.has(group.label,)
								if (!isExpanded) {
									return <th key={group.label} />
								}
								return (
									<React.Fragment key={group.label}>
										{group.codes.map((actionCode,) => (
											<th
												key={actionCode}
												className={classes(css.actionCell, `action-${actionCode}`,)}
												title={subredditActions[actionCode]?.title ?? actionCode}
												onClick={() => onSort(actionCode,)}
											>
												<ActionIcon
													actionCode={actionCode}
													title={subredditActions[actionCode]?.title ?? actionCode}
												/>
												{sortIcon(actionCode,)}
											</th>
										))}
										<th
											className={css.groupSubtotal}
											title={`${group.label} subtotal - click to sort`}
											onClick={() => onSort(`__grp:${group.label}`,)}
										>
											Σ{sortIcon(`__grp:${group.label}`,)}
										</th>
									</React.Fragment>
								)
							},)}
						</tr>
					)}
				</thead>
				<tfoot>
					<tr className={css.totals}>
						<td>Total</td>
						{visibleGroups.map((group,) => {
							const isExpanded = expandedGroups.has(group.label,)
							const groupTotal = group.codes.reduce(
								(sum, code,) =>
									sum + displayMods.reduce((s, mod,) => {
										if (modFilter !== null && !modFilter.includes(mod,)) { return s }
										if (zeroMods.has(mod,)) { return s }
										return s + (state.subredditModerators[mod]?.[code] ?? 0)
									}, 0,),
								0,
							)
							if (!isExpanded) {
								return (
									<td key={group.label} className={css.groupSubtotal}>
										{subredditUrl
											? (
												<a
													href={`${subredditUrl}about/log`}
													target="_blank"
													rel="noreferrer"
													className={css.actionNumber}
												>
													{groupTotal.toLocaleString()}
												</a>
											)
											: <span className={css.actionNumber}>{groupTotal.toLocaleString()}</span>}
									</td>
								)
							}
							return (
								<React.Fragment key={group.label}>
									{group.codes.map((code,) => {
										const actionTotal = displayMods.reduce((sum, mod,) => {
											if (modFilter !== null && !modFilter.includes(mod,)) { return sum }
											if (zeroMods.has(mod,)) { return sum }
											return sum + (state.subredditModerators[mod]?.[code] ?? 0)
										}, 0,)
										return (
											<td
												key={code}
												className={classes(css.actionCell, `action-${code}`,)}
											>
												{subredditUrl
													? (
														<a
															href={`${subredditUrl}about/log?type=${code}`}
															target="_blank"
															rel="noreferrer"
															className={css.actionNumber}
															title={`Total ${subredditActions[code]?.title ?? code}`}
														>
															{actionTotal.toLocaleString()}
														</a>
													)
													: <span className={css.actionNumber}>
														{actionTotal.toLocaleString()}
													</span>}
											</td>
										)
									},)}
									<td className={css.groupSubtotal}>
										<span className={css.actionNumber}>{groupTotal.toLocaleString()}</span>
									</td>
								</React.Fragment>
							)
						},)}
						<td className={css.actionTotal}>
							<span className={css.actionNumber}>{grandTotal.toLocaleString()}</span>
						</td>
						{showPercentages && <td className={css.actionPercentage} />}
						{showSparklines && <td className={css.sparklineCol} />}
					</tr>
				</tfoot>
				<tbody>
					{displayMods.map((mod,) => {
						const modData = state.subredditModerators[mod] ?? {}
						const isFiltered = (modFilter !== null && !modFilter.includes(mod,)) || zeroMods.has(mod,)
						const rowTotal = visibleActionCodes.reduce((sum, a,) => sum + (modData[a] ?? 0), 0,)
						const pct = grandTotal > 0 ? Math.floor(rowTotal / grandTotal * 100,) : 0
						const isHighlighted = state.highlightThreshold > 0 && pct < state.highlightThreshold
							&& !isFiltered

						return (
							<tr
								key={mod}
								className={classes(
									`moderator-${mod}`,
									css.modRow,
									isFiltered && css.filtered,
									isHighlighted && css.highlight,
								)}
							>
								<td>
									<a href={link(`/user/${mod}`,)} target="_blank" rel="noreferrer" title={mod}>
										{mod}
									</a>
								</td>
								{visibleGroups.map((group,) => {
									const isExpanded = expandedGroups.has(group.label,)
									const groupCount = group.codes.reduce((s, c,) => s + (modData[c] ?? 0), 0,)

									if (!isExpanded) {
										return (
											<td
												key={group.label}
												className={classes(
													css.actionCell,
													groupCount === 0 && css.zero,
												)}
											>
												<span className={css.actionNumber}>{groupCount.toLocaleString()}</span>
											</td>
										)
									}

									return (
										<React.Fragment key={group.label}>
											{group.codes.map((actionCode,) => {
												const count = modData[actionCode] ?? 0
												return (
													<td
														key={actionCode}
														className={classes(
															css.actionCell,
															`action-${actionCode}`,
															count === 0 && css.zero,
														)}
													>
														<CellButton
															count={count}
															title={`${
																subredditActions[actionCode]?.title ?? actionCode
															} by ${mod} - click for details`}
															onClick={(e,) => handleCellClick(mod, actionCode, e,)}
														/>
													</td>
												)
											},)}
											<td className={classes(css.groupSubtotal, groupCount === 0 && css.zero,)}>
												<span className={css.actionNumber}>{groupCount.toLocaleString()}</span>
											</td>
										</React.Fragment>
									)
								},)}
								<td className={classes(css.actionTotal, rowTotal === 0 && css.zero,)}>
									<span className={css.actionNumber} title={`total actions by ${mod}`}>
										{rowTotal.toLocaleString()}
									</span>
								</td>
								{showPercentages && (
									<td className={css.actionPercentage}>
										<span className={css.actionNumber} title={`percentage of actions by ${mod}`}>
											{pct}
										</span>
										<span>%</span>
									</td>
								)}
								{showSparklines && (
									<td className={css.sparklineCol}>
										<Sparkline
											counts={Array.from(
												{length: timelineDays,},
												(_, i,) => modTimeline[mod]?.[i] ?? 0,
											)}
										/>
									</td>
								)}
							</tr>
						)
					},)}
				</tbody>
			</table>
			{drilldown && subredditUrl && (
				<DrilldownPopover
					mod={drilldown.mod}
					actionCode={drilldown.actionCode}
					actionTitle={subredditActions[drilldown.actionCode]?.title ?? drilldown.actionCode}
					subredditUrl={subredditUrl}
					x={drilldown.x}
					y={drilldown.y}
					onClose={() => setDrilldown(null,)}
				/>
			)}
		</div>
	)
}
