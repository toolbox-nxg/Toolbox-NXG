/** Handler factory for opening the subreddit config overlay. */
import {readFromWiki,} from '../../api/resources/wiki'
import {addContextItem, removeContextItem,} from '../../store/contextMenu'

import {isModSub,} from '../../api/resources/modSubs'
import {ActionButton,} from '../../shared/controls/ActionButton'
import {SortModeRef, SortToggleButton,} from '../../shared/controls/SortToggleButton'
import {negativeTextFeedback,} from '../../store/feedback'
import {purifyObject,} from '../../util/data/purify'
import {TBPageContext,} from '../../util/reddit/pageContext'
import type {SaveRef,} from '../../util/ui/hooks'
import {
	config as defaultConfig,
	ConfigState,
	isConfigValidVersion,
	normalizeConfig,
} from '../../util/wiki/schemas/config/schema'
import {
	listRetiredUsernoteShardPages,
	listUsernoteShardPages,
	shardPagePath,
} from '../../util/wiki/schemas/usernotes/sharded'
import {getWikiReadPath,} from '../../util/wiki/wikiPaths'
import {DomainTagsTab,} from '../domaintagger/components/DomainTagsTab'
import {ModMacroList,} from '../macros/components/ModMacroList'
import {BanMacroTab,} from '../modbutton/components/BanMacroTab'
import {TrainingSettingsTab,} from '../proposals/components/TrainingSettingsTab'
import {RemovalReasonList,} from '../removalreasons/components/RemovalReasonList'
import {RemovalSettingsTab,} from '../removalreasons/components/RemovalSettingsTab'
import {saveRemovalConfig,} from '../removalreasons/moduleapi'
import {UsernotesSettingsTab,} from '../usernotes/components/UsernotesSettingsTab'
import {UsernoteTypeList, UsernoteTypeListFooter,} from '../usernotes/components/UsernoteTypeList'
import {AddNewButton,} from './components/AddNewButton'
import {CompatibilityTab,} from './components/CompatibilityTab'
import {showConfigOverlay,} from './components/ConfigOverlay'
import type {ConfigOverlayHandle, ConfigOverlayTab,} from './components/ConfigOverlay'
import {SettingsHomeTab,} from './components/SettingsHomeTab'
import {WikiEditorFooter,} from './components/WikiEditorFooter'
import {WikiEditorTab,} from './components/WikiEditorTab'
import type {HistoryRef,} from './components/WikiEditorTab'
import {saveToolboxConfig,} from './moduleapi'

/** Handlers for opening and navigating the config overlay, returned by `createConfigOpenHandlers`. */
export interface ConfigOpenHandlers {
	/** Updates the context menu config link when the page changes. */
	handleNewPage: (event: CustomEvent<TBPageContext>,) => Promise<void>
	/** Opens the config overlay for the subreddit stored in the clicked element's `data-subreddit` attribute. */
	handleConfigLinkClick: (element: Element,) => void
	/** Opens the Toolbox live-docs wiki page for the module stored in the clicked element's `data-module` attribute. */
	handleConfigHelpClick: (element: Element,) => void
	/** Opens the config overlay for the subreddit specified in the event detail. */
	handleOpenConfigEvent: (event: Event,) => void
	/** Loads the wiki config and opens the config overlay for `subreddit`. */
	openConfigForSubreddit: (subreddit: string,) => void
}

/** Ref-based callback slot for controlling a button's disabled state. */
type DisabledRef = {current: ((disabled: boolean,) => void) | null}

/** One usernotes shard page to expose as a raw-editor tab in the overlay. */
interface ShardTabInfo {
	/** The shard's page-name suffix (e.g. `s1-00000000`). */
	suffix: string
	/** Whether the manifest still references the page; retired pages are tombstoned split leftovers. */
	active: boolean
}

/**
 * Builds one advanced raw-editor tab for an NXG usernotes shard page. Each
 * tab gets its own save/revision-note/history ref trio, since shard tabs are
 * created dynamically from the manifest rather than from the static refs in
 * {@link buildConfigTabs}.
 * @param subredditConfig The subreddit the overlay is editing.
 * @param shard The shard page to build a tab for.
 */
