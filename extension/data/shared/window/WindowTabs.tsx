/** Flexible tab panel with optional vertical layout, section headers, and scrollable sections. */

import {ReactNode, useEffect, useId, useState,} from 'react'
import {classes,} from '../../util/ui/reactMount'
import css from './WindowTabs.module.css'

/** Optional enable/disable checkbox shown inside a tab button. */
export interface WindowTabToggle {
	checked: boolean
	onChange: (checked: boolean,) => void
	disabled?: boolean
}

/** A selectable tab with content. */
export interface WindowTab {
	title: string
	tooltip?: string
	content: ReactNode
	/** Optional checkbox shown inside the tab button for module enable/disable. */
	toggle?: WindowTabToggle
	/** Footer rendered below the tab content; overrides the global WindowTabs footer when set. */
	footer?: ReactNode
	/** Optional identifier used by callers to associate this tab with a domain object (e.g. module ID). */
	moduleId?: string
}

/** A non-selectable section header divider in the tab list. */
export interface WindowTabSection {
	kind: 'section'
	label: string
	/** If true, this section and its tabs are wrapped in a scrollable container */
	scrollable?: boolean
}

/** Union type for items in the tab list: either a selectable tab or a section header. */
export type WindowTabItem = WindowTab | WindowTabSection

export function isSection (item: WindowTabItem,): item is WindowTabSection {
	return (item as WindowTabSection).kind === 'section'
}

