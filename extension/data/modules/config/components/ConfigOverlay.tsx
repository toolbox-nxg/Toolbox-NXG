/** Generic tabbed configuration overlay component used by the Config module to display subreddit settings. */
import {Component, ReactNode, useState,} from 'react'
import {Provider,} from 'react-redux'

import {utils,} from '../../../framework/moduleIds'
import {TabbedDialog,} from '../../../shared/window/TabbedDialog'
import {WindowTabItem,} from '../../../shared/window/WindowTabs'
import store from '../../../store'
import {useSetting,} from '../../../util/ui/hooks'
import {mountReactInBody,} from '../../../util/ui/reactMount'

/** Describes a single tab in a `ConfigOverlay`. */
export interface ConfigOverlayTab {
	/** Explicit tab ID; if omitted, derived from `title`. */
	id?: string
	/** Tab label shown in the tab bar. */
	title: string
	/** Tooltip shown on the tab. */
	tooltip?: string
	/** React node for tab body - lazy-mounted (only rendered when the tab is active). */
	contentNode?: ReactNode
	/** Footer content rendered below the tab body. */
	footer?: ReactNode
	/** When true the tab is only visible when advanced mode is enabled. */
	advanced?: boolean
}

/** Options for opening a `ConfigOverlay`. */
export interface ConfigOverlayOptions {
	/** Window title displayed in the overlay header. */
	title: string
	/** List of tabs to render. */
	tabs: ConfigOverlayTab[]
	/** CSS class used to deduplicate overlays; a second call with the same class returns the existing handle. */
	cssClass?: string
	details?: Record<string, string | undefined>
	/** Called after the overlay is closed and unmounted. */
	onClose?: () => void
}

/** Handle returned by `showConfigOverlay`, allowing callers to imperatively switch tabs or close the overlay. */
export interface ConfigOverlayHandle {
	/** Switches the active tab by its derived ID. */
	switchTab: (tabId: string,) => void
	/** Replaces the overlay's tab list in place, without remounting or losing the active tab. */
	setTabs: (tabs: ConfigOverlayTab[],) => void
	/** Unmounts and removes the overlay. */
	close: () => void
}

function deriveTabId (tab: ConfigOverlayTab,) {
	if (tab.id) { return tab.id }
	if (tab.title) { return tab.title.trim().toLowerCase().replace(/\s/g, '_',) }
	return ''
}

interface ConfigOverlayProps extends ConfigOverlayOptions {
	setActiveIndexRef: {current: ((index: number,) => void) | null}
	setTabsRef: {current: ((tabs: ConfigOverlayTab[],) => void) | null}
	onCloseHandler: () => void
}

class TabErrorBoundary extends Component<{children: ReactNode}, {error: Error | null}> {
	constructor (props: {children: ReactNode},) {
		super(props,)
		this.state = {error: null,}
	}

	static getDerivedStateFromError (error: Error,) {
		return {error,}
	}

	override render () {
		if (this.state.error) {
			return (
				<div style={{padding: '16px', color: 'var(--toolbox-text-secondary)',}}>
					<strong>Error loading this tab:</strong> {this.state.error.message}
				</div>
			)
		}
		return this.props.children
	}
}

function ConfigOverlay ({
	title,
	tabs: initialTabs,
	setActiveIndexRef,
	setTabsRef,
	onCloseHandler,
}: ConfigOverlayProps,) {
	const advancedMode = useSetting(utils, 'advancedMode', false,)
	// Tabs are held in state so callers can swap them live (e.g. toggling retired
	// usernote shard tabs) without remounting the overlay or losing the loaded config.
	const [tabs, setTabs,] = useState(initialTabs,)
	const visibleTabs = tabs.filter((t,) => advancedMode || !t.advanced)
	const [activeIndex, setActiveIndex,] = useState(0,)

	setActiveIndexRef.current = setActiveIndex
	setTabsRef.current = setTabs

	const windowTabs: WindowTabItem[] = []
	let advancedHeaderAdded = false
	visibleTabs.forEach((tab, i,) => {
		if (tab.advanced && !advancedHeaderAdded) {
			windowTabs.push({kind: 'section', label: 'Advanced',},)
			advancedHeaderAdded = true
		}
		windowTabs.push({
			title: tab.title,
			...(tab.tooltip != null && {tooltip: tab.tooltip,}),
			content: activeIndex === i
				? <TabErrorBoundary key={i}>{tab.contentNode}</TabErrorBoundary>
				: null,
			...(tab.footer != null && {footer: tab.footer,}),
		},)
	},)

	return (
		<TabbedDialog
			title={title}
			tabs={windowTabs}
			defaultTabIndex={0}
			onClose={onCloseHandler}
			onTabChange={setActiveIndex}
		/>
	)
}

const handlesByClass = new Map<string, ConfigOverlayHandle>()

/**
 * Mounts a `ConfigOverlay` into the page body, deduplicating by `options.cssClass`.
 * @returns A handle for switching tabs or closing the overlay.
 */
export function showConfigOverlay (options: ConfigOverlayOptions,): ConfigOverlayHandle {
	if (options.cssClass) {
		const existing = handlesByClass.get(options.cssClass,)
		if (existing) { return existing }
	}

	const setActiveIndexRef: {current: ((index: number,) => void) | null} = {current: null,}
	const setTabsRef: {current: ((tabs: ConfigOverlayTab[],) => void) | null} = {current: null,}
	// Tracks the live tab list so switchTab maps ids against the current tabs,
	// not the stale set the overlay was first opened with.
	let currentTabs = options.tabs

	let mounted: {host: HTMLElement; unmount: () => void} | null = null
	const close = () => {
		if (!mounted) { return }
		mounted.unmount()
		mounted = null
		if (options.cssClass) { handlesByClass.delete(options.cssClass,) }
		options.onClose?.()
	}

	const overlayContent: ReactNode = (
		<Provider store={store}>
			<ConfigOverlay
				{...options}
				setActiveIndexRef={setActiveIndexRef}
				setTabsRef={setTabsRef}
				onCloseHandler={close}
			/>
		</Provider>
	)

	mounted = mountReactInBody(overlayContent,)

	const handle: ConfigOverlayHandle = {
		switchTab: (tabId,) => {
			// Map string id -> numeric index using the same visible-tabs list
			const advancedMode = store.getState().settings.values['Toolbox.Utils.advancedMode'] as boolean
			const visibleTabs = currentTabs.filter((t,) => advancedMode || !t.advanced)
			const index = visibleTabs.findIndex((t,) => deriveTabId(t,) === tabId)
			if (index >= 0) { setActiveIndexRef.current?.(index,) }
		},
		setTabs: (tabs,) => {
			currentTabs = tabs
			setTabsRef.current?.(tabs,)
		},
		close,
	}

	if (options.cssClass) { handlesByClass.set(options.cssClass, handle,) }

	return handle
}

/** Drop-in replacement for legacyWindow's `switchOverlayTab(overlayClass, tabId)`. */
export function switchConfigOverlayTab (overlayClass: string, tabId: string,) {
	handlesByClass.get(overlayClass,)?.switchTab(tabId,)
}
