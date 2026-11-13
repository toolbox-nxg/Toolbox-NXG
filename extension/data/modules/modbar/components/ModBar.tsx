/** The Mod Bar React component: the persistent toolbar with counters, shortcuts, drawers, and version/reload controls. */
import {useEffect, useRef, useState,} from 'react'
import browser from 'webextension-polyfill'

import {getModSubs,} from '../../../api/resources/modSubs'
import type {TbReloadMessage,} from '../../../background/messages'
import {LocationRenderers,} from '../../../dom/uiLocations'
import {config, genSettings, modbar, modmail, usernotes,} from '../../../framework/moduleIds'
import TBModule from '../../../framework/moduleRegistry'
import {Icon,} from '../../../shared/controls/Icon'
import {ModbarButton,} from '../../../shared/controls/ModbarButton'
import {negativeTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import {htmlEncode, tbDecode,} from '../../../util/data/encoding'
import {buildType,} from '../../../util/infra/buildenv'
import createLogger from '../../../util/infra/logging'
import {currentPlatform, getDirectingTo,} from '../../../util/infra/platform'
import {getLastVersion, toolboxVersion, versionNumber,} from '../../../util/infra/version'
import {getModuleSettingAsync,} from '../../../util/persistence/settings'
import {useMountEffect, useSetting,} from '../../../util/ui/hooks'
import {reloadPage,} from '../../../util/ui/navigation'
import {classes,} from '../../../util/ui/reactMount'
import {type CounterState, subscribeCounters,} from '../../notifier/store'
import type {ApiBudgetStore,} from '../schema'
import {ApiBudgetIndicator,} from './ApiBudgetIndicator'
import {MySubredditsPopup,} from './MySubredditsPopup'
import {RecentActionsPopup,} from './RecentActionsPopup'

const log = createLogger('Modbar',)

/** Modmail categories shown in the modbar hover tooltip, in display order. */
const modmailTooltipCategories: ReadonlyArray<{rowClass: string; path: string; label: string; key: string}> = [
	{rowClass: 'toolbox-modmail-new', path: 'new', label: 'New', key: 'new',},
	{rowClass: 'toolbox-modmail-inprogress', path: 'inprogress', label: 'In Progress', key: 'inprogress',},
	{rowClass: 'toolbox-modmail-banappeals', path: 'appeals', label: 'Ban Appeals', key: 'appeals',},
	{rowClass: 'toolbox-modmail-joinrequests', path: 'join_requests', label: 'Join Requests', key: 'join_requests',},
	{rowClass: 'toolbox-modmail-highlighted', path: 'highlighted', label: 'Highlighted', key: 'highlighted',},
	{rowClass: 'toolbox-modmail-mod', path: 'mod', label: 'Mod Discussions', key: 'mod',},
	{rowClass: 'toolbox-modmail-notifications', path: 'notifications', label: 'Notifications', key: 'notifications',},
]

function reloadToolbox () {
	positiveTextFeedback('Toolbox-NXG is reloading', {duration: 10000,},)
	browser.runtime.sendMessage({action: 'toolbox-reload',} satisfies TbReloadMessage,).then(() => {
		reloadPage()
	},).catch((error: unknown,) => {
		log.error('Failed to send reload message:', error,)
	},)
}

/** Props for the ModBar component. */
interface ModBarProps {
	/** Name-to-URL map of user-defined shortcut links shown in the bar. */
	shortcuts: Record<string, string>
	/** When `true`, the collapsed bar is a compact dot menu without the hover counts tooltip. */
	compactHide: boolean
	/** Whether to show the count badges beside the counter icons. */
	showCounters: boolean
	/** Whether to show the unmoderated queue counter and icon. */
	unmoderatedOn: boolean
	/** Whether to show the "Moderated Subreddits" drawer button. */
	enableModSubs: boolean
	/** Whether to show the old/new Reddit toggle link. */
	enableOldNewToggle: boolean
	/** Salt for deterministic subreddit accent-color generation. */
	subredditColorSalt: string
	/** Whether the bar starts in the hidden state (the stored state; later changes from other tabs are followed). */
	initialHidden: boolean
	modmailUrl: string
	modQueueUrl: string
	/** URL for the unmoderated queue, or `null` if the unmoderated icon is disabled. */
	unModQueueUrl: string | null
	/** Whether Notifier notifications are switched on (affects hover tooltip behavior). */
	notifierEnabled: boolean
	/** Whether debug mode is on (shows the reload-toolbox button). */
	debugMode: boolean
	/** Live API budget for the debug readout; present only when debug mode is on. */
	apiBudget?: ApiBudgetStore
	initialCounters: CounterState
	/** Callback to persist a modbar setting change. */
	setSetting: (key: 'modbarHidden', value: boolean,) => void
	/** Called once after the bar first renders, used to resolve the `modbarExists` promise. */
	onMount: () => void
}

/** Lazily-loaded data needed to render the MySubredditsPopup drawer. */
type MySubsRef = {
	data: {subreddit: string}[]
	configEnabled: boolean
	usernotesEnabled: boolean
}

export function ModBar ({
	shortcuts,
	compactHide,
	showCounters,
	unmoderatedOn,
	enableModSubs,
	enableOldNewToggle,
	subredditColorSalt,
	initialHidden,
	modmailUrl,
	modQueueUrl,
	unModQueueUrl,
	notifierEnabled,
	debugMode,
	apiBudget,
	initialCounters,
	setSetting,
	onMount,
}: ModBarProps,) {
	const [counters, setCounters,] = useState<CounterState>(initialCounters,)
	const [hidden, setHidden,] = useState(initialHidden,)
	// Follow collapse/expand from other tabs: the stored value changes via the settings store's
	// storage listener, and adopting it during render (React's "adjust state on prop change"
	// pattern) keeps every open tab in step without an extra effect pass.
	const storedHidden = useSetting(modbar, 'modbarHidden', initialHidden,)
	const [lastStoredHidden, setLastStoredHidden,] = useState(storedHidden,)
	if (storedHidden !== lastStoredHidden) {
		setLastStoredHidden(storedHidden,)
		setHidden(storedHidden,)
	}
	// Off swaps the label for a once-per-tab reminder popup (see the Announcements module).
	const showPrereleaseLabel = useSetting(modbar, 'showPrereleaseLabel', true,)
	// The Modmail module's "open in a new tab" setting, applied here because the bar renders
	// these links (and manages old Reddit's header icon) on both platforms. Must match that
	// module's `enabledByDefault: true`.
	const modmailEnabled = useSetting(modmail, 'enabled', true,)
	const modmailNewTabSetting = useSetting(modmail, 'openInNewTab', false,)
	const modmailInNewTab = modmailEnabled && modmailNewTabSetting
	const modmailLinkTarget = modmailInNewTab ? {target: '_blank', rel: 'noopener',} : {}
	// The collapsed button sits on the same side as the context menu.
	const collapsedOnRight = useSetting<'left' | 'right'>(genSettings, 'contextMenuLocation', 'left',) === 'right'
	const [mmTooltipVisible, setMmTooltipVisible,] = useState(false,)
	const [modhidTooltipVisible, setModhidTooltipVisible,] = useState(false,)
	const [mySubsRef, setMySubsRef,] = useState<MySubsRef | null>(null,)
	const [firstRun, setFirstRun,] = useState(false,)

	const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined,)
	const [activeDrawer, setActiveDrawer,] = useState<'mySubs' | 'recentActions' | null>(null,)

	// Seeded once and refreshed on each shreddit URL change so the toggle's target
	// tracks the current page; on old Reddit full reloads remount the bar instead.
	const [toggleConfig, setToggleConfig,] = useState(() => enableOldNewToggle ? getDirectingTo() : null)

	useMountEffect(() => {
		onMount()
	},)

	useEffect(() => {
		if (!enableOldNewToggle) { return }
		const handler = () => setToggleConfig(getDirectingTo(),)
		window.addEventListener('TBNewPage', handler,)
		return () => window.removeEventListener('TBNewPage', handler,)
	}, [enableOldNewToggle,],)

	useEffect(() => subscribeCounters(setCounters,), [],)

	useEffect(() => {
		document.body.classList.toggle('toolbox-modbar-shown', !hidden,)
		setSetting('modbarHidden', hidden,)
	}, [hidden, setSetting,],)

	useEffect(() => () => {
		document.body.classList.remove('toolbox-modbar-shown',)
		clearTimeout(hoverTimeoutRef.current,)
	}, [],)

	useMountEffect(() => {
		if (!enableModSubs) { return }
		let cancelled = false
		getModSubs(true,).then(async (rawSubsData,) => {
			const mySubsData = rawSubsData as {subreddit: string}[]
			if (cancelled || !mySubsData.length) { return }
			// Both modules declare `enabledByDefault: true`, so the fallback here must
			// match - otherwise a user who never explicitly toggled them has no stored
			// `enabled` value and the per-row icons would wrongly be hidden.
			const [configEnabled, usernotesEnabled,] = await Promise.all([
				getModuleSettingAsync(config, 'enabled', true,),
				getModuleSettingAsync(usernotes, 'enabled', true,),
			],)
			if (cancelled) { return }
			log.debug('got mod subs', mySubsData.length,)
			setMySubsRef({data: mySubsData, configEnabled, usernotesEnabled,},)
		},).catch((error: unknown,) => {
			log.error('Failed to load moderated subreddits:', error,)
		},)
		return () => {
			cancelled = true
		}
	},)

	useEffect(() => {
		getLastVersion().then((lastVersion,) => {
			setFirstRun(lastVersion < versionNumber,)
		},).catch((error: unknown,) => {
			log.error('Failed to read last version:', error,)
		},)
	}, [],)

	useEffect(() => {
		const modmailEl = document.getElementById('new_modmail',)
		if (!modmailEl) { return }
		if (counters.modmailCount < 1) {
			modmailEl.classList.remove('havemail',)
			modmailEl.classList.add('nohavemail',)
			modmailEl.title = 'no new mod mail!'
		} else {
			modmailEl.classList.remove('nohavemail',)
			modmailEl.classList.add('havemail',)
			modmailEl.title = 'new mod mail!'
		}
	}, [counters.modmailCount,],)

	useEffect(() => {
		const modmailEl = document.getElementById('new_modmail',)
		if (!modmailEl) { return }
		if (modmailInNewTab) {
			modmailEl.setAttribute('target', '_blank',)
			modmailEl.setAttribute('rel', 'noopener',)
		} else {
			modmailEl.removeAttribute('target',)
			modmailEl.removeAttribute('rel',)
		}
	}, [modmailInNewTab,],)

	const handleToggle = () => setHidden((h,) => !h)

	// Modmail tooltip uses delayed dismissal (1 s) so the user can move the cursor into it.
	// Modhid tooltip dismisses immediately - it is display-only with no interactive content.
	// The asymmetry is intentional; do not unify into a shared hook.
	const handleMmMouseenter = () => {
		clearTimeout(hoverTimeoutRef.current,)
		setMmTooltipVisible(true,)
	}

	const handleMmMouseleave = () => {
		hoverTimeoutRef.current = setTimeout(() => setMmTooltipVisible(false,), 1000,)
	}

	const handleModhidMouseenter = () => {
		if (!notifierEnabled || compactHide) { return }
		setModhidTooltipVisible(true,)
	}

	const handleModhidMouseleave = () => {
		setModhidTooltipVisible(false,)
	}

	const handleSettingsClick = () => {
		setFirstRun(false,)
		TBModule.showSettings()
	}

	const handleMySubsClick = () => {
		if (!mySubsRef) { return }
		setActiveDrawer((d,) => d === 'mySubs' ? null : 'mySubs')
	}

	const handleRecentActionsClick = () => {
		setActiveDrawer((d,) => d === 'recentActions' ? null : 'recentActions')
	}

	const handlePrereleaseClick = () => {
		navigator.clipboard.writeText(toolboxVersion,).then(() => {
			positiveTextFeedback('Copied version information to clipboard',)
		},).catch((error: unknown,) => {
			const message = error instanceof Error ? error.message : String(error,)
			negativeTextFeedback(`Failed to copy version info: ${message}`,)
		},)
	}

	const {modqueueCount, unmoderatedCount, modmailCount, modmailCategoryCount,} = counters
	const hasModmail = modmailCount > 0

	if (hidden) {
		return (
			<>
				<div
					className={classes(
						'toolbox-bottombar-hidden',
						compactHide && 'toolbox-bottombar-compact',
						collapsedOnRight && 'toolbox-bottombar-hidden-right',
					)}
				>
					<a
						className="toolbox-bottombar-unhide toolbox-icons"
						onClick={handleToggle}
						onMouseEnter={handleModhidMouseenter}
						onMouseLeave={handleModhidMouseleave}
					>
						<Icon icon={compactHide ? 'dotMenu' : collapsedOnRight ? 'arrowLeft' : 'arrowRight'} />
					</a>
				</div>
				{modhidTooltipVisible && (
					<div
						className={classes(
							'toolbox-modbar-hide-tooltip',
							collapsedOnRight && 'toolbox-modbar-hide-tooltip-right',
						)}
					>
						<table>
							<tbody>
								<tr>
									<td>Mod Queue</td>
									<td>{modqueueCount}</td>
								</tr>
								<tr>
									<td>Unmoderated Queue</td>
									<td>{unmoderatedCount}</td>
								</tr>
								<tr>
									<td>Mod Mail</td>
									<td>{modmailCount}</td>
								</tr>
							</tbody>
						</table>
					</div>
				)}
			</>
		)
	}

	return (
		<div className={classes('toolbox-bottombar', !showCounters && 'toolbox-bottombar-no-counters',)}>
			<a
				className="toolbox-bottombar-hide toolbox-icons"
				onClick={handleToggle}
			>
				<Icon icon="arrowLeft" />
			</a>
			<a
				className="toolbox-toolbar-new-settings toolbox-icons"
				title="Toolbox-NXG settings"
				onClick={handleSettingsClick}
			>
				<Icon icon="settings" />
			</a>
			{firstRun && <label className="toolbox-first-run">&#060;-- Click for settings</label>}
			<span className="toolbox-bottombar-contentleft">
				{mySubsRef && (
					<ModbarButton className="toolbox-toolbar-mysubs" onClick={handleMySubsClick}>
						Moderated Subreddits
					</ModbarButton>
				)}
				<ModbarButton
					className="toolbox-toolbar-recent-actions"
					onClick={handleRecentActionsClick}
				>
					Recent Actions
				</ModbarButton>
				<LocationRenderers
					location="modbarContent"
					context={{platform: currentPlatform ?? 0, kind: 'modbar',}}
					target={document.body}
				/>
				{toggleConfig && (
					<ModbarButton
						href={toggleConfig.url}
						className="toolbox-old-new-reddit-toggle"
						title={`View this page in ${toggleConfig.directingTo}`}
					>
						Open in {toggleConfig.directingTo}
					</ModbarButton>
				)}
				<span className="toolbox-toolbarshortcuts">
					{Object.entries(shortcuts,).map(([name, url,],) => (
						<a
							key={name}
							className="toolbox-no-gustavobc"
							href={htmlEncode(tbDecode(url,),)}
						>
							{htmlEncode(tbDecode(name,),)}
						</a>
					))}
				</span>
			</span>
			<span className="toolbox-bottombar-contentright">
				{buildType !== 'stable' && showPrereleaseLabel && (
					<button
						className="toolbox-prerelease-link"
						title={`this is a ${buildType} build of Toolbox-NXG. click to copy version information`}
						onClick={handlePrereleaseClick}
					>
						<Icon icon="prerelease" />
						<span>{toolboxVersion}</span>
					</button>
				)}
				{apiBudget && <ApiBudgetIndicator store={apiBudget} />}
				{debugMode && (
					<a
						className="toolbox-icons toolbox-reload-link"
						title="reload Toolbox-NXG"
						onClick={reloadToolbox}
					>
						<Icon icon="tbReload" />
					</a>
				)}
				<LocationRenderers
					location="modbar"
					context={{platform: currentPlatform ?? 0, kind: 'modbar',}}
					target={document.body}
				/>
				<span className="toolbox-toolbarcounters">
					<LocationRenderers
						location="modbarCounters"
						context={{platform: currentPlatform ?? 0, kind: 'modbar',}}
						target={document.body}
					/>
					<a
						href={modmailUrl}
						{...modmailLinkTarget}
						className={`toolbox-modmail ${
							hasModmail ? 'havemail' : 'nohavemail'
						} access-required toolbox-icons`}
						onMouseEnter={handleMmMouseenter}
						onMouseLeave={handleMmMouseleave}
					>
						<Icon icon="modmail" />
					</a>
					<a
						href={modmailUrl}
						{...modmailLinkTarget}
						className="toolbox-modmailcount"
						onMouseEnter={handleMmMouseenter}
						onMouseLeave={handleMmMouseleave}
					>
						<span className="toolbox-counter-badge">{modmailCount}</span>
					</a>
					<a
						title="modqueue"
						href={modQueueUrl}
						className="toolbox-icons toolbox-modqueue"
					>
						<Icon icon="modqueue" />
					</a>
					<a href={modQueueUrl} className="toolbox-queueCount">
						<span className="toolbox-counter-badge">{modqueueCount}</span>
					</a>
					{unmoderatedOn && unModQueueUrl && (
						<>
							<a
								title="unmoderated"
								href={unModQueueUrl}
								className="toolbox-icons toolbox-unmoderated"
							>
								<Icon icon="unmoderated" />
							</a>
							<a href={unModQueueUrl} className="toolbox-unmoderatedCount">
								<span className="toolbox-counter-badge">{unmoderatedCount}</span>
							</a>
						</>
					)}
				</span>
			</span>
			{activeDrawer === 'mySubs' && mySubsRef && (
				<MySubredditsPopup
					subs={mySubsRef.data}
					subredditColorSalt={subredditColorSalt}
					configEnabled={mySubsRef.configEnabled}
					usernotesEnabled={mySubsRef.usernotesEnabled}
					queueCounts={counters.modqueueBySubreddit}
					onClose={() => setActiveDrawer(null,)}
				/>
			)}
			{activeDrawer === 'recentActions' && (
				<RecentActionsPopup onClose={() => setActiveDrawer(null,)} />
			)}
			<div
				className="toolbox-modmail-tooltip"
				style={{display: mmTooltipVisible ? 'block' : 'none',}}
				onMouseEnter={handleMmMouseenter}
				onMouseLeave={handleMmMouseleave}
			>
				<table>
					<tbody>
						{modmailTooltipCategories.map(({rowClass, path, label, key,},) => (
							<tr key={key} className={rowClass}>
								<td className="toolbox-new-mm-category">
									<a href={`https://www.reddit.com/mail/${path}`} {...modmailLinkTarget}>{label}</a>
								</td>
								<td className="toolbox-new-mm-count">{modmailCategoryCount[key] ?? ''}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	)
}