function buildShardTab (subredditConfig: string, shard: ShardTabInfo,): ConfigOverlayTab {
	const {suffix, active,} = shard
	const saveRef: SaveRef = {current: null,}
	const revisionNoteRef = {current: '',}
	const historyRef: HistoryRef = {current: null,}
	const literalPage = shardPagePath(suffix,)
	return {
		title: `Edit usernotes shard ${suffix}${active ? '' : ' (retired)'}`,
		tooltip: active
			? `Directly edit the raw usernotes shard page ${literalPage}.`
			: `Directly edit the retired usernotes shard page ${literalPage}. `
				+ 'The manifest no longer references this page; toolbox ignores its content.',
		advanced: true,
		contentNode: <WikiEditorTab
			subreddit={subredditConfig}
			page="usernotesShard"
			literalPage={literalPage}
			saveRef={saveRef}
			revisionNoteRef={revisionNoteRef}
			historyRef={historyRef}
		/>,
		footer: <WikiEditorFooter
			label="Save Page to Wiki"
			saveRef={saveRef}
			revisionNoteRef={revisionNoteRef}
			historyRef={historyRef}
		/>,
	}
}

function buildConfigTabs (
	subredditConfig: string,
	unManager: boolean,
	state: ConfigState,
	usernoteShards: ShardTabInfo[],
	onToggleRetiredShards: (checked: boolean,) => void,
): ConfigOverlayTab[] {
	const save = {
		usernote: {current: null,} as SaveRef,
		automod: {current: null,} as SaveRef,
		removalSettings: {current: null,} as SaveRef,
		domainTags: {current: null,} as SaveRef,
		domainTagsImport: {current: null,} as SaveRef,
		banMacro: {current: null,} as SaveRef,
		addRemovalReason: {current: null,} as SaveRef,
		addModMacro: {current: null,} as SaveRef,
		rawConfig: {current: null,} as SaveRef,
		rawUsernote: {current: null,} as SaveRef,
		usernoteSettings: {current: null,} as SaveRef,
		trainingSettings: {current: null,} as SaveRef,
	}
	const disabled = {
		addRemovalReason: {current: null,} as DisabledRef,
		addModMacro: {current: null,} as DisabledRef,
	}
	const revisionNote = {
		automod: {current: '',},
		rawConfig: {current: '',},
		rawUsernote: {current: '',},
	}
	// Wiki-history APIs assigned by each editor tab, consumed by its footer's
	// rollback dropdown.
	const history = {
		automod: {current: null,} as HistoryRef,
		rawConfig: {current: null,} as HistoryRef,
		rawUsernote: {current: null,} as HistoryRef,
	}

	// Connect each sortable card list to its footer's Reorder toggle.
	const usernoteSortMode: SortModeRef = {toggle: null, onChange: null,}
	const reasonSortMode: SortModeRef = {toggle: null, onChange: null,}
	const macroSortMode: SortModeRef = {toggle: null, onChange: null,}

	return [
		{
			title: 'Settings Home',
			tooltip: 'Pointers and handy links.',
			contentNode: (
				<SettingsHomeTab
					subreddit={subredditConfig}
					unManager={unManager}
					showRetiredShards={!!state.config.showRetiredUsernoteShards}
					onToggleRetiredShards={onToggleRetiredShards}
				/>
			),
		},
		{
			title: 'Edit usernote types',
			tooltip: 'Edit usernote types and colors here.',
			contentNode: <UsernoteTypeList state={state} saveRef={save.usernote} sortRef={usernoteSortMode} />,
			footer: <UsernoteTypeListFooter
				sortRef={usernoteSortMode}
				onSave={() => save.usernote.current?.()}
			/>,
		},
		{
			title: 'Usernotes settings',
			tooltip: 'Configure what a usernote must contain before it can be saved.',
			contentNode: <UsernotesSettingsTab
				state={state}
				saveRef={save.usernoteSettings}
				onSave={(config, reason,) => saveToolboxConfig(state.subreddit!, config, reason,)}
			/>,
			footer: <ActionButton primary type="button" onClick={() => save.usernoteSettings.current?.()}>
				Save usernotes settings
			</ActionButton>,
		},
		{
			title: 'Training mode',
			tooltip: 'Choose which moderators are in training and how long proposals are kept.',
			contentNode: <TrainingSettingsTab
				state={state}
				saveRef={save.trainingSettings}
				onSave={(config, reason,) => saveToolboxConfig(state.subreddit!, config, reason,)}
			/>,
			footer: <ActionButton primary type="button" onClick={() => save.trainingSettings.current?.()}>
				Save training mode settings
			</ActionButton>,
		},
		{
			title: 'Edit AutoModerator config',
			tooltip: 'Edit the AutoModerator config.',
			contentNode: <WikiEditorTab
				subreddit={subredditConfig}
				page="automoderator"
				saveRef={save.automod}
				revisionNoteRef={revisionNote.automod}
				historyRef={history.automod}
			/>,
			footer: <WikiEditorFooter
				label="Save Page to Wiki"
				saveRef={save.automod}
				revisionNoteRef={revisionNote.automod}
				historyRef={history.automod}
			/>,
		},
		{
			title: 'Removal reasons settings',
			tooltip: 'Configure the basic behavior for removal reasons here.',
			contentNode: <RemovalSettingsTab
				state={state}
				saveRef={save.removalSettings}
				onSave={(config, reason,) => saveRemovalConfig(state.subreddit!, config, reason,)}
			/>,
			footer: <ActionButton primary type="button" onClick={() => save.removalSettings.current?.()}>
				Save removal reasons settings
			</ActionButton>,
		},
		{
			title: 'Edit removal reasons',
			tooltip: 'Edit, add, and reorder your removal reasons here.',
			contentNode: <RemovalReasonList
				state={state}
				addRef={save.addRemovalReason}
				disabledRef={disabled.addRemovalReason}
				sortRef={reasonSortMode}
				onSave={(config, reason,) => saveRemovalConfig(state.subreddit!, config, reason,)}
			/>,
			footer: (
				<>
					<SortToggleButton sortRef={reasonSortMode} />
					<AddNewButton
						label="Add new removal reason"
						triggerRef={save.addRemovalReason}
						disabledRef={disabled.addRemovalReason}
					/>
				</>
			),
		},
		{
			title: 'Edit mod macros',
			tooltip: 'Edit, add, and reorder your mod macros here.',
			contentNode: <ModMacroList
				state={state}
				addRef={save.addModMacro}
				disabledRef={disabled.addModMacro}
				sortRef={macroSortMode}
			/>,
			footer: (
				<>
					<SortToggleButton sortRef={macroSortMode} />
					<AddNewButton
						label="Add new mod macro"
						triggerRef={save.addModMacro}
						disabledRef={disabled.addModMacro}
					/>
				</>
			),
		},
		{
			title: 'Domain tags',
			tooltip: 'Add, edit, or remove domain tags, or import them from another subreddit.',
			contentNode: <DomainTagsTab
				subreddit={subredditConfig}
				saveRef={save.domainTags}
				importRef={save.domainTagsImport}
			/>,
			footer: (
				<>
					<ActionButton type="button" onClick={() => save.domainTagsImport.current?.()}>
						Import domain tags
					</ActionButton>
					<ActionButton primary type="button" onClick={() => save.domainTags.current?.()}>
						Save domain tags
					</ActionButton>
				</>
			),
		},
		{
			title: 'Ban macro',
			tooltip: 'Pre-fill the mod button ban note and message with text and tokens.',
			contentNode: <BanMacroTab
				state={state}
				saveRef={save.banMacro}
				onSave={(banMacros,) => {
					state.config.banMacros = banMacros
					saveToolboxConfig(state.subreddit!, state.config, 'updated ban macro',)
				}}
			/>,
			footer: <ActionButton primary type="button" onClick={() => save.banMacro.current?.()}>
				Save ban macro
			</ActionButton>,
		},
		{
			title: 'Toolbox 6.x compatibility',
			tooltip: 'Control whether the old Toolbox 6.x wiki pages are kept in sync for this subreddit.',
			contentNode: <CompatibilityTab subreddit={subredditConfig} />,
		},
		{
			title: 'Edit raw toolbox config',
			tooltip: 'Directly edit the raw toolbox JSON config for this subreddit.',
			advanced: true,
			contentNode: <WikiEditorTab
				subreddit={subredditConfig}
				page="toolbox"
				saveRef={save.rawConfig}
				revisionNoteRef={revisionNote.rawConfig}
				historyRef={history.rawConfig}
			/>,
			footer: <WikiEditorFooter
				label="Save Page to Wiki"
				saveRef={save.rawConfig}
				revisionNoteRef={revisionNote.rawConfig}
				historyRef={history.rawConfig}
			/>,
		},
		{
			title: 'Edit usernotes',
			tooltip: 'Directly edit the raw usernotes JSON for this subreddit.',
			advanced: true,
			contentNode: <WikiEditorTab
				subreddit={subredditConfig}
				page="usernotes"
				saveRef={save.rawUsernote}
				revisionNoteRef={revisionNote.rawUsernote}
				historyRef={history.rawUsernote}
			/>,
			footer: <WikiEditorFooter
				label="Save Page to Wiki"
				saveRef={save.rawUsernote}
				revisionNoteRef={revisionNote.rawUsernote}
				historyRef={history.rawUsernote}
			/>,
		},
		// One raw-editor tab per sharded usernote page, straight from the
		// manifest read at overlay-open time (plus retired pages when the
		// only-active-shards setting is off).
		...usernoteShards.map((shard,) => buildShardTab(subredditConfig, shard,)),
	]
}

