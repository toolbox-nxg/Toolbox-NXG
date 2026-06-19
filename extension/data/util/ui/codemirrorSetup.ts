/**
 * Shared CodeMirror 6 editor factory.
 *
 * Consumers get a handle with getValue/setValue/setTheme instead of reaching
 * into EditorView directly, keeping the CM6 API surface contained here.
 */

import {closeBrackets, closeBracketsKeymap,} from '@codemirror/autocomplete'
import {defaultKeymap, indentLess, indentMore, indentWithTab, toggleComment,} from '@codemirror/commands'
import {css,} from '@codemirror/lang-css'
import {javascript,} from '@codemirror/lang-javascript'
import {json,} from '@codemirror/lang-json'
import {markdown,} from '@codemirror/lang-markdown'
import {yaml,} from '@codemirror/lang-yaml'
import {linter, lintGutter,} from '@codemirror/lint'
import {openSearchPanel, searchKeymap,} from '@codemirror/search'
import {Compartment, EditorState,} from '@codemirror/state'
import type {Extension,} from '@codemirror/state'
import {EditorView, keymap, lineNumbers,} from '@codemirror/view'

import {abcdef,} from '@uiw/codemirror-theme-abcdef'
import {abyss,} from '@uiw/codemirror-theme-abyss'
import {androidstudio,} from '@uiw/codemirror-theme-androidstudio'
import {andromeda,} from '@uiw/codemirror-theme-andromeda'
import {atomone,} from '@uiw/codemirror-theme-atomone'
import {aura,} from '@uiw/codemirror-theme-aura'
import {basicDark, basicLight,} from '@uiw/codemirror-theme-basic'
import {bbedit,} from '@uiw/codemirror-theme-bbedit'
import {bespin,} from '@uiw/codemirror-theme-bespin'
import {consoleDark, consoleLight,} from '@uiw/codemirror-theme-console'
import {copilot,} from '@uiw/codemirror-theme-copilot'
import {darcula,} from '@uiw/codemirror-theme-darcula'
import {dracula,} from '@uiw/codemirror-theme-dracula'
import {eclipse,} from '@uiw/codemirror-theme-eclipse'
import {githubDark, githubLight,} from '@uiw/codemirror-theme-github'
import {gruvboxDark, gruvboxLight,} from '@uiw/codemirror-theme-gruvbox-dark'
import {kimbie,} from '@uiw/codemirror-theme-kimbie'
import {material, materialDark, materialLight,} from '@uiw/codemirror-theme-material'
import {monokai,} from '@uiw/codemirror-theme-monokai'
import {monokaiDimmed,} from '@uiw/codemirror-theme-monokai-dimmed'
import {noctisLilac,} from '@uiw/codemirror-theme-noctis-lilac'
import {nord,} from '@uiw/codemirror-theme-nord'
import {okaidia,} from '@uiw/codemirror-theme-okaidia'
import {quietlight,} from '@uiw/codemirror-theme-quietlight'
import {red,} from '@uiw/codemirror-theme-red'
import {solarizedDark, solarizedLight,} from '@uiw/codemirror-theme-solarized'
import {sublime,} from '@uiw/codemirror-theme-sublime'
import {tokyoNight,} from '@uiw/codemirror-theme-tokyo-night'
import {tokyoNightDay,} from '@uiw/codemirror-theme-tokyo-night-day'
import {tokyoNightStorm,} from '@uiw/codemirror-theme-tokyo-night-storm'
import {tomorrowNightBlue,} from '@uiw/codemirror-theme-tomorrow-night-blue'
import {vscodeDark, vscodeLight,} from '@uiw/codemirror-theme-vscode'
import {whiteDark, whiteLight,} from '@uiw/codemirror-theme-white'
import {xcodeDark, xcodeLight,} from '@uiw/codemirror-theme-xcode'

import type {SyntaxTheme,} from '../../modules/syntax/syntaxThemes'

const themeMap: Record<string, Extension> = {
	abcdef,
	abyss,
	androidstudio,
	andromeda,
	atomone,
	aura,
	basicDark,
	basicLight,
	bbedit,
	bespin,
	consoleDark,
	consoleLight,
	copilot,
	darcula,
	dracula,
	eclipse,
	githubDark,
	githubLight,
	gruvboxDark,
	gruvboxLight,
	kimbie,
	material,
	materialDark,
	materialLight,
	monokai,
	monokaiDimmed,
	noctisLilac,
	nord,
	okaidia,
	quietlight,
	red,
	solarizedDark,
	solarizedLight,
	sublime,
	tokyoNight,
	tokyoNightDay,
	tokyoNightStorm,
	tomorrowNightBlue,
	vscodeDark,
	vscodeLight,
	whiteDark,
	whiteLight,
	xcodeDark,
	xcodeLight,
}

/** Returns a CM6 theme extension for the given SyntaxTheme name. Falls back to dracula. */
function getTheme (name: SyntaxTheme,): Extension {
	return themeMap[name] ?? dracula
}

/** Returns a CM6 language extension for the given MIME type. */
function languageFor (mimetype: string,): Extension {
	switch (mimetype) {
		case 'text/css':
			return css()
		case 'application/json':
			return json()
		case 'text/x-yaml':
			return yaml()
		case 'text/markdown':
			return markdown()
		case 'text/javascript':
			return javascript()
		default:
			return []
	}
}

/**
 * One lint finding produced by a {@link CreateEditorOptions.lintSource}.
 * Mirrors the @codemirror/lint Diagnostic shape so callers don't need to
 * import CM6 types.
 */
export interface EditorLintDiagnostic {
	/** Character offset where the highlight starts. */
	from: number
	/** Character offset where the highlight ends. */
	to: number
	severity: 'error' | 'warning'
	message: string
}

