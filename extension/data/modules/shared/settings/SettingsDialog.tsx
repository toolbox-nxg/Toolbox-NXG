/** Full-page Toolbox settings dialog with per-module tabs, search, backup/restore, and raw settings view. */

import {useCallback, useMemo, useRef, useState,} from 'react'
import {buildPolicyMap,} from '../../../framework/module'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {TextInput,} from '../../../shared/controls/NormalInput'
import {NumberInput,} from '../../../shared/controls/NumberInput'
import {SettingRow,} from '../../../shared/window/SettingRow'
import {TabbedDialog,} from '../../../shared/window/TabbedDialog'
import {WindowTab, WindowTabItem, WindowTabSection,} from '../../../shared/window/WindowTabs'
import store from '../../../store'
import {negativeTextFeedback, neutralTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import {getTime, millisecondsToDays,} from '../../../util/data/time'
import {toolboxVersionName,} from '../../../util/infra/version'
import {clearCache,} from '../../../util/persistence/cache'
import {getAnonymizedSettings, getSettings, writeSettings,} from '../../../util/persistence/settings'
import {link,} from '../../../util/reddit/pageContext'
import {cleanSubredditName,} from '../../../util/reddit/reddit-domain'
import {reloadPage,} from '../../../util/ui/navigation'
import css from './SettingsDialog.module.css'
import {WikiLayoutSection,} from './WikiLayoutSection'

// ----- About tab content -----

function AboutTab () {
	const [creditsExpanded, setCreditsExpanded,] = useState(false,)
	const toggleCredits = useCallback(() => setCreditsExpanded((x,) => !x), [],)

	return (
		<div className={css.aboutContent}>
			<h3>About:</h3>
			<a href={link('/r/toolbox_nxg',)} target="_blank" rel="noreferrer">
				/r/toolbox_nxg {toolboxVersionName}
			</a>
			<h3>Open source</h3>
			Toolbox-NXG is an open source software project. The source code and project can be found on{' '}
			<a href="https://github.com/toolbox-nxg/reddit-moderator-toolbox" target="_blank" rel="noreferrer">
				GitHub
			</a>.
			<h3>Documentation</h3>
			Guides, module references, and migration notes are available in the{' '}
			<a href="https://toolbox-nxg.github.io/Toolbox-NXG/" target="_blank" rel="noreferrer">
				Toolbox-NXG documentation
			</a>.
			<h3>Privacy</h3>
			The toolbox development team highly values privacy. <br />
			The toolbox privacy policy can be{' '}
			<a href="https://github.com/toolbox-nxg/Toolbox-NXG/blob/main/PRIVACY.md" target="_blank" rel="noreferrer">
				found in the github repository
			</a>.
			<h3>Made and maintained by:</h3>
			<p>
				<em>Current maintainers:</em>
			</p>
			<table>
				<tbody>
					<tr>
						<td>
							<a href="https://www.reddit.com/user/adhesiveCheese">/u/adhesiveCheese</a>
						</td>
					</tr>
				</tbody>
			</table>
			<button type="button" className={css.creditsToggle} onClick={toggleCredits}>
				{creditsExpanded ? 'Hide' : 'Show'} original maintainers &amp; credits
			</button>
			{creditsExpanded && (
				<>
					<p>
						<em>
							Maintainers of the original toolbox (seriously, <em>don&apos;t bother these folks</em>):
						</em>
					</p>
					<table>
						<tbody>
							<tr>
								<td>
									<a href="https://www.reddit.com/user/creesch/">/u/creesch</a>
								</td>
								<td>
									<a href="https://www.reddit.com/user/agentlame">/u/agentlame</a>
								</td>
								<td>
									<a href="https://www.reddit.com/user/LowSociety">/u/LowSociety</a>
								</td>
							</tr>
							<tr>
								<td>
									<a href="https://www.reddit.com/user/TheEnigmaBlade">/u/TheEnigmaBlade</a>
								</td>
								<td>
									<a href="https://www.reddit.com/user/dakta">/u/dakta</a>
								</td>
								<td>
									<a href="https://www.reddit.com/user/largenocream">/u/largenocream</a>
								</td>
							</tr>
							<tr>
								<td>
									<a href="https://www.reddit.com/user/noeatnosleep">/u/noeatnosleep</a>
								</td>
								<td>
									<a href="https://www.reddit.com/user/psdtwk">/u/psdtwk</a>
								</td>
								<td>
									<a href="https://www.reddit.com/user/garethp">/u/garethp</a>
								</td>
							</tr>
							<tr>
								<td>
									<a href="https://www.reddit.com/user/WorseThanHipster">/u/WorseThanHipster</a>
								</td>
								<td>
									<a href="https://www.reddit.com/user/amici_ursi">/u/amici_ursi</a>
								</td>
								<td>
									<a href="https://www.reddit.com/user/eritbh">/u/eritbh</a>
								</td>
							</tr>
							<tr>
								<td>
									<a href="https://www.reddit.com/user/SpyTec13">/u/SpyTec13</a>
								</td>
								<td>
									<a href="https://www.reddit.com/user/kenman">/u/kenman</a>
								</td>
								<td></td>
							</tr>
						</tbody>
					</table>
					<h3>Special thanks to:</h3>
					<p>
						<a href="https://www.reddit.com/user/andytuba">/u/andytuba</a>
						{' & '}
						<a href="https://www.reddit.com/user/erikdesjardins">/u/erikdesjardins</a>
						{' for all their amazing help and support of the TB team in resolving complex issues'}
						{' (and really simple ones)'}
					</p>
					<h3>Credits:</h3>
					<p>
						<a href="https://www.reddit.com/user/ShaneH7646">/u/ShaneH7646</a>
						{' for the snoo running gif'}
						<br />
						<a href="https://material.io/tools/icons/" target="_blank" rel="noreferrer">
							Material icons
						</a>
						<br />
						Modtools base code by{' '}
						<a href="https://www.reddit.com/user/DEADB33F" target="_blank" rel="noreferrer">
							DEADB33F
						</a>
						<br />
						<a
							href="https://chrome.google.com/webstore/detail/reddit-mod-nuke-extension/omndholfgmbafjdodldjlekckdneggll?hl=en"
							target="_blank"
							rel="noreferrer"
						>
							Comment Thread Nuke Script
						</a>
						{' by '}
						<a href="https://www.reddit.com/user/djimbob" target="_blank" rel="noreferrer">
							/u/djimbob
						</a>
					</p>
				</>
			)}
			<h3>License:</h3>
			<p>© 2013-2026 toolbox development team.</p>
			<p>© 2026 toolbox-nxg development team.</p>
			<p>
				Licensed under the Apache License, Version 2.0 (the &ldquo;License&rdquo;); you may not use this file
				except in compliance with the License. You may obtain a copy of the License at{' '}
				<a href="http://www.apache.org/licenses/LICENSE-2.0">http://www.apache.org/licenses/LICENSE-2.0</a>
			</p>
		</div>
	)
}

// ----- Core settings tab -----

function CoreSettingsTab ({
	localValues,
	updateValue,
	advancedMode,
	clearCacheOnSave,
	setClearCacheOnSave,
	hasUnsavedChanges,
	onSave,
	onExport,
	onImport,
	modules,
}: {
	localValues: Record<string, unknown>
	updateValue: (key: string, value: unknown,) => void
	advancedMode: boolean
	clearCacheOnSave: boolean
	setClearCacheOnSave: (v: boolean,) => void
	hasUnsavedChanges: boolean
	onSave: () => Promise<void>
	onExport: (subreddit: string,) => Promise<void>
	onImport: (subreddit: string,) => Promise<void>
	modules: any[]
},) {
	const settingSub = (localValues['Toolbox.Utils.settingSub'] ?? '') as string
	const showExportReminder = !!(localValues['Toolbox.Modbar.showExportReminder'] ?? true)
	const debugMode = !!(localValues['Toolbox.Utils.debugMode'] ?? false)
	const devMode = !!(localValues['Toolbox.Utils.devMode'] ?? false)
	const longLength = (localValues['Toolbox.Utils.longLength'] ?? 45) as number
	const shortLength = (localValues['Toolbox.Utils.shortLength'] ?? 15) as number
	const lastExport = (localValues['Toolbox.Modbar.lastExport'] ?? 0) as number
	const lastExportDays = Math.round(millisecondsToDays(getTime() - lastExport,),)
	const lastExportLabel = lastExport === 0 ? 'Never' : `${lastExportDays} days ago`
	const lastExportSadClass = (lastExportDays > 30 || lastExport === 0) ? css.sad : ''

	const [confirmingRestore, setConfirmingRestore,] = useState(false,)
	const [confirmingUnsavedBackup, setConfirmingUnsavedBackup,] = useState(false,)
	const [showRaw, setShowRaw,] = useState(false,)
	const [rawText, setRawText,] = useState('',)
	const [copied, setCopied,] = useState(false,)

	if (showRaw && !rawText) {
		getSettings().then((s,) => setRawText(JSON.stringify(s, null, 2,),))
	}

	const anonymizeRaw = async () => {
		const s = await getAnonymizedSettings(buildPolicyMap(modules,),)
		setRawText(JSON.stringify(s, null, 2,),)
	}

	const copyRawToClipboard = async () => {
		await navigator.clipboard.writeText(rawText,)
		setCopied(true,)
		setTimeout(() => setCopied(false,), 2000,)
	}

	const doExport = async (subreddit: string,) => {
		neutralTextFeedback(`Backing up settings to /r/${subreddit}`,)
		await onExport(subreddit,)
		reloadPage(1000,)
	}

	const handleExport = async () => {
		const subreddit = cleanSubredditName(settingSub,)
		if (!subreddit) {
			negativeTextFeedback('You have not set a subreddit to backup/restore settings',)
			return
		}
		if (hasUnsavedChanges) {
			setConfirmingUnsavedBackup(true,)
			return
		}
		await doExport(subreddit,)
	}

	const handleSaveAndExport = async () => {
		const subreddit = cleanSubredditName(settingSub,)
		if (!subreddit) { return }
		setConfirmingUnsavedBackup(false,)
		await onSave()
		await doExport(subreddit,)
	}

	const handleExportWithoutSaving = async () => {
		const subreddit = cleanSubredditName(settingSub,)
		if (!subreddit) { return }
		setConfirmingUnsavedBackup(false,)
		await doExport(subreddit,)
	}

	const handleImport = async () => {
		const subreddit = cleanSubredditName(settingSub,)
		if (!subreddit) {
			negativeTextFeedback('You have not set a subreddit to backup/restore settings',)
			setConfirmingRestore(false,)
			return
		}
		try {
			await onImport(subreddit,)
		} catch {
			negativeTextFeedback('Imported settings could not be verified',)
			setConfirmingRestore(false,)
			return
		}
		positiveTextFeedback('Settings imported and verified, reloading page',)
		reloadPage(1000,)
	}

	return (
		<div className={css.settingsContent}>
			<div className={css.settingItem}>
				<label className={css.fieldLabel}>Backup / restore settings to a wiki page</label>
				<TextInput
					type="text"
					className={css.fullWidthInput}
					placeholder="Private subreddit where you are a moderator..."
					value={settingSub}
					onChange={(event,) =>
						updateValue('Toolbox.Utils.settingSub', cleanSubredditName(event.target.value,),)}
				/>
				<div className={css.backupActions}>
					{confirmingUnsavedBackup
						? (
							<>
								<ActionButton type="button" onClick={handleSaveAndExport}>
									Save &amp; Backup
								</ActionButton>
								<ActionButton type="button" onClick={handleExportWithoutSaving}>
									Backup without saving
								</ActionButton>
								<ActionButton type="button" onClick={() => setConfirmingUnsavedBackup(false,)}>
									Cancel
								</ActionButton>
								<span className={css.backupNote}>⚠ You have unsaved changes!</span>
							</>
						)
						: (
							<ActionButton type="button" onClick={handleExport}>Backup</ActionButton>
						)}
					{confirmingRestore
						? (
							<>
								<ActionButton type="button" onClick={handleImport}>Confirm restore</ActionButton>
								<ActionButton type="button" onClick={() => setConfirmingRestore(false,)}>
									Cancel
								</ActionButton>
								<span className={css.backupNote}>⚠ This will overwrite all current settings!</span>
							</>
						)
						: (
							<>
								<ActionButton type="button" onClick={() => setConfirmingRestore(true,)}>
									Restore
								</ActionButton>
								<span className={css.backupNote}>Will reload the page without saving!</span>
							</>
						)}
					<span className={`${css.backupWarning} ${lastExportSadClass}`}>
						Last backup: <b>{lastExportLabel}</b>
					</span>
				</div>
			</div>
			<div className={css.settingItem}>
				<CheckboxInput
					label="Show reminder after 30 days of no backup"
					checked={showExportReminder}
					onChange={(event,) => updateValue('Toolbox.Modbar.showExportReminder', event.target.checked,)}
				/>
			</div>
			<div className={css.settingItem}>
				<CheckboxInput
					label="Show advanced settings"
					checked={advancedMode}
					onChange={(event,) => updateValue('Toolbox.Utils.advancedMode', event.target.checked,)}
				/>
				{advancedMode && (
					<div className={css.advancedGroup}>
						<div className={css.settingItem}>
							<CheckboxInput
								label="Enable debug mode"
								checked={debugMode}
								onChange={(event,) => updateValue('Toolbox.Utils.debugMode', event.target.checked,)}
							/>
						</div>
						<div className={css.settingItem}>
							<CheckboxInput
								label="Enable dev mode (save without reload)"
								checked={devMode}
								onChange={(event,) => updateValue('Toolbox.Utils.devMode', event.target.checked,)}
							/>
						</div>
						<div className={css.settingItem}>
							<label className={css.fieldLabel}>Cache subreddit config (minutes)</label>
							<NumberInput
								value={longLength}
								min={0}
								onChange={(event,) =>
									updateValue('Toolbox.Utils.longLength', parseInt(event.target.value, 10,),)}
							/>
						</div>
						<div className={css.settingItem}>
							<label className={css.fieldLabel}>Cache subreddit usernotes (minutes)</label>
							<NumberInput
								value={shortLength}
								min={0}
								onChange={(event,) =>
									updateValue('Toolbox.Utils.shortLength', parseInt(event.target.value, 10,),)}
							/>
						</div>
					</div>
				)}
			</div>
			<div className={css.settingItem}>
				<CheckboxInput
					label="Clear cache on save (close all other Reddit tabs first)"
					checked={clearCacheOnSave}
					onChange={(event,) => setClearCacheOnSave(event.target.checked,)}
				/>
			</div>
			<div className={css.settingItem}>
				<ActionButton type="button" onClick={() => setShowRaw((v,) => !v)}>
					{showRaw ? 'Hide raw settings' : 'Show raw settings'}
				</ActionButton>
				{showRaw && (
					<div className={css.rawSettingsInline}>
						<textarea
							className={css.rawTextarea}
							rows={20}
							cols={60}
							readOnly
							value={rawText}
							onChange={() => {}}
						/>
						<div className={css.rawActions}>
							<ActionButton type="button" onClick={anonymizeRaw}>Anonymize Settings</ActionButton>
							<ActionButton type="button" onClick={copyRawToClipboard}>
								{copied ? 'Copied!' : 'Copy to Clipboard'}
							</ActionButton>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

// ----- Per-module settings tab -----

function ModuleSettingsTab ({
	module,
	localValues,
	updateValue,
	debugMode,
	advancedMode,
}: {
	module: any
	localValues: Record<string, unknown>
	updateValue: (key: string, value: unknown,) => void
	debugMode: boolean
	advancedMode: boolean
},) {
	const enabled = module.alwaysEnabled || !!(localValues[`Toolbox.${module.id}.enabled`] ?? module.enabledByDefault)

	return (
		<div className={css.settingsContent}>
			{!enabled && (
				<p className={css.moduleDisabledWarning}>
					This module is not active. Use the toggle next to its name in the sidebar to enable it.
				</p>
			)}
			<fieldset disabled={!enabled} className={css.settingFieldset}>
				{[...module.settings.values(),].map((setting: any,) => {
					if (setting.debug && !debugMode) { return null }
					if (setting.hidden && !debugMode) { return null }
					const storageKey = `Toolbox.${module.id}.${setting.id}`
					const shown = !setting.advanced || advancedMode
					return (
						<SettingRow
							key={setting.id}
							settingDef={setting}
							moduleId={module.id}
							value={localValues[storageKey]}
							onChange={(v,) => updateValue(storageKey, v,)}
							shown={shown}
						/>
					)
				},)}
			</fieldset>
			{module.id === 'GenSettings' && advancedMode && <WikiLayoutSection />}
		</div>
	)
}

// ----- Main dialog -----

/**
 * Renders the main Toolbox settings dialog with a sidebar of module tabs and a settings search box.
 * @param props Component properties.
 * @param modules All registered Module instances to display.
 * @param onClose Called when the dialog should be dismissed.
 * @param onExport Called with the chosen subreddit name when the user triggers a settings backup.
 * @param onImport Called with the chosen subreddit name when the user triggers a settings restore.
 */
export function SettingsDialog ({
	modules,
	onClose,
	onExport,
	onImport,
}: {
	modules: any[]
	onClose: () => void
	onExport: (subreddit: string,) => Promise<void>
	onImport: (subreddit: string,) => Promise<void>
},) {
	const [localValues, setLocalValues,] = useState<Record<string, unknown>>(
		() => ({...store.getState().settings.values,}),
	)
	const [clearCacheOnSave, setClearCacheOnSave,] = useState(false,)
	const [searchQuery, setSearchQuery,] = useState('',)

	const updateValue = (key: string, value: unknown,) => setLocalValues((prev,) => ({...prev, [key]: value,}))

	const debugMode = !!(localValues['Toolbox.Utils.debugMode'] ?? false)
	const advancedMode = !!(localValues['Toolbox.Utils.advancedMode'] ?? false)
	const devMode = !!(localValues['Toolbox.Utils.devMode'] ?? false)

	const hasUnsavedChanges = useMemo(() => {
		const savedValues = store.getState().settings.values
		const allKeys = new Set([...Object.keys(localValues,), ...Object.keys(savedValues,),],)
		return [...allKeys,].some((k,) => localValues[k] !== savedValues[k])
	}, [localValues,],)

	/** Saves settings to storage without reloading or closing - used by save-then-backup. */
	const saveSettingsOnly = useCallback(async () => {
		if (clearCacheOnSave) { clearCache() }
		await writeSettings(localValues,)
	}, [clearCacheOnSave, localValues,],)

	const handleSave = async (andReload = !devMode,) => {
		if (clearCacheOnSave) { clearCache() }
		try {
			await writeSettings(localValues,)
			positiveTextFeedback('Settings saved',)
			if (andReload) {
				reloadPage(1000,)
			} else {
				onClose()
			}
		} catch {
			negativeTextFeedback('Save could not be verified',)
		}
	}

	const searchActive = searchQuery.trim().length > 0
	const normalizedQuery = searchQuery.trim().toLowerCase()

	// Split modules into always-enabled (non-optional) and toggleable, both sorted alphabetically.
	// Only include modules with at least one visible setting.
	const visibleModules = modules
		.filter((m: any,) => debugMode || !m.debugMode)
		.filter((m: any,) => {
			return [...m.settings.values(),].some((s: any,) => (debugMode || !s.debug) && (debugMode || !s.hidden))
		},)

	const matchingModules = searchActive
		? visibleModules
			.map((m: any,) => ({
				module: m,
				settings: ([...m.settings.values(),] as any[])
					.filter((s: any,) => (debugMode || !s.debug) && (debugMode || !s.hidden))
					.filter((s: any,) => {
						const desc = ((s.description ?? s.id) as string).toLowerCase()
						return desc.includes(normalizedQuery,)
							|| (m.name as string).toLowerCase().includes(normalizedQuery,)
					},),
			}))
			.filter(({settings,},) => settings.length > 0)
		: []

	const sectionRefs = useRef<Map<string, Element>>(new Map(),)
	const scrollToModule = (moduleId: string,) => {
		sectionRefs.current.get(moduleId,)?.scrollIntoView({behavior: 'smooth', block: 'start',},)
	}

	const sidebarHeader = (
		<div className={css.searchContainer}>
			<TextInput
				type="search"
				placeholder="Search settings..."
				value={searchQuery}
				onChange={(e,) => setSearchQuery(e.target.value,)}
			/>
		</div>
	)

	const makeModuleTab = (m: any, withToggle: boolean,): WindowTab => ({
		title: m.name,
		moduleId: m.id,
		...(withToggle && {
			toggle: {
				checked: !!(localValues[`Toolbox.${m.id}.enabled`] ?? m.enabledByDefault),
				onChange: (checked: boolean,) => updateValue(`Toolbox.${m.id}.enabled`, checked,),
			},
		}),
		content: (
			<ModuleSettingsTab
				module={m}
				localValues={localValues}
				updateValue={updateValue}
				debugMode={debugMode}
				advancedMode={advancedMode}
			/>
		),
	})
	const alwaysEnabledTabs: WindowTab[] = visibleModules
		.filter((m: any,) => m.alwaysEnabled)
		.sort((a: any, b: any,) => a.name.localeCompare(b.name,))
		.map((m: any,) => makeModuleTab(m, false,))
	const generalModuleTabs: WindowTab[] = visibleModules
		.filter((m: any,) => !m.alwaysEnabled && !m.oldReddit && !m.shreddit)
		.sort((a: any, b: any,) => a.name.localeCompare(b.name,))
		.map((m: any,) => makeModuleTab(m, true,))
	const oldRedditModuleTabs: WindowTab[] = visibleModules
		.filter((m: any,) => !m.alwaysEnabled && m.oldReddit)
		.sort((a: any, b: any,) => a.name.localeCompare(b.name,))
		.map((m: any,) => makeModuleTab(m, true,))
	const shredditModuleTabs: WindowTab[] = visibleModules
		.filter((m: any,) => !m.alwaysEnabled && m.shreddit)
		.sort((a: any, b: any,) => a.name.localeCompare(b.name,))
		.map((m: any,) => makeModuleTab(m, true,))

	const normalTabs: WindowTabItem[] = [
		{
			title: 'Core Settings',
			content: (
				<CoreSettingsTab
					localValues={localValues}
					updateValue={updateValue}
					advancedMode={advancedMode}
					clearCacheOnSave={clearCacheOnSave}
					setClearCacheOnSave={setClearCacheOnSave}
					hasUnsavedChanges={hasUnsavedChanges}
					onSave={saveSettingsOnly}
					onExport={onExport}
					onImport={onImport}
					modules={modules}
				/>
			),
		},
		...alwaysEnabledTabs,
		{title: 'About', content: <AboutTab />,},
		{kind: 'section', label: 'General Modules', scrollable: true,} satisfies WindowTabSection,
		...generalModuleTabs,
		...(oldRedditModuleTabs.length > 0
			? [
				{kind: 'section', label: 'Old Reddit Modules', scrollable: true,} satisfies WindowTabSection,
				...oldRedditModuleTabs,
			]
			: []),
		...(shredditModuleTabs.length > 0
			? [
				{kind: 'section', label: 'Shreddit Modules', scrollable: true,} satisfies WindowTabSection,
				...shredditModuleTabs,
			]
			: []),
	]

	// Map selectable tab index -> module ID for scroll-on-click during search.
	const tabIndexToModuleId = new Map<number, string>()
	{
		let i = 0
		for (const item of normalTabs) {
			if (!('kind' in item)) {
				const tab = item as WindowTab
				if (tab.moduleId) { tabIndexToModuleId.set(i, tab.moduleId,) }
				i++
			}
		}
	}

	const matchingModuleIds = new Set(matchingModules.map(({module: m,},) => m.id),)
	const hiddenTabIndices = searchActive
		? new Set(
			[...tabIndexToModuleId.entries(),].filter(([, id,],) => !matchingModuleIds.has(id,)).map(([i,],) => i),
		)
		: undefined

	const searchContent = searchActive
		? (
			<div className={css.settingsContent}>
				{matchingModules.length === 0
					? <p className={css.noResults}>No settings match &ldquo;{searchQuery.trim()}&rdquo;</p>
					: matchingModules.map(({module: m, settings,},) => (
						<div
							key={m.id}
							ref={(el,) => {
								if (el) { sectionRefs.current.set(m.id, el,) }
								else { sectionRefs.current.delete(m.id,) }
							}}
						>
							<div className={css.searchResultModule}>{m.name}</div>
							<fieldset className={css.settingFieldset}>
								{settings.map((s: any,) => {
									const storageKey = `Toolbox.${m.id}.${s.id}`
									return (
										<SettingRow
											key={`${m.id}.${s.id}`}
											settingDef={s}
											moduleId={m.id}
											value={localValues[storageKey]}
											onChange={(v,) => updateValue(storageKey, v,)}
											shown
										/>
									)
								},)}
							</fieldset>
						</div>
					))}
			</div>
		)
		: undefined

	const handleTabChange = (i: number,) => {
		if (searchActive) {
			const moduleId = tabIndexToModuleId.get(i,)
			if (moduleId) { scrollToModule(moduleId,) }
		}
	}

	return (
		<>
			<TabbedDialog
				title="Toolbox-NXG Settings"
				tabs={normalTabs}
				defaultTabIndex={0}
				sidebarHeader={sidebarHeader}
				hiddenTabIndices={hiddenTabIndices}
				contentOverride={searchContent}
				onTabChange={handleTabChange}
				onClose={onClose}
				footer={
					<div className={css.centeredFooter}>
						<ActionButton primary type="button" onClick={() => handleSave()}>
							{devMode ? 'Save Settings (Dev Mode - No Refresh)' : 'Save Settings and Refresh Page'}
						</ActionButton>
					</div>
				}
			/>
		</>
	)
}
