/** DOM setup for the Syntax Highlighter module: replaces Reddit's CSS and wiki text areas with CodeMirror editors. */

import {useState,} from 'react'

import {provideLocation, renderAtLocation,} from '../../dom/uiLocations'
import {ActionButton,} from '../../shared/controls/ActionButton'
import {RedditPlatform,} from '../../util/infra/platform'
import {createEditor, createKeyboardShortcutsHelper,} from '../../util/ui/codemirrorSetup'
import type {SyntaxSettings,} from './settings'
import {SyntaxTheme, syntaxThemes,} from './syntaxThemes'

/** The raw detail object passed through a stylesheet/wiki editor UILocationContext. */
interface EditorDetail {
	editor: ReturnType<typeof createEditor>
}

function ThemeSelector ({selectedTheme, onThemeChange,}: {
	selectedTheme: SyntaxTheme
	onThemeChange: (theme: SyntaxTheme,) => void
},) {
	const [theme, setTheme,] = useState(selectedTheme,)

	const handleChange = (e: React.ChangeEvent<HTMLSelectElement>,) => {
		const next = e.target.value as SyntaxTheme
		setTheme(next,)
		onThemeChange(next,)
	}

	return (
		<select id="theme_selector" value={theme} onChange={handleChange}>
			{syntaxThemes.map((t,) => <option key={t} value={t}>{t}</option>)}
		</select>
	)
}

function StylesheetButtons ({onSave, onPreview,}: {onSave: () => void; onPreview: () => void},) {
	return (
		<div id="toolbox-syntax-buttons">
			<ActionButton onClick={onSave}>save</ActionButton>
			{' - '}
			<ActionButton onClick={onPreview}>preview</ActionButton>
		</div>
	)
}

function WikiSaveButton ({onSave,}: {onSave: () => void},) {
	return <ActionButton onClick={onSave}>save page</ActionButton>
}

/** A mounted syntax-highlight bundle that can clean itself up when the module is unloaded. */
export interface SyntaxBundle {
	/** Tears down the CodeMirror editor and any injected React roots. */
	destroy: () => void
}

/**
 * Mounts a CodeMirror CSS editor on the subreddit stylesheet page.
 * @returns A bundle with a destroy callback, or null if the current page is not the stylesheet editor.
 */
export function createStylesheetBundle (s: SyntaxSettings,): SyntaxBundle | null {
	if (!location.pathname.match(/\/about\/stylesheet\/?/,)) { return null }

	document.body.classList.add('mod-syntax',)

	const stylesheetContents = document.getElementById('stylesheet_contents',) as HTMLTextAreaElement | null
	if (!stylesheetContents) { return null }

	const editor = createEditor({
		textarea: stylesheetContents,
		mimetype: 'text/css',
		theme: s.selectedTheme as SyntaxTheme,
		lineWrapping: s.enableWordWrap,
		autocomplete: true,
	},)
	document.querySelector('.cm-editor',)?.prepend(createKeyboardShortcutsHelper(),)

	const detail: EditorDetail = {editor,}

	const themeHost = document.createElement('div',)
	document.querySelector('.sheets .col',)?.insertAdjacentElement('beforebegin', themeHost,)
	const unprovideTheme = provideLocation('stylesheetEditorControls', themeHost, {
		platform: RedditPlatform.Old,
		kind: 'stylesheetEditor',
		rawDetail: detail,
	}, {shadow: false,},)
	const unrenderTheme = renderAtLocation('stylesheetEditorControls', {id: 'syntax.themeSelector',}, ({context,},) => {
		const {editor: e,} = context.rawDetail as EditorDetail
		return (
			<ThemeSelector
				selectedTheme={s.selectedTheme as SyntaxTheme}
				onThemeChange={(theme,) => e.setTheme(theme,)}
			/>
		)
	},)

	const buttonsHost = document.createElement('div',)
	document.querySelector('.sheets .buttons',)?.insertAdjacentElement('beforebegin', buttonsHost,)
	const unprovideButtons = provideLocation('stylesheetEditorControls', buttonsHost, {
		platform: RedditPlatform.Old,
		kind: 'stylesheetEditor',
		rawDetail: detail,
	}, {shadow: false,},)
	const unrenderButtons = renderAtLocation('stylesheetEditorControls', {id: 'syntax.stylesheetButtons',}, () => (
		<StylesheetButtons
			onSave={() => document.querySelector<HTMLElement>('.sheets .buttons .btn[name="save"]',)?.click()}
			onPreview={() => document.querySelector<HTMLElement>('.sheets .buttons .btn[name="preview"]',)?.click()}
		/>
	),)

	return {
		destroy: () => {
			editor.destroy()
			unrenderTheme()
			unprovideTheme()
			themeHost.remove()
			unrenderButtons()
			unprovideButtons()
			buttonsHost.remove()
		},
	}
}

