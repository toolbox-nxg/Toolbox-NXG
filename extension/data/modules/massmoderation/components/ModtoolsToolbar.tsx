/** Sticky moderation toolbar rendered above the old Reddit queue listing with bulk action controls. */

import {useCallback, useEffect, useLayoutEffect, useRef, useState,} from 'react'

import {GeneralButton,} from '../../../shared/controls/GeneralButton'
import {reactAlert,} from '../../../shared/controls/ReactAlert'

import css from './ModtoolsToolbar.module.css'

/** Alt key used to cycle through sort options; avoids existing Alt+A/G/H/I/R/S/U bindings. */
const SORT_CYCLE_KEY = 'o'
// Auto-refresh uses an exponential backoff: it starts polling every MIN seconds and doubles the
// interval (up to MAX) each time a poll turns up nothing new, then snaps back to MIN as soon as
// something new arrives or the user takes an action.
const MIN_AUTO_REFRESH_INTERVAL_S = 5
const MAX_AUTO_REFRESH_INTERVAL_S = 60
/** Prompt for confirmation before bulk-actioning this many or more items. */
const BULK_CONFIRM_THRESHOLD = 10
const ACTION_LOG_MAX = 3
const TOAST_DURATION_MS = 3000

const expandReportsTitle = 'expand reports'
const collapseReportsTitle = 'collapse reports'

/** Imperative controls exposed to the parent after the toolbar mounts. */
export interface ModtoolsToolbarControls {
	/**
	 * Programmatically updates the select-all checkbox state.
	 * @param checked Whether all visible items are selected.
	 * @param indeterminate Whether some (but not all) visible items are selected.
	 */
	setSelectAll: (checked: boolean, indeterminate: boolean,) => void
	/**
	 * Updates the live count of currently selected items shown in the actions group.
	 * @param n Number of items currently checked.
	 */
	setSelectedCount: (n: number,) => void
	/**
	 * Updates the hidden item count; "unhide all" is shown only when this is > 0.
	 * @param n Number of currently hidden items.
	 */
	setHiddenCount: (n: number,) => void
	/**
	 * Resets the auto-refresh backoff and polls immediately. Call when an out-of-toolbar action
	 * (e.g. a per-item pretty-button) is taken, so the queue reconciles right away.
	 */
	triggerAutoRefresh: () => void
}

/** Props for the ModtoolsToolbar component. */
export interface ModtoolsToolbarProps {
	/** Whether the current page is a spam/trials queue (hides the reports sort and threshold). */
	viewingspam: boolean
	initialSortOrder: string
	initialSortAscending: boolean
	initialReportsThreshold: number
	initialScoreThreshold: number
	initialExpandReports: boolean
	initialExpandosOpen: boolean
	initialSortLocked: boolean
	initialGroupBySubreddit: boolean
	initialAutoRefresh: boolean
	/** Called once on mount with the imperative controls object. */
	onMount: (controls: ModtoolsToolbarControls,) => void
	/** Called when the user clicks the "invert" button to flip all checkbox states. */
	onInvert: () => void
	/** Called when the select-all checkbox changes. */
	onSelectAll: (checked: boolean,) => void
	/** Called to hide all currently-selected items from the view. */
	onHideSelected: () => void
	/** Called to unhide all previously-hidden items. */
	onUnhideSelected: () => void
	/** Called when the expand/collapse reports toggle changes. */
	onToggleReports: (expanded: boolean,) => void
	/**
	 * Called when one of the spam/remove/approve/ignore bulk action buttons is clicked.
	 * Resolves with the number of items that were actioned.
	 */
	onActionButton: (type: 'negative' | 'neutral' | 'positive' | 'ignore',) => Promise<number>
	/** Called when the reports-threshold input changes. */
	onThresholdChange: (threshold: number,) => void
	/** Called when the score-threshold input changes. */
	onScoreThresholdChange: (threshold: number,) => void
	/**
	 * Called when the user picks a sort order from the dropdown.
	 * @param order The chosen sort field.
	 * @param toggleAsc `true` when the same field was selected again (toggles direction).
	 */
	onSortChoice: (order: string, toggleAsc: boolean,) => void
	/** Called when the sort-lock toggle changes. */
	onSortLockChange: (locked: boolean,) => void
	/** Called when the user toggles all expando boxes open or closed. */
	onOpenExpandos: (open: boolean,) => void
	/** Called when the group-by-subreddit toggle changes. */
	onGroupBySubreddit: (enabled: boolean,) => void
	/** Called when auto-refresh is toggled; parent should persist the new value. */
	onAutoRefreshChange: (enabled: boolean,) => void
	/**
	 * Called each time the auto-refresh timer fires; parent should check for new queue items and
	 * reconcile the mod log. Resolves to `true` when something new was found (a new item or a new
	 * mod-log action), which resets the backoff to its minimum interval.
	 */
	onAutoRefreshTick: () => Promise<boolean>
	/** Called when the content-type filter cycles (all / posts / comments). */
	onContentTypeFilter: (type: 'all' | 'posts' | 'comments',) => void
}

