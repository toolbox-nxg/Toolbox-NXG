/** Root component for the Mod Log Matrix feature, managing all state and data-fetching logic. */

import {useMemo, useReducer, useRef,} from 'react'
import {Window,} from '../../../shared/window/Window'
import css from '../modmatrix.module.css'
import type {ActionInfo, MatrixAction, MatrixState, ModLogEntry,} from '../schema'
import {sortActionCodes,} from '../schema'
import {ActionFilter,} from './ActionFilter'
import {ControlsToolbar,} from './ControlsToolbar'
import {MatrixSettings,} from './MatrixSettings'
import {MatrixTable,} from './MatrixTable'
import {useModLogFetch,} from './useModLogFetch'

/** Props for the {@link ModMatrixApp} component. */
interface Props {
	/** Absolute URL of the subreddit (e.g. `https://www.reddit.com/r/example/`), or `null` if unknown. */
	subredditUrl: string | null
	subredditName: string | null
	/** Initial action-count map per moderator, typically extracted from the mod-log page's DOM. */
	initialModerators: Record<string, Record<string, number>>
	/** Initial set of known action types for the subreddit. */
	initialActions: Record<string, ActionInfo>
	onClose: () => void
}

/** Constructs the default {@link MatrixState} from the component's initial props. */
function makeInitialState (props: Props,): MatrixState {
	return {
		subredditUrl: props.subredditUrl,
		subredditName: props.subredditName,
		subredditModerators: props.initialModerators,
		subredditActions: props.initialActions,
		modFilter: null,
		actionFilter: null,
		currentSorting: {key: null, direction: 1,},
		minDate: null,
		maxDate: null,
		firstEntry: null,
		lastEntry: null,
		total: 0,
		loading: false,
		error: false,
		showPercentages: true,
		highlightThreshold: 0,
		hideZeroColumns: false,
		hideZeroMods: false,
		modTimeline: {},
		timelineDays: 0,
		showSparklines: false,
	}
}

/**
 * Serialises the currently visible matrix data as a CSV string.
 * Respects the active mod filter, action filter, and zero-hiding options.
 * @returns A CRLF-delimited CSV with a header row followed by one row per visible moderator.
 */
function buildCSV (state: MatrixState, sortedMods: string[],): string {
	const {subredditActions, modFilter, actionFilter, hideZeroColumns, hideZeroMods,} = state
	const visibleActions = sortActionCodes(Object.keys(subredditActions,), subredditActions,).filter((a,) => {
		if (actionFilter !== null && !actionFilter.includes(a,)) { return false }
		if (hideZeroColumns) {
			const hasAny = sortedMods.some((mod,) => {
				if (modFilter !== null && !modFilter.includes(mod,)) { return false }
				return (state.subredditModerators[mod]?.[a] ?? 0) > 0
			},)
			if (!hasAny) { return false }
		}
		return true
	},)

	const visibleMods = sortedMods.filter((mod,) => {
		if (modFilter !== null && !modFilter.includes(mod,)) { return false }
		if (hideZeroMods) {
			const total = visibleActions.reduce((s, a,) => s + (state.subredditModerators[mod]?.[a] ?? 0), 0,)
			if (total === 0) { return false }
		}
		return true
	},)

	const grandTotal = visibleMods.reduce((sum, mod,) => {
		return sum + visibleActions.reduce((s, a,) => s + (state.subredditModerators[mod]?.[a] ?? 0), 0,)
	}, 0,)

	const fields = (values: (string | number)[],) => values.map((v,) => String(v,)).join(',',)
	const header = fields(['Moderator', ...visibleActions.map((a,) => subredditActions[a]?.title ?? a), 'Total', '%',],)
	const rows = visibleMods.map((mod,) => {
		const modData = state.subredditModerators[mod] ?? {}
		const counts = visibleActions.map((a,) => modData[a] ?? 0)
		const rowTotal = counts.reduce((s, c,) => s + c, 0,)
		const pct = grandTotal > 0 ? Math.floor(rowTotal / grandTotal * 100,) : 0
		return fields([mod, ...counts, rowTotal, pct,],)
	},)
	return [header, ...rows,].join('\r\n',)
}