/**
 * Mounts a CodeMirror editor on a wiki edit/create page when the page matches a configured language mapping.
 * @returns A bundle with a destroy callback, or null if the current page is not a recognized wiki editor.
 */
export function createWikiBundle (s: SyntaxSettings,): SyntaxBundle | null {
	const wikiRegex = /\/wiki\/(?:edit|create)\/?([a-z0-9-_/]*[a-z0-9-_])/
	const wikiMatch = location.pathname.match(wikiRegex,)
	if (!wikiMatch) { return null }

	const wikiPage = wikiMatch[1]
	if (!wikiPage) { return null }
	const language = s.wikiPages[wikiPage]
	if (!language) { return null }

	let mimetype: string
	switch (language.toLowerCase()) {
		case 'css':
			mimetype = 'text/css'
			break
		case 'json':
			mimetype = 'application/json'
			break
		case 'markdown':
		case 'md':
			mimetype = 'text/markdown'
			break
		case 'yaml':
			mimetype = 'text/x-yaml'
			break
		default:
			mimetype = 'text/markdown'
	}

	document.body.classList.add('mod-syntax',)
	document.querySelectorAll('.markdownEditor-wrapper, .RESBigEditorPop, .help-toggle',).forEach((el,) => el.remove())

	const wikiPageContent = document.getElementById('wiki_page_content',) as HTMLTextAreaElement | null
	if (!wikiPageContent) { return null }

	const editor = createEditor({
		textarea: wikiPageContent,
		mimetype,
		theme: s.selectedTheme as SyntaxTheme,
		lineWrapping: s.enableWordWrap,
	},)
	document.querySelector('.cm-editor',)?.prepend(createKeyboardShortcutsHelper(),)

	const detail: EditorDetail = {editor,}

	const themeHost = document.createElement('div',)
	const editform = document.getElementById('editform',)
	if (editform) { editform.prepend(themeHost,) }
	const unprovideTheme = provideLocation('wikiEditorControls', themeHost, {
		platform: RedditPlatform.Old,
		kind: 'wikiEditor',
		rawDetail: detail,
	}, {shadow: false,},)
	const unrenderTheme = renderAtLocation('wikiEditorControls', {id: 'syntax.wikiThemeSelector',}, ({context,},) => {
		const {editor: e,} = context.rawDetail as EditorDetail
		return (
			<ThemeSelector
				selectedTheme={s.selectedTheme as SyntaxTheme}
				onThemeChange={(theme,) => e.setTheme(theme,)}
			/>
		)
	},)

	const saveHost = document.createElement('div',)
	document.getElementById('wiki_save_button',)?.insertAdjacentElement('afterend', saveHost,)
	const unprovideSave = provideLocation('wikiEditorControls', saveHost, {
		platform: RedditPlatform.Old,
		kind: 'wikiEditor',
		rawDetail: detail,
	}, {shadow: false,},)
	const unrenderSave = renderAtLocation('wikiEditorControls', {id: 'syntax.wikiSaveButton',}, () => (
		<WikiSaveButton onSave={() => document.getElementById('wiki_save_button',)?.click()} />
	),)

	return {
		destroy: () => {
			editor.destroy()
			unrenderTheme()
			unprovideTheme()
			themeHost.remove()
			unrenderSave()
			unprovideSave()
			saveHost.remove()
		},
	}
}
