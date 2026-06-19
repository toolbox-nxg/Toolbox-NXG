/** Modal dialog with a vertical sidebar tab list, used as the shell for the Toolbox settings dialog. */

import {ReactNode, useState,} from 'react'
import {FullPageDialog,} from './FullPageDialog'
import css from './TabbedDialog.module.css'
import {isSection, WindowTab, WindowTabItem, WindowTabs,} from './WindowTabs'

/**
 * Renders a modal dialog with a vertical tab sidebar.
 * @param props Component properties.
 * @param title Dialog title shown in the header.
 * @param tabs Array of tab and section-header items.
 * @param defaultTabIndex Index of the initially selected tab.
 * @param width Maximum dialog width in pixels.
 * @param onClose Called when the user closes the dialog.
 * @param onTabChange Called with the new active tab index when the user switches tabs.
 */
export const TabbedDialog = ({
	title,
	tabs,
	defaultTabIndex = 0,
	footer,
	width = 940,
	onClose,
	onTabChange,
	sidebarHeader,
	hideTabButtons = false,
	hiddenTabIndices,
	contentOverride,
}: {
	title: ReactNode
	tabs: WindowTabItem[]
	defaultTabIndex?: number
	/** Global footer shown when the active tab provides no per-tab footer. */
	footer?: ReactNode
	width?: number
	onClose?: () => void
	onTabChange?: (index: number,) => void
	/** Content rendered above the tab list in the sidebar */
	sidebarHeader?: ReactNode
	/** If true, hides the tab buttons while still rendering sidebarHeader and content */
	hideTabButtons?: boolean
	/** Set of tab indices whose buttons should be hidden in the sidebar */
	hiddenTabIndices?: Set<number> | undefined
	/** When set, shown in the content pane instead of the active tab's content */
	contentOverride?: ReactNode | undefined
},) => {
	const [activeTabIndex, setActiveTabIndex,] = useState(defaultTabIndex,)

	const handleTabChange = (i: number,) => {
		setActiveTabIndex(i,)
		onTabChange?.(i,)
	}

	const selectableTabs = tabs.filter((t,): t is WindowTab => !isSection(t,))
	const activeFooter = selectableTabs[activeTabIndex]?.footer ?? footer

	return (
		<FullPageDialog title={title} {...(onClose && {onClose,})} width={width}>
			<WindowTabs
				vertical
				className={css.tabsContainer}
				tabs={tabs}
				defaultTabIndex={defaultTabIndex}
				onTabChange={handleTabChange}
				footer={activeFooter}
				sidebarHeader={sidebarHeader}
				hideTabButtons={hideTabButtons}
				hiddenTabIndices={hiddenTabIndices}
				contentOverride={contentOverride}
			/>
		</FullPageDialog>
	)
}