export const WindowTabs = (
	{
		vertical = false,
		tabs,
		defaultTabIndex = 0,
		onTabChange,
		footer,
		sidebarHeader,
		hideTabButtons = false,
		hiddenTabIndices,
		contentOverride,
		className,
	}: {
		/** If true, tabs will be oriented vertically */
		vertical?: boolean
		/** List of tabs and section headers to display */
		tabs: WindowTabItem[]
		/** Index of the initially selected tab (indexes only count actual tabs, not sections) */
		defaultTabIndex: number
		/** Called when the active tab changes */
		onTabChange?: (index: number,) => void
		/** Footer rendered at the bottom of the content panel (not the sidebar) */
		footer?: ReactNode
		/** Content rendered above the tab list in the sidebar */
		sidebarHeader?: ReactNode
		/** If true, hides the tab buttons while still rendering sidebarHeader and content */
		hideTabButtons?: boolean
		/** Set of tab indices whose buttons should be hidden in the sidebar */
		hiddenTabIndices?: Set<number> | undefined
		/** When set, shown in the content pane instead of the active tab's content. Uses a stable DOM node so scroll position is preserved across tab switches. */
		contentOverride?: ReactNode | undefined
		/** Additional class name applied to the outermost wrapper element. */
		className?: string | undefined
	},
) => {
	const selectableTabs = tabs.filter((t,): t is WindowTab => !isSection(t,))

	const [activeIndex, setActiveIndex,] = useState(
		Math.max(0, Math.min(selectableTabs.length - 1, defaultTabIndex,),),
	)
	const [collapsedSections, setCollapsedSections,] = useState<Set<string>>(new Set(),)
	const panelId = useId()

	useEffect(() => {
		// Use functional update to read current activeIndex without adding it to deps,
		// avoiding a feedback loop. Also re-clamp when defaultTabIndex changes.
		setActiveIndex((current,) =>
			current >= selectableTabs.length
				? Math.max(0, Math.min(selectableTabs.length - 1, defaultTabIndex,),)
				: current
		)
	}, [selectableTabs.length, defaultTabIndex,],)

	const handleTabChange = (i: number,) => {
		setActiveIndex(i,)
		onTabChange?.(i,)
	}

	const toggleSection = (label: string,) => {
		setCollapsedSections((prev,) => {
			const next = new Set(prev,)
			if (next.has(label,)) { next.delete(label,) }
			else { next.add(label,) }
			return next
		},)
	}

	// Pre-compute indices from selectableTabs so collapsing sections doesn't shift other indices.
	const tabIndexMap = new Map<WindowTab, number>(selectableTabs.map((tab, i,) => [tab, i,]),)

	// Renders a single tab button using pre-computed index, or null if hidden.
	const renderTabButton = (item: WindowTab, itemKey: number | string,) => {
		const tabIndex = tabIndexMap.get(item,) ?? 0
		if (hiddenTabIndices?.has(tabIndex,)) { return null }
		const isActive = activeIndex === tabIndex
		return (
			<button
				key={String(itemKey,)}
				type="button"
				role="tab"
				title={item.tooltip}
				aria-selected={isActive}
				aria-controls={`${panelId}-panel-${tabIndex}`}
				id={`${panelId}-tab-${tabIndex}`}
				onClick={() => handleTabChange(tabIndex,)}
				className={classes(
					css.tabButton,
					isActive && css.tabButtonActive,
					item.toggle && !item.toggle.checked && css.tabDisabled,
				)}
			>
				{item.toggle && (
					<input
						type="checkbox"
						className={css.tabToggle}
						checked={item.toggle.checked}
						disabled={item.toggle.disabled}
						title={item.toggle.checked ? 'Disable module' : 'Enable module'}
						onClick={(e,) => e.stopPropagation()}
						onChange={(e,) => item.toggle!.onChange(e.target.checked,)}
					/>
				)}
				<span className={css.tabTitle}>{item.title}</span>
			</button>
		)
	}

	// Partition items into segments: normal (rendered inline) and scrollable sections.
	// Consecutive scrollable sections are merged into a single scrollable wrapper so that
	// flex layout doesn't give each section equal height and leave empty space between them.
	type ScrollableItem = WindowTab | {kind: 'sectionDivider'; label: string}
	type Segment =
		| {scrollable: false; items: WindowTabItem[]}
		| {scrollable: true; items: ScrollableItem[]}
	const segments: Segment[] = []
	let currentNormal: WindowTabItem[] | null = null

	for (const item of tabs) {
		const lastSeg = segments[segments.length - 1]
		if (isSection(item,) && item.scrollable) {
			// Extend an existing scrollable wrapper rather than starting a new one, so
			// all module sections share one flex container and don't expand unevenly.
			if (lastSeg?.scrollable) {
				;(lastSeg as {scrollable: true; items: ScrollableItem[]}).items.push({
					kind: 'sectionDivider',
					label: item.label,
				},)
			} else {
				currentNormal = null
				segments.push({scrollable: true, items: [{kind: 'sectionDivider', label: item.label,},],},)
			}
		} else if (lastSeg?.scrollable && !isSection(item,)) {
			;(lastSeg as {scrollable: true; items: ScrollableItem[]}).items.push(item,)
		} else {
			if (!currentNormal) {
				const seg: Segment = {scrollable: false, items: [],}
				segments.push(seg,)
				currentNormal = seg.items
			}
			currentNormal.push(item,)
		}
	}

	const renderSegments = () => {
		const result: ReactNode[] = []
		let itemKey = 0
		for (const seg of segments) {
			if (!seg.scrollable) {
				for (const item of seg.items) {
					if (isSection(item,)) {
						result.push(
							<div key={`section-${itemKey}`} className={css.sectionHeader} role="presentation">
								{item.label}
							</div>,
						)
					} else {
						result.push(renderTabButton(item, itemKey,),)
					}
					itemKey++
				}
			} else {
				// Group scrollable items into collapsible sections: [{label, tabs}]
				type CollapsibleGroup = {label: string; tabs: WindowTab[]}
				const groups: CollapsibleGroup[] = []
				for (const item of seg.items) {
					if ('kind' in item && item.kind === 'sectionDivider') {
						groups.push({label: item.label, tabs: [],},)
					} else {
						groups[groups.length - 1]!.tabs.push(item as WindowTab,)
					}
				}

				const sectionContents = groups.map((group,) => {
					// Hide the entire group if every tab in it is filtered out.
					const allHidden = group.tabs.every((tab,) => hiddenTabIndices?.has(tabIndexMap.get(tab,) ?? -1,))
					if (allHidden) { return null }

					const isCollapsed = collapsedSections.has(group.label,)
					return (
						<div key={group.label}>
							<button
								type="button"
								className={css.sectionHeaderToggle}
								onClick={() => toggleSection(group.label,)}
								aria-expanded={!isCollapsed}
							>
								<span
									className={classes(css.sectionChevron, isCollapsed && css.sectionChevronCollapsed,)}
								/>
								{group.label}
							</button>
							{!isCollapsed && group.tabs.map((tab, i,) => renderTabButton(tab, `${group.label}-${i}`,))}
						</div>
					)
				},)

				result.push(
					<div key={`scrollsection-${itemKey}`} className={css.scrollableSectionWrapper}>
						<div className={css.scrollableSection}>
							{sectionContents}
						</div>
					</div>,
				)
			}
		}
		return result
	}

	return (
		<div className={classes(css.wrapper, vertical && css.vertical, className,)}>
			<div className={css.tabs} role={hideTabButtons ? undefined : 'tablist'}>
				{sidebarHeader}
				{!hideTabButtons && renderSegments()}
			</div>
			<div
				className={css.content}
				role="tabpanel"
				id={`${panelId}-panel-${activeIndex}`}
				aria-labelledby={`${panelId}-tab-${activeIndex}`}
			>
				<div key={contentOverride ? 'override' : activeIndex} className={css.tabScrollArea}>
					{contentOverride ?? selectableTabs[activeIndex]?.content}
				</div>
				{footer != null && (
					<div className={css.tabFooter}>
						{footer}
					</div>
				)}
			</div>
		</div>
	)
}