/** Handle returned by createEditor so callers don't need to import CM6 types. */
export interface EditorHandle {
	getValue(): string
	setValue(text: string,): void
	setTheme(name: SyntaxTheme,): void
	destroy(): void
}

export interface CreateEditorOptions {
	/** Textarea to replace with the editor. Its initial value is used as the editor content. */
	textarea: HTMLTextAreaElement
	/** MIME type used to pick a language extension. */
	mimetype: string
	/** Initial theme name. */
	theme: SyntaxTheme
	/** Whether to wrap long lines. */
	lineWrapping?: boolean
	/** Whether to enable auto-close-brackets. */
	autocomplete?: boolean
	/** Whether the editor is read-only. */
	readOnly?: boolean
	/** Called whenever the editor content changes. Syncs textarea automatically. */
	onChange?: () => void
	/**
	 * When provided, the editor runs this on the current text (debounced after
	 * changes) and highlights the returned ranges in the text and gutter.
	 */
	lintSource?: (text: string,) => EditorLintDiagnostic[]
}

/**
 * Creates a CodeMirror 6 editor replacing the given textarea.
 * Returns a handle with getValue/setValue/setTheme/destroy.
 */
export function createEditor (options: CreateEditorOptions,): EditorHandle {
	const {textarea, mimetype, lineWrapping = false, autocomplete = false, readOnly = false, onChange,} = options

	const themeCompartment = new Compartment()
	const langCompartment = new Compartment()

	const baseExtensions: Extension[] = [
		lineNumbers(),
		langCompartment.of(languageFor(mimetype,),),
		themeCompartment.of(getTheme(options.theme,),),
		EditorView.updateListener.of((update,) => {
			if (update.docChanged) {
				// Keep textarea in sync so form serialization still works
				textarea.value = update.state.doc.toString()
				onChange?.()
			}
		},),
	]

	if (lineWrapping) { baseExtensions.push(EditorView.lineWrapping,) }
	if (autocomplete) { baseExtensions.push(closeBrackets(),) }
	if (readOnly) { baseExtensions.push(EditorState.readOnly.of(true,),) }
	if (options.lintSource) {
		const source = options.lintSource
		baseExtensions.push(
			lintGutter(),
			linter((view,) => {
				const docLength = view.state.doc.length
				// Clamp to the document in case the source computed offsets from
				// stale text; out-of-range positions make CM6 throw.
				return source(view.state.doc.toString(),).map((diagnostic,) => ({
					...diagnostic,
					from: Math.min(diagnostic.from, docLength,),
					to: Math.min(Math.max(diagnostic.to, diagnostic.from,), docLength,),
				}))
			},),
		)
	}

	const customKeymap = keymap.of([
		{key: 'Ctrl-Alt-f', run: openSearchPanel,},
		{key: 'Ctrl-/', run: toggleComment,},
		{
			key: 'F11',
			run: (view,) => {
				view.dom.classList.toggle('toolbox-cm-fullscreen',)
				return true
			},
		},
		{
			key: 'Escape',
			run: (view,) => {
				if (view.dom.classList.contains('toolbox-cm-fullscreen',)) {
					view.dom.classList.remove('toolbox-cm-fullscreen',)
					return true
				}
				return false
			},
		},
		{key: 'Tab', run: indentMore, shift: indentLess,},
		...closeBracketsKeymap,
		...searchKeymap,
		...defaultKeymap,
		indentWithTab,
	],)

	baseExtensions.push(customKeymap,)

	const view = new EditorView({
		state: EditorState.create({
			doc: textarea.value,
			extensions: baseExtensions,
		},),
		parent: textarea.parentElement!,
	},)

	// Hide original textarea but keep it in the DOM for form serialization
	textarea.style.display = 'none'
	textarea.parentElement!.insertBefore(view.dom, textarea,)

	return {
		getValue () {
			return view.state.doc.toString()
		},
		setValue (text: string,) {
			view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: text,},},)
		},
		setTheme (name: SyntaxTheme,) {
			view.dispatch({effects: themeCompartment.reconfigure(getTheme(name,),),},)
		},
		destroy () {
			view.destroy()
			textarea.style.display = ''
		},
	}
}

const shortcutItems: [string, string,][] = [
	['F11', 'Fullscreen',],
	['Esc', 'Close Fullscreen',],
	['Ctrl-/ / Cmd-/', 'Toggle comment',],
	['Ctrl-F / Cmd-F', 'Start searching',],
	['Ctrl-Alt-F / Cmd-Alt-F', 'Persistent search (dialog doesn\'t autoclose)',],
	['Ctrl-G / Cmd-G', 'Find next',],
	['Shift-Ctrl-G / Shift-Cmd-G', 'Find previous',],
	['Shift-Ctrl-F / Cmd-Option-F', 'Replace',],
	['Shift-Ctrl-R / Shift-Cmd-Option-F', 'Replace all',],
	['Alt-G', 'Jump to line',],
	['Ctrl-Space / Cmd-Space', 'autocomplete',],
]

/**
 * Creates the keyboard-shortcuts panel injected above CodeMirror editors.
 */
export function createKeyboardShortcutsHelper (): HTMLElement {
	const wrapper = document.createElement('div',)
	wrapper.className = 'toolbox-syntax-keyboard'
	const heading = document.createElement('b',)
	heading.textContent = 'Keyboard shortcuts'
	wrapper.appendChild(heading,)
	const ul = document.createElement('ul',)
	for (const [key, desc,] of shortcutItems) {
		const li = document.createElement('li',)
		const em = document.createElement('i',)
		em.textContent = `${key}:`
		li.appendChild(em,)
		li.append(` ${desc}`,)
		ul.appendChild(li,)
	}
	wrapper.appendChild(ul,)
	return wrapper
}