/**
 * Resolves the usernotes shard pages to expose as raw-editor tabs: the active
 * shards from the manifest, plus - when `showRetired` is true - retired
 * (tombstoned) shard pages still present on the wiki.
 * @param subreddit The subreddit the overlay is opening for.
 * @param showRetired Whether to also list retired shard pages; sourced from the
 *   subreddit's `showRetiredUsernoteShards` config field.
 */
async function resolveShardTabs (subreddit: string, showRetired: boolean,): Promise<ShardTabInfo[]> {
	const activeSuffixes = await listUsernoteShardPages(subreddit,)
	const shards: ShardTabInfo[] = activeSuffixes.map((suffix,) => ({suffix, active: true,}))
	if (showRetired) {
		const retired = await listRetiredUsernoteShardPages(subreddit, activeSuffixes,)
		shards.push(...retired.map((suffix,) => ({suffix, active: false,})),)
	}
	return shards
}

/**
 * Creates the config-open handlers and shared mutable config state used across all config tabs.
 * @param unManager Whether the usernotes manager link should be hidden (usernotes manager disabled).
 * @returns The config open handlers plus the live `state` object shared with tab components.
 */
export function createConfigOpenHandlers (unManager: boolean,): ConfigOpenHandlers & {state: ConfigState} {
	const state: ConfigState = {
		config: defaultConfig,
		subreddit: null,
		postFlairTemplates: null,
		userFlairTemplates: null,
	}
	const body = document.body
	// Handle for the currently open overlay, used to swap tabs live when the
	// retired-shard toggle changes. Cleared on close.
	let overlayHandle: ConfigOverlayHandle | null = null

	/**
	 * Re-resolves the usernote shard tabs from the current config and replaces
	 * the overlay's tab list in place. Called after the retired-shard toggle
	 * changes so the new tab set appears without reopening the overlay.
	 */
	async function refreshShardTabs () {
		if (!state.subreddit || !overlayHandle) { return }
		const shardTabs = await resolveShardTabs(
			state.subreddit,
			!!state.config.showRetiredUsernoteShards,
		).catch(() => [] as ShardTabInfo[])
		overlayHandle.setTabs(buildConfigTabs(state.subreddit, unManager, state, shardTabs, onToggleRetiredShards,),)
	}

	/**
	 * Persists the retired-shard visibility choice to the subreddit's wiki
	 * config and refreshes the shard tabs to match.
	 */
	function onToggleRetiredShards (checked: boolean,) {
		if (!state.subreddit) { return }
		state.config.showRetiredUsernoteShards = checked
		saveToolboxConfig(state.subreddit, state.config, 'updated usernote shard visibility',)
		void refreshShardTabs()
	}

	function showConfig (subredditConfig: string, usernoteShards: ShardTabInfo[],) {
		const tabs = buildConfigTabs(subredditConfig, unManager, state, usernoteShards, onToggleRetiredShards,)
		overlayHandle = showConfigOverlay({
			cssClass: 'toolbox-config',
			onClose: () => {
				body.style.overflow = ''
				document.documentElement.style.overflow = ''
				state.config = defaultConfig
				state.subreddit = null
				state.postFlairTemplates = null
				state.userFlairTemplates = null
				overlayHandle = null
			},
			title: `Toolbox-NXG Configuration - /r/${subredditConfig}`,
			tabs,
		},)
		body.style.overflow = 'hidden'
		document.documentElement.style.overflow = 'hidden'
	}

	function openConfigForSubreddit (subreddit: string,) {
		state.subreddit = subreddit
		getWikiReadPath('settings', subreddit,).then((page,) =>
			readFromWiki<Record<string, any>>(subreddit, page, true,)
		).then(async (response,) => {
			if (!response.ok) {
				if (response.reason === 'invalid_json') {
					negativeTextFeedback(
						`The /r/${subreddit} Toolbox-NXG wiki page contains invalid data and cannot be loaded.`,
					)
					return
				}
				state.config = defaultConfig
			} else {
				state.config = response.data
				purifyObject(state.config,)
				normalizeConfig(state.config,)
				if (!isConfigValidVersion(subreddit, state.config,)) {
					negativeTextFeedback(
						`This version of Toolbox-NXG is not compatible with the /r/${subreddit} configuration.`,
					)
					return
				}
			}
			// Shard tabs are resolved from the loaded config's retired-shard flag,
			// so this must run after the config read. Resolves to [] for subreddits
			// without a sharded usernotes manifest (legacy layout, no notes).
			const shardTabs = await resolveShardTabs(
				subreddit,
				!!state.config.showRetiredUsernoteShards,
			).catch(() => [] as ShardTabInfo[])
			showConfig(subreddit, shardTabs,)
		},)
	}

	return {
		handleNewPage: async (event,) => {
			const {pageDetails,} = event.detail
			if (pageDetails.subreddit) {
				const {subreddit,} = pageDetails
				const isMod = await isModSub(subreddit,)
				if (isMod) {
					addContextItem('toolbox-config-link', {
						text: `/r/${subreddit} config`,
						icon: 'tbSubConfig',
						title: `Toolbox-NXG configuration for /r/${subreddit}`,
						dataAttributes: {subreddit,},
						order: 40,
					},)
				} else {
					removeContextItem('toolbox-config-link',)
				}
			} else {
				removeContextItem('toolbox-config-link',)
			}
		},

		openConfigForSubreddit,

		handleConfigLinkClick: (element,) => {
			const subreddit = element.getAttribute('data-subreddit',)
			if (!subreddit) { return }
			openConfigForSubreddit(subreddit,)
		},
		handleConfigHelpClick: (element,) => {
			const module = element.getAttribute('data-module',)
			if (!module) { return }
			window.open(
				`https://old.reddit.com/r/toolbox/wiki/livedocs/${module}`,
				'',
				'scrollbars=1,width=500,height=600,location=0,menubar=0,top=100,left=100',
			)
		},
		handleOpenConfigEvent: (event,) => {
			const {subreddit,} = (event as CustomEvent<{subreddit: string}>).detail
			openConfigForSubreddit(subreddit,)
		},
		state,
	}
}
