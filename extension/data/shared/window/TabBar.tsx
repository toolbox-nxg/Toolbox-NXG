/** Horizontal tab bar with ARIA role="tablist" semantics. */

import {ReactNode,} from 'react'
import {classes,} from '../../util/ui/reactMount'
import css from './TabBar.module.css'

/** A single tab in the TabBar. */
export interface TabBarItem {
	/** Unique identifier for this tab. */
	id: string
	label: string
}

/**
 * Renders a horizontal row of tab buttons.
 * @param props Component properties.
 * @param tabs List of tabs to render.
 * @param activeTab The `id` of the currently selected tab.
 * @param onTabChange Called with the tab `id` when the user clicks a different tab.
 * @param ariaLabel Accessible label for the tablist element.
 */
export function TabBar ({tabs, activeTab, onTabChange, ariaLabel, actions,}: {
	tabs: TabBarItem[]
	activeTab: string
	onTabChange: (id: string,) => void
	ariaLabel?: string
	/** Content placed at the far right of the tab bar, outside the tablist role. */
	actions?: ReactNode
},) {
	return (
		<div className={css.tabBar}>
			<div role="tablist" aria-label={ariaLabel} className={css.tabList}>
				{tabs.map((tab,) => (
					<button
						key={tab.id}
						type="button"
						role="tab"
						aria-selected={activeTab === tab.id}
						className={classes(css.tab, activeTab === tab.id && css.tabActive,)}
						onClick={() => onTabChange(tab.id,)}
					>
						{tab.label}
					</button>
				))}
			</div>
			{actions != null && <div className={css.tabBarActions}>{actions}</div>}
		</div>
	)
}