export function ModtoolsToolbar ({
	viewingspam,
	initialSortOrder,
	initialSortAscending,
	initialReportsThreshold,
	initialScoreThreshold,
	initialExpandReports,
	initialExpandosOpen,
	initialSortLocked,
	initialGroupBySubreddit,
	initialAutoRefresh,
	onMount,
	onInvert,
	onSelectAll,
	onHideSelected,
	onUnhideSelected,
	onToggleReports,
	onActionButton,
	onThresholdChange,
	onScoreThresholdChange,
	onSortChoice,
	onSortLockChange,
	onOpenExpandos,
	onGroupBySubreddit,
	onAutoRefreshChange,
	onAutoRefreshTick,
	onContentTypeFilter,
}: ModtoolsToolbarProps,) {
	// Sort state
	const [sortOrder, setSortOrder,] = useState(initialSortOrder,)
	const [sortAscending, setSortAscending,] = useState(initialSortAscending,)
	const [dropdownOpen, setDropdownOpen,] = useState(false,)
	const [sortLocked, setSortLocked,] = useState(initialSortLocked,)

	// Queue content state
	const [reportsExpanded, setReportsExpanded,] = useState(initialExpandReports,)
	const [expandosOpen, setExpandosOpen,] = useState(initialExpandosOpen,)
	const [groupedBySubreddit, setGroupedBySubreddit,] = useState(initialGroupBySubreddit,)

	// Selection state
	const [selectAllChecked, setSelectAllChecked,] = useState(false,)
	const [selectAllIndeterminate, setSelectAllIndeterminate,] = useState(false,)
	const [selectedCount, setSelectedCount,] = useState(0,)
	const [hiddenCount, setHiddenCount,] = useState(0,)

	// Action state
	const [pressed, setPressed,] = useState<string | null>(null,)
	const [actionsPending, setActionsPending,] = useState(false,)
	const [actionLog, setActionLog,] = useState<string[]>([],)
	const [toast, setToast,] = useState<string | null>(null,)

	// Auto-refresh state
	const [autoRefresh, setAutoRefresh,] = useState(initialAutoRefresh,)
	const [refreshCountdown, setRefreshCountdown,] = useState(MIN_AUTO_REFRESH_INTERVAL_S,)

	// Content-type filter state
	const [contentType, setContentType,] = useState<'all' | 'posts' | 'comments'>('all',)
	const [shiftRemoveFeedback, setShiftRemoveFeedback,] = useState(false,)

	const menuRef = useRef<HTMLDivElement>(null,)
	const selectAllRef = useRef<HTMLInputElement>(null,)
	const dropdownRef = useRef<HTMLDivElement>(null,)
	const choicesRef = useRef<HTMLDivElement>(null,)
	const duplicateRef = useRef<HTMLDivElement>(null,)

	// Refs for stable access inside long-lived effects (avoids stale closures)
	const sortOrderRef = useRef(sortOrder,)
	const sortChoicesRef = useRef<string[]>([],)
	const onSortChoiceRef = useRef(onSortChoice,)
	const onAutoRefreshTickRef = useRef(onAutoRefreshTick,)
	// Auto-refresh backoff bookkeeping kept in refs so the 1s interval (and the imperative immediate
	// trigger) read live values without re-subscribing: the current backoff interval, the live
	// countdown, an in-flight guard, whether auto-refresh is enabled, and whether we're still mounted.
	const intervalSecondsRef = useRef(MIN_AUTO_REFRESH_INTERVAL_S,)
	const countdownRef = useRef(MIN_AUTO_REFRESH_INTERVAL_S,)
	const refreshingRef = useRef(false,)
	const autoRefreshRef = useRef(autoRefresh,)
	const mountedRef = useRef(true,)
	useEffect(() => {
		sortOrderRef.current = sortOrder
	}, [sortOrder,],)
	useEffect(() => {
		onSortChoiceRef.current = onSortChoice
	}, [onSortChoice,],)
	useEffect(() => {
		onAutoRefreshTickRef.current = onAutoRefreshTick
	}, [onAutoRefreshTick,],)
	useEffect(() => {
		autoRefreshRef.current = autoRefresh
	}, [autoRefresh,],)
	useEffect(() => () => {
		mountedRef.current = false
	}, [],)

	// Indeterminate checkbox state can only be set imperatively
	useEffect(() => {
		if (selectAllRef.current) {
			selectAllRef.current.indeterminate = selectAllIndeterminate
		}
	}, [selectAllIndeterminate,],)

	// Position the sort dropdown choices below the trigger button
	useLayoutEffect(() => {
		if (dropdownOpen && choicesRef.current && dropdownRef.current) {
			choicesRef.current.style.left = `${dropdownRef.current.offsetLeft}px`
			choicesRef.current.style.top = `${dropdownRef.current.offsetTop + dropdownRef.current.offsetHeight}px`
		}
	}, [dropdownOpen,],)

	// Close sort dropdown on any outside click
	useEffect(() => {
		if (!dropdownOpen) { return }
		const close = () => setDropdownOpen(false,)
		document.addEventListener('click', close,)
		return () => document.removeEventListener('click', close,)
	}, [dropdownOpen,],)

	// Scroll-based sticky: position:fixed when scrolled past the toolbar's natural position,
	// with a phantom spacer to hold the layout gap while the toolbar is fixed.
	useEffect(() => {
		const menu = menuRef.current
		const duplicate = duplicateRef.current
		if (!menu || !duplicate) { return }

		const menuRect = menu.getBoundingClientRect()
		const stickyOffsetTop = menuRect.top + window.scrollY
		const stickyOffsetLeft = menuRect.left + window.scrollX
		const sideEl = document.querySelector<HTMLElement>('.side',)
		const rightPosition = (sideEl ? sideEl.offsetWidth : 0) + 10

		Object.assign(menu.style, {
			'margin-right': `${rightPosition}px`,
			'margin-left': '5px',
			'left': '0',
			'margin-top': '0',
			'position': 'relative',
		},)

		let animFrame: number | null = null
		const handleScroll = () => {
			if (animFrame) { cancelAnimationFrame(animFrame,) }
			const position = window.scrollY > stickyOffsetTop ? 'fixed' : 'relative'
			animFrame = requestAnimationFrame(() => {
				Object.assign(menu.style, {
					'left': position === 'fixed' ? `${stickyOffsetLeft}px` : '0',
					'right': position === 'fixed' ? `${rightPosition}px` : '0',
					'margin-right': position === 'fixed' ? '0' : `${rightPosition}px`,
					'top': '0',
					position,
				},)
				duplicate.style.display = position === 'fixed' ? 'block' : 'none'
				duplicate.style.height = `${menu.offsetHeight}px`
			},)
		}

		window.addEventListener('scroll', handleScroll,)
		return () => {
			window.removeEventListener('scroll', handleScroll,)
			if (animFrame) { cancelAnimationFrame(animFrame,) }
		}
	}, [],)

	// Alt+O: cycle sort order without opening the dropdown
	useEffect(() => {
		const handler = (e: KeyboardEvent,) => {
			if (!e.altKey || e.key.toLowerCase() !== SORT_CYCLE_KEY) { return }
			e.preventDefault()
			const choices = sortChoicesRef.current
			const next = choices[(choices.indexOf(sortOrderRef.current,) + 1) % choices.length]!
			setSortOrder(next,)
			onSortChoiceRef.current(next, false,)
		}
		document.addEventListener('keydown', handler,)
		return () => document.removeEventListener('keydown', handler,)
	}, [],)

	/** Resets the auto-refresh backoff to its minimum interval and restarts the countdown. */
	const resetAutoRefreshInterval = useCallback(() => {
		intervalSecondsRef.current = MIN_AUTO_REFRESH_INTERVAL_S
		countdownRef.current = MIN_AUTO_REFRESH_INTERVAL_S
		setRefreshCountdown(MIN_AUTO_REFRESH_INTERVAL_S,)
	}, [],)

	/** Runs one auto-refresh poll and applies the backoff to schedule the next one. */
	const runAutoRefreshTick = useCallback(async () => {
		if (refreshingRef.current) { return }
		refreshingRef.current = true
		try {
			const foundSomething = await onAutoRefreshTickRef.current()
			intervalSecondsRef.current = foundSomething
				? MIN_AUTO_REFRESH_INTERVAL_S
				: Math.min(intervalSecondsRef.current * 2, MAX_AUTO_REFRESH_INTERVAL_S,)
		} catch {
			// Leave the interval unchanged on error and try again next cycle.
		} finally {
			countdownRef.current = intervalSecondsRef.current
			if (mountedRef.current) { setRefreshCountdown(intervalSecondsRef.current,) }
			refreshingRef.current = false
		}
	}, [],)

	/**
	 * Triggered by a user action: resets the backoff and polls immediately rather than waiting out the
	 * countdown, so a freshly-actioned queue reconciles without delay. No-op while a poll is in flight
	 * or when auto-refresh is disabled.
	 */
	const triggerAutoRefresh = useCallback(() => {
		resetAutoRefreshInterval()
		if (autoRefreshRef.current) { void runAutoRefreshTick() }
	}, [resetAutoRefreshInterval, runAutoRefreshTick,],)

	// Auto-refresh: count down each second; when it reaches zero, run a poll which applies the backoff
	// (reset to the minimum interval when something new was found, otherwise double up to the maximum).
	useEffect(() => {
		resetAutoRefreshInterval()
		if (!autoRefresh) { return }
		const tick = setInterval(() => {
			if (refreshingRef.current) { return }
			if (countdownRef.current > 1) {
				countdownRef.current -= 1
				setRefreshCountdown(countdownRef.current,)
				return
			}
			void runAutoRefreshTick()
		}, 1000,)
		return () => clearInterval(tick,)
	}, [autoRefresh, resetAutoRefreshInterval, runAutoRefreshTick,],)

	// Expose imperative controls to parent
	useEffect(() => {
		onMount({
			setSelectAll: (checked, indeterminate,) => {
				setSelectAllChecked(checked,)
				setSelectAllIndeterminate(indeterminate,)
			},
			setSelectedCount,
			setHiddenCount,
			triggerAutoRefresh,
		},)
	}, [],)

	// --- Handlers ---

	/**
	 * Handles a sort choice click: updates local state, propagates to parent,
	 * and leaves direction changes to the dedicated direction button.
	 */
	const handleSortChoiceClick = (choice: string,) => {
		const sameChoice = choice === sortOrder
		setSortOrder(choice,)
		if (!sameChoice) {
			onSortChoice(choice, false,)
		}
		setDropdownOpen(false,)
	}

	/** Toggles ascending/descending for the active sort field. */
	const handleSortDirectionClick = () => {
		setSortAscending((prev,) => !prev)
		onSortChoice(sortOrder, true,)
	}

	/** Toggles the reports-expanded state and notifies the parent. */
	const handleToggleReports = () => {
		const next = !reportsExpanded
		setReportsExpanded(next,)
		onToggleReports(next,)
	}

	/** Toggles all expando boxes open or closed and notifies the parent. */
	const handleExpandosClick = () => {
		const next = !expandosOpen
		setExpandosOpen(next,)
		onOpenExpandos(next,)
	}

	/** Syncs the select-all checkbox and propagates the new state to the parent. */
	const handleSelectAllChange = (e: React.ChangeEvent<HTMLInputElement>,) => {
		const checked = e.target.checked
		setSelectAllChecked(checked,)
		setSelectAllIndeterminate(false,)
		onSelectAll(checked,)
	}

	/** Toggles group-by-subreddit and notifies the parent. */
	const handleGroupBySubreddit = () => {
		const next = !groupedBySubreddit
		setGroupedBySubreddit(next,)
		onGroupBySubreddit(next,)
	}

	/** Toggles the sort lock and persists the new value. */
	const handleToggleLockSort = () => {
		const next = !sortLocked
		setSortLocked(next,)
		onSortLockChange(next,)
	}

	/**
	 * Handles a bulk action button click: prompts for confirmation on large selections,
	 * fires the action, disables buttons while in-flight, then updates the toast and log.
	 */
	const handleActionClick = async (
		type: 'negative' | 'neutral' | 'positive' | 'ignore',
		event?: React.MouseEvent<HTMLButtonElement>,
	) => {
		if (selectedCount >= BULK_CONFIRM_THRESHOLD) {
			const label = type === 'negative'
				? 'spam'
				: type === 'positive'
				? 'approve'
				: type === 'neutral'
				? 'remove'
				: 'ignore reports on'
			const confirmed = await reactAlert({message: `${label} ${selectedCount} items?`,},)
			if (!confirmed) { return }
		}
		if (type === 'neutral' && event?.shiftKey) {
			setShiftRemoveFeedback(true,)
		}
		setPressed(type,)
		setTimeout(() => setPressed(null,), 200,)
		setActionsPending(true,)
		try {
			const count = await onActionButton(type,)
			// A user action polls immediately so the queue reconciles without waiting out the countdown.
			triggerAutoRefresh()
			const pastLabel = type === 'negative'
				? 'spammed'
				: type === 'positive'
				? 'approved'
				: type === 'neutral'
				? 'removed'
				: 'ignored'
			const entry = `${pastLabel} ×${count}`
			setActionLog((prev,) => [entry, ...prev,].slice(0, ACTION_LOG_MAX,))
			setToast(entry,)
			setTimeout(() => setToast(null,), TOAST_DURATION_MS,)
		} finally {
			setActionsPending(false,)
			if (type === 'neutral' && event?.shiftKey) {
				setTimeout(() => setShiftRemoveFeedback(false,), TOAST_DURATION_MS,)
			}
		}
	}

	const anySelected = selectAllChecked || selectAllIndeterminate
	const sortChoices = ['age', 'edited', 'removed', ...(!viewingspam ? ['reports',] : []), 'score', 'author',]
	// Keep ref in sync so the Alt+O handler can read the current choices without re-running
	sortChoicesRef.current = sortChoices

	return (<>
		<div ref={menuRef} className={css.toolbar}>
			{/* Group 1: always-visible controls */}
			<div className={css.group}>
				<input
					ref={selectAllRef}
					className={css.selectAllCheckbox}
					title="Select all/none"
					type="checkbox"
					id="select-all"
					checked={selectAllChecked}
					onChange={handleSelectAllChange}
				/>
				{selectAllIndeterminate && (
					<GeneralButton
						accessKey="I"
						title="invert selection (Alt+I)"
						onClick={onInvert}
					>
						invert
					</GeneralButton>
				)}
				<GeneralButton
					title="expand or collapse all expando boxes"
					onClick={handleExpandosClick}
				>
					{expandosOpen ? 'collapse all' : 'expand all'}
				</GeneralButton>
				<GeneralButton onClick={handleToggleReports}>
					{reportsExpanded ? collapseReportsTitle : expandReportsTitle}
				</GeneralButton>
				<GeneralButton
					title="cycle content-type filter: posts & comments → posts only → comments only"
					onClick={() => {
						const next = contentType === 'all' ? 'posts' : contentType === 'posts' ? 'comments' : 'all'
						setContentType(next,)
						onContentTypeFilter(next,)
					}}
				>
					{contentType === 'all'
						? 'posts & comments'
						: contentType === 'posts'
						? 'posts only'
						: 'comments only'}
				</GeneralButton>
			</div>

			{/* Group 2: hide/unhide and bulk actions - shown when items are selected or hidden */}
			{(anySelected || hiddenCount > 0) && (
				<div className={css.group}>
					{anySelected && <span className={css.selectedCount}>{selectedCount} selected</span>}
					{hiddenCount > 0 && (
						<GeneralButton
							accessKey="U"
							title="unhide all hidden items (Alt+U)"
							onClick={onUnhideSelected}
						>
							unhide all
						</GeneralButton>
					)}
					<GeneralButton
						accessKey="H"
						title="hide selected items (Alt+H)"
						onClick={onHideSelected}
					>
						hide selected
					</GeneralButton>
					{anySelected && <>
						<GeneralButton
							className={`${css.negative}${pressed === 'negative' ? ` ${css.pressed}` : ''}`}
							accessKey="S"
							tabIndex={3}
							title="spam selected items (Alt+S)"
							disabled={actionsPending}
							onClick={() => {
								void handleActionClick('negative',)
							}}
						>
							spam selected
						</GeneralButton>
						<GeneralButton
							className={`${css.neutral}${
								(pressed === 'neutral' || shiftRemoveFeedback) ? ` ${css.pressed}` : ''
							}`}
							accessKey="R"
							tabIndex={4}
							title="remove selected items (Alt+R)"
							disabled={actionsPending}
							onClick={(event,) => {
								void handleActionClick('neutral', event,)
							}}
						>
							{shiftRemoveFeedback ? 'removed selected' : 'remove selected'}
						</GeneralButton>
						<GeneralButton
							className={`${css.positive}${pressed === 'positive' ? ` ${css.pressed}` : ''}`}
							accessKey="A"
							tabIndex={5}
							title="approve selected items (Alt+A)"
							disabled={actionsPending}
							onClick={() => {
								void handleActionClick('positive',)
							}}
						>
							approve selected
						</GeneralButton>
						<GeneralButton
							className={`${css.neutral}${pressed === 'ignore' ? ` ${css.pressed}` : ''}`}
							accessKey="G"
							tabIndex={6}
							title="ignore reports on selected items (Alt+G)"
							disabled={actionsPending}
							onClick={() => {
								void handleActionClick('ignore',)
							}}
						>
							ignore reports on selected
						</GeneralButton>
						{toast && <span className={css.toast}>{toast}</span>}
					</>}
				</div>
			)}

			{/* Action log row - flex-basis:100% forces it onto its own line */}
			{actionLog.length > 0 && (
				<div className={css.actionLogRow}>
					{actionLog.map((entry, i,) => (
						<span key={i} className={css.actionLogEntry}>{entry}</span>
					))}
				</div>
			)}

			{/* Group 3: threshold and age-range filter inputs */}
			<div className={css.group}>
				{!viewingspam && (
					<span className={css.thresholdGroup}>
						<label htmlFor="modtab-threshold">Report threshold:</label>
						<input
							id="modtab-threshold"
							className={css.threshold}
							type="number"
							min="0"
							defaultValue={initialReportsThreshold}
							onInput={(e,) => {
								const val = +(e.target as HTMLInputElement).value
								if (!isNaN(val,)) { onThresholdChange(val,) }
							}}
						/>
					</span>
				)}
				<span className={css.thresholdGroup}>
					<label htmlFor="modtab-score-threshold">Score threshold:</label>
					<input
						id="modtab-score-threshold"
						className={css.threshold}
						type="number"
						min="0"
						defaultValue={initialScoreThreshold}
						onInput={(e,) => {
							const val = +(e.target as HTMLInputElement).value
							if (!isNaN(val,)) { onScoreThresholdChange(val,) }
						}}
					/>
				</span>
			</div>

			{/* Group 4: sort controls */}
			<div className={css.group}>
				<span>sort:</span>
				<div
					ref={dropdownRef}
					className={css.dropdown}
					aria-expanded={dropdownOpen}
					aria-haspopup="listbox"
					onClick={(e,) => {
						e.stopPropagation()
						setDropdownOpen((o,) => !o)
					}}
				>
					<span className={css.selected}>{sortOrder} ▾</span>
				</div>
				<GeneralButton
					className={css.sortDirection}
					title={sortAscending ? 'sort descending' : 'sort ascending'}
					onClick={handleSortDirectionClick}
				>
					{sortAscending ? '↑' : '↓'}
				</GeneralButton>
				<div
					ref={choicesRef}
					className={`${css.dropChoices}${dropdownOpen ? ` ${css.open}` : ''}`}
				>
					{sortChoices.map((choice,) => (
						<a
							key={choice}
							className={css.choice}
							onClick={(e,) => {
								e.stopPropagation()
								handleSortChoiceClick(choice,)
							}}
						>
							{choice}
						</a>
					))}
				</div>
				<GeneralButton
					className={sortLocked ? css.lockActive : undefined}
					title={sortLocked
						? 'unlock sort order'
						: 'lock sort to prevent reshuffling on new items (Alt+O cycles sort)'}
					onClick={handleToggleLockSort}
				>
					{sortLocked ? 'locked' : 'lock sort'}
				</GeneralButton>
				<GeneralButton
					title={groupedBySubreddit ? 'ungroup items' : 'group queue items by subreddit'}
					onClick={handleGroupBySubreddit}
				>
					{groupedBySubreddit ? 'ungroup' : 'group by sub'}
				</GeneralButton>
				<GeneralButton
					className={autoRefresh ? css.autoRefreshActive : undefined}
					title={autoRefresh
						? `auto-refresh active - next check in ${refreshCountdown}s`
						: 'enable auto-refresh to periodically check for new queue items'}
					onClick={() =>
						setAutoRefresh((r,) => {
							onAutoRefreshChange(!r,)
							return !r
						},)}
				>
					{autoRefresh ? `auto-refresh (${refreshCountdown}s)` : 'auto-refresh'}
				</GeneralButton>
			</div>
		</div>
		<div ref={duplicateRef} className={css.duplicate} />
	</>)
}