/** Pure reducer that handles all {@link MatrixAction} dispatches for the matrix state machine. */
function reducer (state: MatrixState, action: MatrixAction,): MatrixState {
	switch (action.type) {
		case 'SET_DATE_RANGE': {
			const timelineDays = Math.ceil((action.maxDate - action.minDate) / 86400000,)
			return {
				...state,
				minDate: action.minDate,
				maxDate: action.maxDate,
				subredditModerators: {...state.subredditModerators,},
				firstEntry: null,
				lastEntry: null,
				total: 0,
				error: false,
				modTimeline: {},
				timelineDays,
			}
		}

		case 'START_FETCH':
			return {...state, loading: true, error: false,}

		case 'PROCESS_BATCH': {
			const mods = {...state.subredditModerators,}
			const timeline = {...state.modTimeline,}
			let {firstEntry, lastEntry, total,} = state
			const {minDate,} = state

			for (const entry of action.entries) {
				if (!mods[entry.mod]) { mods[entry.mod] = {} }
				mods[entry.mod]![entry.action] = (mods[entry.mod]![entry.action] ?? 0) + 1
				total += 1
				if (firstEntry == null) { firstEntry = entry }
				lastEntry = entry

				if (minDate != null) {
					const dayIndex = Math.min(
						Math.floor((entry.created_utc * 1000 - minDate) / 86400000,),
						state.timelineDays - 1,
					)
					if (dayIndex >= 0) {
						if (!timeline[entry.mod]) { timeline[entry.mod] = [] }
						timeline[entry.mod]![dayIndex] = (timeline[entry.mod]![dayIndex] ?? 0) + 1
					}
				}
			}

			return {...state, subredditModerators: mods, modTimeline: timeline, firstEntry, lastEntry, total,}
		}

		case 'FINISH_FETCH':
			return {...state, loading: false,}

		case 'SET_ERROR':
			return {...state, loading: false, error: true,}

		case 'RESET_DATA':
			return {
				...state,
				subredditModerators: Object.fromEntries(
					Object.keys(state.subredditModerators,).map((mod,) => [mod, {},]),
				),
				firstEntry: null,
				lastEntry: null,
				total: 0,
				error: false,
				modTimeline: {},
			}

		case 'SET_MOD_FILTER':
			return {...state, modFilter: action.modFilter,}

		case 'SET_ACTION_FILTER':
			return {...state, actionFilter: action.actionFilter,}

		case 'SET_SORT': {
			const sameCol = state.currentSorting.key === action.key
			const direction = sameCol
				? (state.currentSorting.direction === 1 ? -1 : 1) as 1 | -1
				: action.key === 'name'
				? -1
				: 1
			return {...state, currentSorting: {key: action.key, direction,},}
		}

		case 'SET_DISPLAY_OPTIONS':
			return {
				...state,
				showPercentages: action.showPercentages ?? state.showPercentages,
				highlightThreshold: action.highlightThreshold ?? state.highlightThreshold,
				hideZeroColumns: action.hideZeroColumns ?? state.hideZeroColumns,
				hideZeroMods: action.hideZeroMods ?? state.hideZeroMods,
				showSparklines: action.showSparklines ?? state.showSparklines,
			}

		default:
			return state
	}
}

/** In-memory cache of a previously fetched date range, used to avoid redundant API calls. */
interface EntryCache {
	/** Millisecond Unix timestamp for the start of the cached range. */
	minDate: number
	/** Millisecond Unix timestamp for the end of the cached range. */
	maxDate: number
	entries: ModLogEntry[]
}

/** Root component of the Mod Log Matrix popup window, wiring together state, fetching, and all sub-components. */
export function ModMatrixApp (props: Props,) {
	const [state, dispatch,] = useReducer(reducer, props, makeInitialState,)

	const entryCache = useRef<EntryCache | null>(null,)
	const pendingEntries = useRef<ModLogEntry[]>([],)
	const fetchingRange = useRef<{minDate: number; maxDate: number} | null>(null,)

	const fetchEnabled = state.loading

	useModLogFetch(
		state.subredditUrl,
		state.minDate,
		state.maxDate,
		(entries: ModLogEntry[], _hasMore: boolean,) => {
			pendingEntries.current.push(...entries,)
			dispatch({type: 'PROCESS_BATCH', entries,},)
		},
		() => {
			const range = fetchingRange.current
			if (range) {
				entryCache.current = {
					minDate: range.minDate,
					maxDate: range.maxDate,
					entries: pendingEntries.current,
				}
			}
			dispatch({type: 'FINISH_FETCH',},)
		},
		() => dispatch({type: 'SET_ERROR',},),
		fetchEnabled,
	)

	const sortedMods = useMemo(
		() => Object.keys(state.subredditModerators,).sort((a, b,) => a.localeCompare(b,)),
		[state.subredditModerators,],
	)

	const csvUrl = useMemo(() => {
		if (!state.total) { return null }
		const csv = buildCSV(state, sortedMods,)
		return `data:text/csv;charset=utf-8,${encodeURIComponent(csv,)}`
	}, [state, sortedMods,],)

	function handleGenerate (minDate: number, maxDate: number,) {
		dispatch({type: 'RESET_DATA',},)
		dispatch({type: 'SET_DATE_RANGE', minDate, maxDate,},)

		const cache = entryCache.current
		if (cache && minDate >= cache.minDate && maxDate <= cache.maxDate) {
			const filtered = cache.entries.filter((e,) => {
				const ts = e.created_utc * 1000
				return ts >= minDate && ts <= maxDate
			},)
			dispatch({type: 'START_FETCH',},)
			dispatch({type: 'PROCESS_BATCH', entries: filtered,},)
			dispatch({type: 'FINISH_FETCH',},)
		} else {
			pendingEntries.current = []
			fetchingRange.current = {minDate, maxDate,}
			dispatch({type: 'START_FETCH',},)
		}
	}

	function handleSort (key: string,) {
		dispatch({type: 'SET_SORT', key, direction: 1,},)
	}

	const footer = <MatrixSettings state={state} csvUrl={csvUrl} onGenerate={handleGenerate} />

	const toolbar = (
		<ControlsToolbar
			state={state}
			onSetModFilter={(filter,) => dispatch({type: 'SET_MOD_FILTER', modFilter: filter,},)}
			onSetDisplayOptions={(options,) => dispatch({type: 'SET_DISPLAY_OPTIONS', ...options,},)}
		/>
	)

	return (
		<Window
			title="Mod Log Matrix"
			onClose={props.onClose}
			className={css.matrixWindow}
			toolbar={toolbar}
			footer={footer}
		>
			<MatrixTable state={state} sortedMods={sortedMods} onSort={handleSort} />
			<ActionFilter
				subredditActions={state.subredditActions as Record<string, ActionInfo>}
				actionFilter={state.actionFilter}
				onChange={(filter,) => dispatch({type: 'SET_ACTION_FILTER', actionFilter: filter,},)}
			/>
		</Window>
	)
}
