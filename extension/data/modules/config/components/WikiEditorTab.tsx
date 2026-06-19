/** Full-featured wiki editor tab supporting JSON and YAML pages with optional CodeMirror syntax highlighting. */
import {useEffect, useRef, useState,} from 'react'

import {getWikiRevisions,} from '../../../api/resources/wiki'
import type {WikiRevision,} from '../../../api/resources/wiki'
import {syntax,} from '../../../framework/moduleIds'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {ActionSelect,} from '../../../shared/controls/ActionSelect'
import {negativeTextFeedback, neutralTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import createLogger from '../../../util/infra/logging'
import {setSettingAsync,} from '../../../util/persistence/settings'
import {link,} from '../../../util/reddit/pageContext'
import {createEditor, createKeyboardShortcutsHelper,} from '../../../util/ui/codemirrorSetup'
import type {EditorHandle,} from '../../../util/ui/codemirrorSetup'
import {useSaveRef, useSetting,} from '../../../util/ui/hooks'
import type {SaveRef,} from '../../../util/ui/hooks'
import {validateWikiEditorJson,} from '../../../util/wiki/schemas/config/validation'
import type {WikiEditorDiagnostic,} from '../../../util/wiki/schemas/config/validation'
import type {WikiPageName,} from '../../../util/wiki/wikiConstants'
import {getWikiReadPath,} from '../../../util/wiki/wikiPaths'
import {syntaxThemes,} from '../../syntax/syntaxThemes'
import type {SyntaxTheme,} from '../../syntax/syntaxThemes'
import {
	convertUsernotesEditorText,
	getUsernotesEditorView,
	loadWikiEditorPage,
	loadWikiEditorRevision,
	prepareWikiEditorContent,
	saveWikiEditorPage,
} from '../moduleapi'
import type {UsernotesEditorView,} from '../moduleapi'
import css from './WikiEditorTab.module.css'

const log = createLogger('TBConfig',)

/**
 * The wiki page to load and edit in the editor. `usernotesShard` is one page
 * of the sharded NXG usernotes layout; shard tabs must also pass the literal
 * shard path via the `literalPage` prop.
 */
export type WikiPage = 'toolbox' | 'usernotes' | 'usernotesShard' | 'automoderator'

/**
 * Imperative wiki-history API the tab assigns into a ref so the footer's
 * rollback dropdown can drive it. Both functions target the page the editor
 * is pointed at.
 */
export interface WikiEditorHistory {
	/** Lists the current page's revision history, newest first. */
	listRevisions: () => Promise<WikiRevision[]>
	/** Loads one revision's content into the editor (saving then restores it). */
	loadRevision: (revision: WikiRevision,) => void
}

/** Ref-based slot for the wiki-history API shared between tab and footer. */
export type HistoryRef = {current: WikiEditorHistory | null}

/** Props for the WikiEditorTab component. */
interface Props {
	/** The subreddit whose wiki page is being edited. */
	subreddit: string
	/** Which wiki page to load: toolbox config, usernotes, a usernotes shard, or AutoModerator config. */
	page: WikiPage
	/**
	 * Explicit literal wiki path overriding the page-name resolution. Pages
	 * whose paths aren't statically known (NXG usernotes shard pages) pass
	 * their exact path here.
	 */
	literalPage?: string
	/** If provided, the tab will assign a save function into this ref so a footer button can trigger it. */
	saveRef?: SaveRef
	/** If provided, the tab will write the current revision note value into this ref before saving. */
	revisionNoteRef?: {current: string}
	/** If provided, the tab will assign its wiki-history API into this ref for the footer's rollback dropdown. */
	historyRef?: HistoryRef
}

/**
 * Resolves the literal wiki path the editor reads and writes. Toolbox pages
 * resolve through the subreddit's wiki layout: the canonical NXG page
 * normally, or the classic page on `legacyFallback` subs - those have no NXG
 * pages, and creating one via a raw save here would flip the resolved layout
 * to NXG and strand the live data on the classic pages. On NXG subs the
 * classic (legacy 6.x) mirror is maintained automatically by the compat write
 * fan-out and is not editable here, since the two sides hold different
 * schemas and a raw classic edit would be overwritten by the next mirrored
 * save anyway. `automoderator` is a Reddit-native page that toolbox never
 * relocates. Never called for `usernotesShard` - shard tabs always pass their
 * exact path via the `literalPage` prop instead.
 */
async function getEditorPage (page: WikiPage, subreddit: string,): Promise<string> {
	if (page === 'automoderator') { return 'config/automoderator' }
	const name: WikiPageName = page === 'toolbox' ? 'settings' : 'usernotes'
	return getWikiReadPath(name, subreddit,)
}

/**
 * Renders a CodeMirror (or plain textarea) editor pre-loaded with a subreddit wiki page,
 * with save functionality and AutoModerator error display.
 */
export function WikiEditorTab ({subreddit, page, literalPage, saveRef, revisionNoteRef, historyRef,}: Props,) {
	const syntaxEnabled = useSetting(syntax, 'enabled', true,)
	const selectedTheme = (useSetting(syntax, 'selectedTheme', 'dracula',) || 'dracula') as SyntaxTheme
	const enableWordWrap = useSetting(syntax, 'enableWordWrap', true,)

	const [theme, setTheme,] = useState<SyntaxTheme>(selectedTheme,)

	const textareaRef = useRef<HTMLTextAreaElement>(null,)
	const editorRef = useRef<EditorHandle | null>(null,)
	const isLoadedRef = useRef(false,)
	const [automodError, setAutomodError,] = useState<string | null>(null,)

	const isAutomod = page === 'automoderator'
	// Pages holding compressed usernote data (the usernotes page itself and the
	// NXG shard pages) get blob expansion/recompression and the view toggle.
	const isUsernotesLike = page === 'usernotes' || page === 'usernotesShard'
	const mimetype = isAutomod ? 'text/x-yaml' : 'application/json'

	// The single page this editor reads and writes: the explicit literal path
	// when given, otherwise resolved against the subreddit's wiki layout by
	// the initial-load effect. null until resolved; saving and wiki history
	// are unavailable until then (the load gate covers saving).
	const [actualPage, setActualPage,] = useState<string | null>(literalPage ?? null,)

	// Which representation of the usernotes page the editor currently shows.
	// The editor defaults to the decompressed view; the toggle button switches
	// to the compressed on-wiki form and back. null hides the toggle.
	const [usernotesView, setUsernotesView,] = useState<UsernotesEditorView>(null,)

	/** Writes text into whichever editor surface is active. */
	function setText (text: string,) {
		if (editorRef.current) { editorRef.current.setValue(text,) }
		else if (textareaRef.current) { textareaRef.current.value = text }
		setUsernotesView(isUsernotesLike ? getUsernotesEditorView(text,) : null,)
	}

	/** Reads the current text from whichever editor surface is active. */
	function getText (): string {
		return editorRef.current ? editorRef.current.getValue() : (textareaRef.current?.value ?? '')
	}

	/**
	 * Converts freshly loaded usernotes page text to the default decompressed
	 * view. Falls back to the compressed text (still editable and saveable)
	 * with a feedback toast when decompression fails.
	 */
	async function presentLoadedText (text: string,): Promise<string> {
		if (!isUsernotesLike || getUsernotesEditorView(text,) !== 'compressed') { return text }
		const converted = await convertUsernotesEditorText(text, 'decompressed',)
		if (!converted.ok) {
			negativeTextFeedback(converted.message,)
			return text
		}
		return converted.text
	}

	/**
	 * Validates the current text against the page's schema, or `null` for
	 * pages this editor has no validator for (AutoModerator YAML is validated
	 * server-side on save).
	 */
	function validateCurrentText (text: string,): WikiEditorDiagnostic[] | null {
		if (page === 'automoderator') { return null }
		// The loading placeholder isn't JSON; don't flag it.
		if (!isLoadedRef.current) { return null }
		return validateWikiEditorJson(text, page,)
	}

	useEffect(() => {
		const textarea = textareaRef.current
		if (!textarea) { return }

		let editor: EditorHandle | null = null
		if (syntaxEnabled) {
			document.body.classList.add('mod-syntax',)
			editor = createEditor({
				textarea,
				mimetype,
				theme,
				lineWrapping: !!enableWordWrap,
				autocomplete: true,
				...(isAutomod ? {} : {lintSource: (text: string,) => validateCurrentText(text,) ?? [],}),
			},)
			editorRef.current = editor
			const helper = createKeyboardShortcutsHelper()
			document.querySelector('.cm-editor',)?.prepend(helper,)
		}

		setText('getting wiki data...',)

		return () => {
			editor?.destroy()
			editorRef.current = null
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [],) // intentionally run once on mount (tab is lazy)

	// Load the page content once on mount (the tab is lazy-mounted).
	useEffect(() => {
		isLoadedRef.current = false
		setText('getting wiki data...',)
		let stale = false
		void (async () => {
			// Resolve the layout-dependent path first so every later read and
			// write (save, history, rollback) targets the same page.
			const pageToLoad = literalPage ?? await getEditorPage(page, subreddit,)
			if (stale) { return }
			setActualPage(pageToLoad,)
			const result = await loadWikiEditorPage(subreddit, pageToLoad, {isUsernotes: isUsernotesLike, isAutomod,},)
			if (stale) { return }
			if (!result.ok) {
				if (result.kind === 'error') {
					setText('error getting wiki data.',)
					return
				}
				setText('',)
				isLoadedRef.current = true
				return
			}
			const text = await presentLoadedText(result.text,)
			if (stale) { return }
			setText(text,)
			isLoadedRef.current = true
		})()
		return () => {
			stale = true
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [],)

	useEffect(() => {
		editorRef.current?.setTheme(theme,)
	}, [theme,],)

	const handleThemeChange = (e: React.ChangeEvent<HTMLSelectElement>,) => {
		const newTheme = e.target.value as SyntaxTheme
		setTheme(newTheme,)
		void setSettingAsync(syntax, 'selectedTheme', newTheme,)
	}

	function handleSave () {
		if (!isLoadedRef.current || actualPage === null) {
			neutralTextFeedback('Page not yet loaded',)
			return
		}
		const rawContent = getText()
		const note = (revisionNoteRef?.current ?? '') || `updated ${literalPage ?? page} configuration`

		// Pre-save validation: syntax errors block the save outright (with line
		// numbers, since the plain-textarea fallback has no inline highlights);
		// schema warnings are surfaced by the live lint highlights but still save.
		const diagnostics = validateCurrentText(rawContent,)
		const syntaxErrors = diagnostics?.filter((d,) => d.severity === 'error') ?? []
		if (syntaxErrors.length > 0) {
			negativeTextFeedback(`Page not saved. ${syntaxErrors[0]!.message}`,)
			return
		}

		setAutomodError(null,)
		neutralTextFeedback('saving to wiki',)
		// The raw editor writes exactly the page being edited - no compat
		// fan-out, because the classic mirror holds a different schema and
		// mirroring raw text across would corrupt it. The next normal save
		// refreshes the mirror from the canonical data.
		void (async () => {
			// Validate/minify JSON and recompress decompressed usernotes
			// (expanded v6 users back into the zlib blob).
			const prepared = await prepareWikiEditorContent(
				rawContent,
				{isUsernotes: isUsernotesLike, isAutomod,},
			)
			if (!prepared.ok) {
				log.debug(`Error preparing wiki page for save: ${prepared.message}`,)
				negativeTextFeedback(prepared.message,)
				return
			}
			const result = await saveWikiEditorPage(
				subreddit,
				actualPage,
				prepared.content,
				note,
				isAutomod,
			)
			if (!result.ok) {
				setAutomodError(result.automodError,)
				negativeTextFeedback(result.message,)
				return
			}
			positiveTextFeedback('wiki page saved',)
		})()
	}
	useSaveRef(saveRef, handleSave,)

	/**
	 * Toggles the editor between the decompressed (default) and compressed
	 * usernotes representations, converting the current text - including any
	 * edits - rather than re-reading the wiki.
	 */
	function handleViewToggle () {
		const content = getText()
		const currentView = getUsernotesEditorView(content,)
		if (currentView === null) {
			setUsernotesView(null,)
			negativeTextFeedback('This page is not recognized as usernotes data.',)
			return
		}
		const target = currentView === 'compressed' ? 'decompressed' : 'compressed'
		void convertUsernotesEditorText(content, target,).then((converted,) => {
			if (!converted.ok) {
				negativeTextFeedback(converted.message,)
				return
			}
			setText(converted.text,)
		},)
	}

	// Expose the wiki-history API for the footer's rollback dropdown. Assigned
	// every render once the page path is resolved, cleared on unmount.
	useEffect(() => {
		if (!historyRef) { return }
		return () => {
			historyRef.current = null
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [],)
	if (historyRef && actualPage !== null) {
		historyRef.current = {
			listRevisions: () => getWikiRevisions(subreddit, actualPage,),
			loadRevision: (revision: WikiRevision,) => {
				isLoadedRef.current = false
				setText('getting wiki data...',)
				void loadWikiEditorRevision(
					subreddit,
					actualPage,
					revision.id,
					{isUsernotes: isUsernotesLike, isAutomod,},
				).then(async (result,) => {
					if (!result.ok) {
						setText('error getting wiki data.',)
						negativeTextFeedback('Could not load that revision.',)
						return
					}
					setText(await presentLoadedText(result.text,),)
					isLoadedRef.current = true
					neutralTextFeedback(
						`Loaded revision from ${
							new Date(revision.timestamp * 1000,).toLocaleString()
						} - save to restore it`,
					)
				},)
			},
		}
	}

	return (
		<div>
			{isAutomod && (
				<p className={css.settingsLink}>
					<a href={link('/wiki/automoderator/full-documentation',)} target="_blank" rel="noreferrer">
						Full automoderator documentation
					</a>
				</p>
			)}
			{(isUsernotesLike || page === 'toolbox') && (
				<div className={css.warning}>
					<b>
						Here be dragons! Editing raw JSON can corrupt your subreddit config and break toolbox for all
						moderators. Only proceed if you know exactly what you are doing.
					</b>
				</div>
			)}
			{usernotesView !== null && (
				<div className={css.sideToggle}>
					<ActionButton type="button" onClick={handleViewToggle}>
						{usernotesView === 'compressed' ? 'Show decompressed' : 'Show compressed'}
					</ActionButton>
					<span className={css.sideToggleHint}>
						{usernotesView === 'compressed'
							? 'Showing the compressed on-wiki form.'
							: 'Showing editable JSON; saving stores the compressed form.'}
					</span>
				</div>
			)}
			{isAutomod && automodError != null && (
				<div className={css.warning}>
					<b>Config not saved!</b>
					<br />
					<pre dangerouslySetInnerHTML={{__html: automodError,}} />
				</div>
			)}
			{syntaxEnabled && (
				<div style={{marginBottom: '4px',}}>
					<label style={{fontSize: '1em', marginRight: '0.3333em',}}>Theme:</label>
					<ActionSelect value={theme} onChange={handleThemeChange} inline>
						{syntaxThemes.map((t,) => (
							<option key={t} value={t}>{t}</option>
						))}
					</ActionSelect>
				</div>
			)}
			<textarea ref={textareaRef} className={`toolbox-input ${css.editWikidata}`} rows={20} cols={20} />
		</div>
	)
}
