/** Popup window for creating, viewing, and editing shared subreddit wiki-based notes. */
import {ReactNode, useEffect, useMemo, useRef, useState,} from 'react'

import {ActionButton,} from '../../../shared/controls/ActionButton'
import {ActionSelect,} from '../../../shared/controls/ActionSelect'
import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {Icon,} from '../../../shared/controls/Icon'
import {TextInput,} from '../../../shared/controls/NormalInput'
import {PushDrawer,} from '../../../shared/window/PushDrawer'
import {Window,} from '../../../shared/window/Window'
import {unescapeJSON,} from '../../../util/data/encoding'
import {purify,} from '../../../util/data/purify'

import {getCurrentUser,} from '../../../api/resources/me'
import {getModSubs,} from '../../../api/resources/modSubs'
import {subredditNotes,} from '../../../framework/moduleIds'
import {negativeTextFeedback, neutralTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import createLogger from '../../../util/infra/logging'
import {getCache, setCache,} from '../../../util/persistence/cache'
import {useFetched,} from '../../../util/ui/hooks'
import {getMarkdownParser,} from '../../../util/ui/markdown'
import {classes, mountPopup,} from '../../../util/ui/reactMount'
import {computeIndexAggregates, makeEmptyIndex,} from '../../../util/wiki/schemas/subredditnotes/codec'
import type {
	SubredditNoteIndex,
	SubredditNoteMeta,
	SubredditNoteSort,
} from '../../../util/wiki/schemas/subredditnotes/schema'
import {OLD_NOTE_PAGE_PREFIX,} from '../../../util/wiki/wikiConstants'
import {getNotePagePrefix,} from '../../../util/wiki/wikiPaths'
import {filterAndSortNotes, getAllTags, makeTimestampUserSlug, shouldWarnUnsaved,} from '../helpers'
import {loadNoteIndex, readNotePage, writeNoteIndex, writeNotePage,} from '../moduleapi'

import css from './SubredditNotesPopup.module.css'
import {TagInput,} from './TagInput'

const log = createLogger('PNotes',)
const drawerWidthPx = 760
const drawerPushMediaQuery = '(min-width: 1120px)'

/** Loading/error states for the subreddit notes popup. */
type Mode = 'no-subreddit' | 'not-mod' | 'loading-list' | 'list-error' | 'ready'

/** Props for the SubredditNotesPopup component. */
interface SubredditNotesPopupProps {
	/** Default subreddit whose wiki is used to store notes (from settings). */
	notewiki: string
	/** Whether to use a monospace font in the text editor. */
	monospace: boolean
	/** When true and currentSubreddit is a modded subreddit, open to that subreddit instead of notewiki. */
	defaultToCurrentSub: boolean
	/** Subreddit of the current Reddit page (from URL), if any. */
	currentSubreddit?: string
	onClose: () => void
}

function formatTimestamp (time: number,): string {
	if (!time) { return 'Never saved' }
	return new Date(time,).toLocaleString()
}

function getWikiUrl (subreddit: string, notePrefix: string, slug: string,): string {
	// Encode the dynamic segments so untrusted text (the subreddit can derive from the page URL)
	// can't break out of the path or inject a different URL. notePrefix is a trusted constant that
	// intentionally contains path separators, so it is left intact.
	return `/r/${encodeURIComponent(subreddit,)}/wiki/${notePrefix}${encodeURIComponent(slug,)}`
}

/**
 * Toggles `item` in `prev`: removes it if present, appends it if absent.
 */
function toggleArrayItem<T,> (prev: T[], item: T,): T[] {
	return prev.includes(item,) ? prev.filter((v,) => v !== item) : [...prev, item,]
}

/** Renders the subreddit notes popup, allowing moderators to list, create, edit, and archive wiki-backed notes. */
export function SubredditNotesPopup ({
	notewiki,
	monospace,
	defaultToCurrentSub,
	currentSubreddit,
	onClose,
}: SubredditNotesPopupProps,) {
	const modSubs = (useFetched(getModSubs(false,),) as string[] | undefined) ?? []

	// modSubs loads asynchronously and is empty on the first render, so the active subreddit can't
	// be resolved at mount. Start with the configured notewiki and let the effect below switch to
	// the current subreddit (when defaultToCurrentSub is set) or the first modded sub once modSubs
	// has loaded.
	const [activeSubreddit, setActiveSubreddit,] = useState(notewiki,)
	// Guards the one-time initial resolution below so it may override a configured notewiki on first
	// load, without clobbering a subreddit the user later picks from the dropdown.
	const initialResolvedRef = useRef(false,)
	const [mode, setMode,] = useState<Mode>('loading-list',)
	const [index, setIndex,] = useState<SubredditNoteIndex>(makeEmptyIndex,)
	const [activeSlug, setActiveSlug,] = useState<string | null>(null,)
	const [editorValue, setEditorValue,] = useState('',)
	const [savedValue, setSavedValue,] = useState('',)
	const [savedTags, setSavedTags,] = useState<string[]>([],)
	const [editTags, setEditTags,] = useState<string[]>([],)
	const [editorLoading, setEditorLoading,] = useState(false,)
	const [saving, setSaving,] = useState(false,)
	const [search, setSearch,] = useState('',)
	const [sort, setSort,] = useState<SubredditNoteSort>('title',)
	const [showArchived, setShowArchived,] = useState(false,)
	const [selectedTagFilters, setSelectedTagFilters,] = useState<string[]>([],)
	const [selectedAuthorFilters, setSelectedAuthorFilters,] = useState<string[]>([],)
	const [lastSavedAt, setLastSavedAt,] = useState<number | null>(null,)
	const [draftNote, setDraftNote,] = useState<SubredditNoteMeta | null>(null,)
	const [editorMode, setEditorMode,] = useState<'edit' | 'preview'>('edit',)
	const [isEditing, setIsEditing,] = useState(false,)
	// Wiki page prefix for note pages under the active subreddit's wiki layout
	// (legacy `notes/` or NXG `toolbox-nxg/notes/`), used for display and links.
	const [notePrefix, setNotePrefix,] = useState(OLD_NOTE_PAGE_PREFIX,)
	const [editingTitle, setEditingTitle,] = useState('',)
	const [currentUser, setCurrentUser,] = useState('',)
	const [tagFilterOpen, setTagFilterOpen,] = useState(false,)
	const [authorFilterOpen, setAuthorFilterOpen,] = useState(false,)

	const parser = useMemo(() => getMarkdownParser(), [],)
	const activeNote = index.notes.find((note,) => note.slug === activeSlug) ?? draftNote
	const isDraftNote = draftNote != null && activeNote?.slug === draftNote.slug
		&& !index.notes.some((note,) => note.slug === draftNote.slug)
	const unsaved = shouldWarnUnsaved(savedValue, editorValue, saving,)
		|| editTags.length !== savedTags.length || editTags.some((tag, i,) => tag !== savedTags[i])
		|| isDraftNote
	const previewHtml = useMemo(() => purify(parser.render(editorValue,),), [parser, editorValue,],)

	/** All unique tags across every note (v2 index aggregate), used for tag editor autocomplete. */
	const allTagSuggestions = index.tags

	/** Tags with counts for the sidebar filter, computed from visible notes (respects archive toggle). */
	const allTagsWithCounts = useMemo(() => {
		const visibleForTags = showArchived
			? index.notes
			: index.notes.filter((n,) => !n.archived)
		return getAllTags(visibleForTags,)
	}, [index.notes, showArchived,],)

	/** All unique authors across every note (v2 index aggregate). */
	const allAuthors = index.authors

	/** Resets all editor pane state - call when deselecting a note or cancelling a draft. */
	function clearEditor () {
		setActiveSlug(null,)
		setDraftNote(null,)
		setEditorValue('',)
		setSavedValue('',)
		setSavedTags([],)
		setEditTags([],)
		setLastSavedAt(null,)
	}

	async function saveIndex (nextIndex: SubredditNoteIndex, reason: string,): Promise<boolean> {
		// Refresh the v2 aggregates so the local state matches what lands on
		// the wiki and the filter/autocomplete lists stay current.
		nextIndex = {...nextIndex, ...computeIndexAggregates(nextIndex.notes,),}
		try {
			await writeNoteIndex(activeSubreddit, nextIndex, reason,)
			setIndex(nextIndex,)
			if (activeSlug) {
				const updatedActive = nextIndex.notes.find((note,) => note.slug === activeSlug)
				if (updatedActive) {
					setSavedTags(updatedActive.tags,)
					setEditTags(updatedActive.tags,)
				}
			}
			return true
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err,)
			log.warn('Error saving subreddit notes index:', err,)
			negativeTextFeedback(message || 'Could not save subreddit notes index.',)
			return false
		}
	}

	async function loadIndex (): Promise<void> {
		setNotePrefix(await getNotePagePrefix(activeSubreddit,).catch(() => OLD_NOTE_PAGE_PREFIX),)
		const {index: loaded, bootstrapped,} = await loadNoteIndex(activeSubreddit,)
		setIndex(loaded,)
		setMode('ready',)
		if (bootstrapped) {
			saveIndex(loaded, 'toolbox subreddit notes index bootstrap',).catch(() => {},)
		}
	}

	// Once modSubs loads, resolve the initial subreddit a single time. When defaultToCurrentSub is
	// set and the current page's subreddit is one the user moderates, open to it - overriding any
	// configured notewiki. Otherwise fall back to the first modded sub when no notewiki is set.
	useEffect(() => {
		if (modSubs.length === 0 || initialResolvedRef.current) { return }
		initialResolvedRef.current = true
		if (
			defaultToCurrentSub
			&& currentSubreddit
			&& modSubs.some((s,) => s.toLowerCase() === currentSubreddit.toLowerCase())
		) {
			setActiveSubreddit(currentSubreddit,)
		} else if (notewiki === '') {
			setActiveSubreddit(modSubs[0]!,)
		}
	}, [modSubs.length, defaultToCurrentSub, currentSubreddit, notewiki,],)

	// Load note index whenever the active subreddit changes
	useEffect(() => {
		setIndex(makeEmptyIndex(),)
		clearEditor()
		setSelectedTagFilters([],)
		setSelectedAuthorFilters([],)
		;(async () => {
			if (activeSubreddit === '') {
				setMode('no-subreddit',)
				return
			}
			const mySubs = await getModSubs(false,) as string[]
			const mySubsLowerCase = mySubs.map((s: string,) => s.toLowerCase())
			if (!mySubsLowerCase.includes(activeSubreddit.toLowerCase(),)) {
				setMode('not-mod',)
				return
			}
			setMode('loading-list',)
			try {
				await loadIndex()
			} catch (error) {
				log.warn('Error loading subreddit notes:', error,)
				negativeTextFeedback('Could not load subreddit notes, try again.',)
				setMode('list-error',)
			}
		})()
	}, [activeSubreddit,],)

	useEffect(() => {
		getCurrentUser().then(setCurrentUser,).catch(() => setCurrentUser('unknown',))
	}, [],)

	useEffect(() => {
		setEditingTitle(activeNote?.title ?? '',)
	}, [activeNote?.slug,],)

	const visibleNotes = useMemo(() =>
		filterAndSortNotes(index.notes, {
			search,
			showArchived,
			sort,
			selectedTags: selectedTagFilters,
			selectedAuthors: selectedAuthorFilters,
		},), [index.notes, search, showArchived, sort, selectedTagFilters, selectedAuthorFilters,],)

	function confirmLoseChanges (): boolean {
		return !unsaved || confirm('You have unsaved changes. Discard them?',)
	}

	function updateNoteMeta (slug: string, patch: Partial<SubredditNoteMeta>,): SubredditNoteIndex {
		return {
			...index,
			notes: index.notes.map((note,) => note.slug === slug ? {...note, ...patch,} : note),
		}
	}

	const loadNote = async (note: SubredditNoteMeta,) => {
		if (note.slug === activeSlug || !confirmLoseChanges()) { return }

		setActiveSlug(note.slug,)
		setDraftNote(null,)
		setEditorLoading(true,)
		setEditorValue('Loading note...',)
		setSavedValue('',)
		setSavedTags(note.tags,)
		setEditTags(note.tags,)
		setLastSavedAt(null,)
		setIsEditing(false,)
		setEditorMode('preview',)
		try {
			const response = await readNotePage(activeSubreddit, note.slug,)
			if (!response.ok) {
				setEditorValue('',)
				setSavedValue('',)
				negativeTextFeedback('Could not read that note from the wiki.',)
				return
			}
			const body = unescapeJSON(response.data,)
			const draft = await getCache(subredditNotes, `draft-${activeSubreddit}-${note.slug}`, null,)
			if (draft && typeof (draft as Record<string, unknown>).body === 'string') {
				const d = draft as Record<string, unknown>
				setEditorValue(d.body as string,)
				if (Array.isArray(d.tags,)) {
					setEditTags((d.tags as unknown[]).filter((tag,): tag is string => typeof tag === 'string'),)
				}
				negativeTextFeedback('Restored an unsaved local draft for this note.',)
			} else {
				setEditorValue(body,)
			}
			setSavedValue(body,)
			setLastSavedAt(note.updatedAt,)
		} catch {
			setEditorValue('',)
			setSavedValue('',)
			negativeTextFeedback('Could not read that note from the wiki.',)
		} finally {
			setEditorLoading(false,)
		}
	}

	const saveNote = async (slug: string, data: string, reason: string, nextIndex: SubredditNoteIndex,) => {
		log.debug('posting subreddit note to wiki',)
		setSaving(true,)
		neutralTextFeedback('Saving note...',)
		try {
			await writeNotePage(activeSubreddit, slug, data, reason,)
			const indexSaved = await saveIndex(nextIndex, 'toolbox subreddit notes index update',)
			if (!indexSaved) { return }
			setSavedValue(data,)
			const savedMeta = nextIndex.notes.find((note,) => note.slug === slug)
			if (savedMeta) {
				setSavedTags(savedMeta.tags,)
				setEditTags(savedMeta.tags,)
			}
			setDraftNote(null,)
			setIsEditing(false,)
			setEditorMode('preview',)
			setCache(subredditNotes, `draft-${activeSubreddit}-${slug}`, null,).catch(() => {},)
			setLastSavedAt(Date.now(),)
			positiveTextFeedback('Note saved.',)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err,)
			log.warn('Error saving subreddit note:', err,)
			negativeTextFeedback(message || 'Could not save note.',)
		} finally {
			setSaving(false,)
		}
	}

	const handleCreate = async () => {
		if (!confirmLoseChanges()) { return }

		const now = Date.now()
		const slug = makeTimestampUserSlug(now, currentUser || 'unknown', index.notes.map((note,) => note.slug),)
		const newNote: SubredditNoteMeta = {
			slug,
			title: 'New note',
			createdAt: now,
			updatedAt: now,
			archived: false,
			tags: [],
			author: currentUser || undefined,
		}
		setActiveSlug(slug,)
		setDraftNote(newNote,)
		setEditorValue('New note',)
		setSavedValue('',)
		setSavedTags([],)
		setEditTags([],)
		setLastSavedAt(null,)
		setIsEditing(true,)
		setEditorMode('edit',)
		setCache(subredditNotes, `draft-${activeSubreddit}-${slug}`, {body: 'New note',},).catch(() => {},)
	}

	const handleSave = async () => {
		if (!activeNote) { return }
		const now = Date.now()
		const nextMeta = {...activeNote, updatedAt: now, tags: editTags, archived: false,}
		const nextNotes = isDraftNote
			? [...index.notes, nextMeta,]
			: index.notes.map((note,) => note.slug === activeNote.slug ? nextMeta : note)
		await saveNote(
			activeNote.slug,
			editorValue,
			isDraftNote ? 'toolbox new subreddit note' : 'toolbox subreddit note update',
			{...index, notes: nextNotes,},
		)
	}

	const handleSaveTitle = async () => {
		if (!activeNote) { return }
		const title = editingTitle.trim()
		if (!title || title === activeNote.title) { return }

		const now = Date.now()
		if (isDraftNote) {
			setDraftNote({...activeNote, title, updatedAt: now,},)
			setLastSavedAt(now,)
			positiveTextFeedback('Note renamed.',)
			return
		}

		const ok = await saveIndex(
			updateNoteMeta(activeNote.slug, {title, updatedAt: now,},),
			'toolbox subreddit note rename',
		)
		if (ok) {
			setLastSavedAt(now,)
			positiveTextFeedback('Note renamed.',)
		}
	}

	const handleArchive = async (note: SubredditNoteMeta,) => {
		if (note.slug === activeSlug && !confirmLoseChanges()) { return }
		const nextArchived = !note.archived
		const now = Date.now()
		const ok = await saveIndex(
			updateNoteMeta(note.slug, {archived: nextArchived, updatedAt: now,},),
			nextArchived ? 'toolbox subreddit note archive' : 'toolbox subreddit note restore',
		)
		if (!ok) { return }

		if (note.slug === activeSlug) {
			clearEditor()
		}
		positiveTextFeedback(nextArchived ? 'Note archived.' : 'Note restored.',)
	}

	useEffect(() => {
		if (!activeSlug || editorLoading || saving || !unsaved) { return }
		setCache(subredditNotes, `draft-${activeSubreddit}-${activeSlug}`, {
			body: editorValue,
			tags: editTags,
			updatedAt: Date.now(),
		},).catch(() => {},)
	}, [activeSlug, editTags.join('\n',), editorLoading, editorValue, activeSubreddit, saving, unsaved,],)

	const handleCancelDraft = () => {
		if (!draftNote) { return }
		setCache(subredditNotes, `draft-${activeSubreddit}-${draftNote.slug}`, null,).catch(() => {},)
		clearEditor()
	}

	const handleClose = () => {
		if (!confirmLoseChanges()) { return }
		onClose()
	}

	const handleSubredditChange = (subreddit: string,) => {
		if (subreddit === activeSubreddit) { return }
		if (!confirmLoseChanges()) { return }
		setActiveSubreddit(subreddit,)
	}

	const toggleTagFilter = (tag: string,) => setSelectedTagFilters((prev,) => toggleArrayItem(prev, tag,))
	const toggleAuthorFilter = (author: string,) => setSelectedAuthorFilters((prev,) => toggleArrayItem(prev, author,))

	let content: ReactNode
	if (mode === 'no-subreddit') {
		content = (
			<span className={css.error}>
				No subreddit is configured for notes. Select one from your moderated subreddits above.
			</span>
		)
	} else if (mode === 'not-mod') {
		content = <span className={css.error}>You are not a mod of /r/{activeSubreddit}.</span>
	} else if (mode === 'list-error') {
		content = <span className={css.error}>Error loading note list.</span>
	} else {
		content = (
			<div className={css.workspace}>
				<aside className={css.sidebar}>
					<div className={css.sidebarToolbar}>
						<ActionSelect
							aria-label="Switch subreddit notes space"
							value={activeSubreddit}
							onChange={(event,) => handleSubredditChange(event.target.value,)}
						>
							{!activeSubreddit && <option value="">Select a subreddit...</option>}
							{modSubs.map((subreddit,) =>
								<option key={subreddit} value={subreddit}>{subreddit}</option>
							)}
							{activeSubreddit && !modSubs.includes(activeSubreddit,) && (
								<option value={activeSubreddit}>{activeSubreddit}</option>
							)}
						</ActionSelect>
					</div>
					<div className={css.sidebarToolbar}>
						<TextInput
							aria-label="Search subreddit notes"
							placeholder="Search notes"
							value={search}
							onChange={(event,) => setSearch(event.target.value,)}
						/>
						<ActionSelect
							inline
							aria-label="Sort subreddit notes"
							value={sort}
							onChange={(event,) => setSort(event.target.value as SubredditNoteSort,)}
						>
							<option value="title">Title</option>
							<option value="updated">Updated</option>
						</ActionSelect>
					</div>
					<div className={css.archivedToggle}>
						<CheckboxInput
							label="Show archived"
							checked={showArchived}
							onChange={(event,) => setShowArchived(event.target.checked,)}
						/>
					</div>
					{allTagsWithCounts.length > 0 && (
						<div className={css.tagFilter}>
							<div className={css.tagFilterHeader}>
								<button
									type="button"
									className={css.tagFilterToggle}
									aria-expanded={tagFilterOpen}
									onClick={() => setTagFilterOpen((o,) => !o)}
								>
									<span
										className={classes(
											css.tagFilterChevron,
											tagFilterOpen && css.tagFilterChevronOpen,
										)}
									/>
									Filter by tag
								</button>
								{selectedTagFilters.length > 0 && (
									<button
										type="button"
										className={css.tagFilterClear}
										onClick={() => setSelectedTagFilters([],)}
									>
										clear
									</button>
								)}
							</div>
							{tagFilterOpen && (
								<div className={css.tagFilterChips}>
									{allTagsWithCounts.map(({tag, count,},) => (
										<button
											key={tag}
											type="button"
											className={classes(
												css.tagChip,
												selectedTagFilters.includes(tag,) && css.tagChipActive,
											)}
											onClick={() => toggleTagFilter(tag,)}
										>
											{tag}
											<span className={css.tagChipCount}>{count}</span>
										</button>
									))}
								</div>
							)}
						</div>
					)}
					{allAuthors.length > 1 && (
						<div className={css.tagFilter}>
							<div className={css.tagFilterHeader}>
								<button
									type="button"
									className={css.tagFilterToggle}
									aria-expanded={authorFilterOpen}
									onClick={() => setAuthorFilterOpen((o,) => !o)}
								>
									<span
										className={classes(
											css.tagFilterChevron,
											authorFilterOpen && css.tagFilterChevronOpen,
										)}
									/>
									Filter by author
								</button>
								{selectedAuthorFilters.length > 0 && (
									<button
										type="button"
										className={css.tagFilterClear}
										onClick={() => setSelectedAuthorFilters([],)}
									>
										clear
									</button>
								)}
							</div>
							{authorFilterOpen && (
								<div className={css.tagFilterChips}>
									{allAuthors.map((author,) => (
										<button
											key={author}
											type="button"
											className={classes(
												css.tagChip,
												selectedAuthorFilters.includes(author,) && css.tagChipActive,
											)}
											onClick={() => toggleAuthorFilter(author,)}
										>
											{author}
										</button>
									))}
								</div>
							)}
						</div>
					)}
					<div className={css.list}>
						{mode === 'loading-list'
							? null
							: (
								<button
									type="button"
									className={css.newNoteButton}
									onClick={handleCreate}
									disabled={editorLoading || saving || !currentUser}
								>
									+ New note
								</button>
							)}
						{mode === 'loading-list'
							? <span className={css.empty}>Loading...</span>
							: visibleNotes.length === 0
							? <span className={css.empty}>
								{search || selectedTagFilters.length > 0 || selectedAuthorFilters.length > 0
									? 'No matching notes.'
									: 'No notes found.'}
							</span>
							: (
								<ul className={css.notesUl}>
									{visibleNotes.map((note,) => (
										<li key={note.slug}>
											<button
												type="button"
												className={classes(
													css.noteButton,
													activeSlug === note.slug && css.active,
													note.archived && css.archived,
												)}
												onClick={() => loadNote(note,)}
												disabled={editorLoading || saving}
											>
												<span className={css.noteTitle}>{note.title}</span>
												<span className={css.noteMeta}>
													{note.archived ? 'Archived' : formatTimestamp(note.updatedAt,)}
													{note.author
														&& <span className={css.noteAuthor}>· {note.author}</span>}
												</span>
												{note.tags.length > 0 && (
													<span className={css.noteTagPills}>
														{note.tags.map((tag,) => (
															<span key={tag} className={css.noteTagPill}>{tag}</span>
														))}
													</span>
												)}
											</button>
											<button
												type="button"
												className={css.archiveButton}
												title={note.archived ? 'Restore note' : 'Archive note'}
												onClick={() => handleArchive(note,)}
												disabled={editorLoading || saving}
											>
												<Icon
													icon={note.archived ? 'unarchive' : 'archive'}
													mood={note.archived ? 'positive' : 'negative'}
												/>
											</button>
										</li>
									))}
								</ul>
							)}
					</div>
				</aside>
				<main className={css.editorPane}>
					{activeNote == null
						? (
							<div className={css.landing}>
								<span>Subreddit notes</span>
								<span className={css.landingSubtitle}>
									Select a note or create one to get started.
								</span>
							</div>
						)
						: (
							<>
								<div className={css.editorHeader}>
									<div>
										<div className={css.titleRow}>
											<TextInput
												aria-label="Note title"
												className={css.titleInput}
												value={editingTitle}
												disabled={editorLoading || saving}
												onChange={(event,) => setEditingTitle(event.target.value,)}
												onKeyDown={(event,) => {
													if (event.key === 'Enter') {
														event.preventDefault()
														handleSaveTitle()
													}
												}}
											/>
											<ActionButton
												inline
												onClick={handleSaveTitle}
												disabled={editorLoading || saving || !editingTitle.trim()
													|| editingTitle.trim() === activeNote.title}
											>
												save title
											</ActionButton>
										</div>
										<span className={css.editorMeta}>
											{isDraftNote ? 'Draft wiki page' : (
												<a
													href={getWikiUrl(activeSubreddit, notePrefix, activeNote.slug,)}
													target="_blank"
													rel="noreferrer"
												>
													Wiki page
												</a>
											)}: {notePrefix}
											{activeNote.slug}
											{unsaved ? ' - unsaved changes' : ''}
										</span>
										<TagInput
											aria-label="Note tags"
											className={css.tagInput}
											tags={editTags}
											suggestions={allTagSuggestions}
											disabled={editorLoading || saving}
											onChange={setEditTags}
										/>
									</div>
									{(isEditing || isDraftNote) && (
										<div className={css.editorActions}>
											<div className={css.modeToggle} aria-label="Editor mode">
												<button
													type="button"
													className={classes(editorMode === 'edit' && css.modeToggleActive,)}
													onClick={() => setEditorMode('edit',)}
												>
													edit
												</button>
												<button
													type="button"
													className={classes(
														editorMode === 'preview' && css.modeToggleActive,
													)}
													onClick={() => setEditorMode('preview',)}
												>
													preview
												</button>
											</div>
										</div>
									)}
								</div>
								{editorMode === 'preview'
									? (
										<div className={css.previewPane}>
											<div className="md" dangerouslySetInnerHTML={{__html: previewHtml,}} />
										</div>
									)
									: (
										<textarea
											className={classes(css.editarea, monospace && css.monospace,)}
											value={editorValue}
											disabled={editorLoading || saving}
											onChange={(event,) => setEditorValue(event.target.value,)}
										/>
									)}
							</>
						)}
				</main>
			</div>
		)
	}

	return (
		<PushDrawer
			widthPx={drawerWidthPx}
			pushMediaQuery={drawerPushMediaQuery}
			className={css.drawerRoot ?? ''}
			onClose={handleClose}
		>
			<Window
				title="Subreddit notes"
				className={css.popup}
				closable
				onClose={handleClose}
				footer={mode === 'ready'
					? (
						<div className={css.footer}>
							<span className={classes(css.status, unsaved && css.unsaved,)}>
								{activeNote == null
									? 'No note selected'
									: saving
									? 'Saving...'
									: unsaved
									? isDraftNote ? 'Unsaved draft' : 'Unsaved changes'
									: lastSavedAt
									? `Saved ${formatTimestamp(lastSavedAt,)}`
									: 'Loaded'}
							</span>
							{isDraftNote && (
								<ActionButton onClick={handleCancelDraft} disabled={saving}>
									cancel
								</ActionButton>
							)}
							{isEditing || isDraftNote
								? (
									<ActionButton
										primary
										onClick={handleSave}
										disabled={activeNote == null || editorLoading || saving || !unsaved}
									>
										save note
									</ActionButton>
								)
								: (
									<ActionButton
										primary
										onClick={() => {
											setIsEditing(true,)
											setEditorMode('edit',)
										}}
										disabled={activeNote == null || editorLoading}
									>
										edit
									</ActionButton>
								)}
						</div>
					)
					: null}
			>
				{content}
			</Window>
		</PushDrawer>
	)
}

/**
 * Mounts the SubredditNotesPopup into the page and returns a cleanup function.
 * @param props Popup props; `onClose` is optional and merged with the mount cleanup.
 * @returns A function that unmounts the popup.
 */
export function showSubredditNotesPopup (
	props: Omit<SubredditNotesPopupProps, 'onClose'> & {onClose?: () => void},
) {
	// Single-instance manager UI (no per-target arg), so re-opening reveals the one
	// live popup rather than mounting a duplicate that would discard in-progress edits.
	return mountPopup(
		(onClose,) => <SubredditNotesPopup {...props} onClose={onClose} />,
		props.onClose,
		'subredditnotes',
	)
}
