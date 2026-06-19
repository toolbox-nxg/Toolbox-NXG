/** Full-screen overlay for browsing, filtering, deleting, and pruning a subreddit's usernotes. */

import {useEffect, useMemo, useRef, useState,} from 'react'

import {usernotes,} from '../../../framework/moduleIds'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {ActionSelect,} from '../../../shared/controls/ActionSelect'
import {Icon,} from '../../../shared/controls/Icon'
import {TextInput,} from '../../../shared/controls/NormalInput'
import {RelativeTime,} from '../../../shared/controls/RelativeTime'
import {FullPageDialog,} from '../../../shared/window/FullPageDialog'
import {TabBar,} from '../../../shared/window/TabBar'
import {positiveTextFeedback,} from '../../../store/feedback'
import {nowInSeconds,} from '../../../util/data/time'
import {getCache, setCache,} from '../../../util/persistence/cache'
import {mountPopup,} from '../../../util/ui/reactMount'
import {
	ArchivedMode,
	formatArchiveAttribution,
	isNoteActive,
	PruneOptions,
	PruneProgress,
	UserNoteColor,
	UserNoteEntry,
	UsernotesUser,
} from '../../../util/wiki/schemas/usernotes/schema'
import {SHARD_SOFT_LIMIT_BYTES,} from '../../../util/wiki/schemas/usernotes/sharding'
import {withArchived,} from '../../shared/usernotes/archived'
import {noteTypeColorStyle,} from '../../shared/usernotes/noteTypeColorStyle'
import {exportUsernotesCsv,} from '../csvExport'
import {PruneUserNotesPanel,} from './PruneUserNotesPopup'
import {
	filterUsers,
	getKindLabel,
	getNoteStats,
	getUserNotesStatistics,
	sortUsers,
	statLabel,
	UserNotesManagerPreferences,
	UserNotesManagerSortKey,
	UsernotesStorageInfo,
	usernotesWikiMaxBytes,
} from './UserNotesManagerOverlay.helpers'

import css from './UserNotesManagerOverlay.module.css'

/** Props for the UserNotesManagerOverlay component. */
interface UserNotesManagerOverlayProps {
	/** Subreddit whose notes are being managed. */
	subreddit: string
	/** All users with notes for this subreddit. */
	users: UsernotesUser[]
	colors: UserNoteColor[]
	/**
	 * Lazily resolves actual wiki storage usage - invoked only when the
	 * Statistics tab is first opened, so the (possibly network-bound) read
	 * never blocks the manager from appearing. Legacy-canonical subs report
	 * the raw legacy page size (bound by Reddit's 1MB allowance); NXG subs
	 * report the sharded layout's totals. Until it resolves (or if it returns
	 * `undefined`), an estimate against the legacy limit is shown.
	 */
	resolveStorageInfo: () => Promise<UsernotesStorageInfo | undefined>
	/** Resolves a note type key to its color/label definition. */
	findColor: (key: string,) => UserNoteColor
	/** Checks whether the given user account is active or deleted. */
	onRefreshUser: (user: string,) => Promise<{status: 'active' | 'deleted'}>
	/** Permanently removes all notes for a user from the wiki. */
	onDeleteUser: (user: string,) => Promise<void>
	/**
	 * Permanently removes a single note from the wiki.
	 * @param noteIndex The note's stable per-user index (never reused).
	 */
	onDeleteNote: (user: string, noteIndex: number,) => Promise<void>
	/** Re-adds all of a user's notes after a delete (undo support). */
	onRestoreUser: (user: string, notes: UserNoteEntry[],) => Promise<void>
	/**
	 * Re-inserts a single note after a delete (undo support).
	 * @param notePosition The array position at which to re-insert the note.
	 */
	onRestoreNote: (user: string, note: UserNoteEntry, notePosition: number,) => Promise<void>
	/** Archives a note (hidden but kept), by stable index. Only on NXG subs. */
	onArchiveNote?: ((user: string, noteIndex: number,) => Promise<void>) | undefined
	/** Archives all active notes for a user in one save. Only on NXG subs. */
	onArchiveAllNotes?: ((user: string,) => Promise<void>) | undefined
	/** Clears a note's archived state, by stable index. */
	onUnarchiveNote?: ((user: string, noteIndex: number,) => Promise<void>) | undefined
	/**
	 * Whether archiving is available (NXG-canonical layouts only; the legacy
	 * v6 page can't carry archive attributions).
	 */
	archivingAvailable?: boolean | undefined
	/** The acting moderator's username, for local attribution display. */
	currentUser?: string | undefined
	/** Executes the configured prune operation, optionally reporting progress. */
	onPrune: (options: PruneOptions, onProgress?: (progress: PruneProgress,) => void,) => Promise<void>
	onClose: () => void
}

const usersPerPage = 50
const prefCacheKey = 'managerPreferences'
type ManagerTab = 'browse' | 'prune' | 'stats'
const defaultPrefs: UserNotesManagerPreferences = {
	userText: '',
	contentText: '',
	kind: [],
	moderator: 'all',
	archived: 'exclude',
	sortKey: 'username',
	sortDirection: 'asc',
	pageSize: usersPerPage,
}

function formatDate (time: number | null,) {
	if (time == null) { return 'None' }
	return new Date(time * 1000,).toLocaleDateString()
}

/**
 * A segmented button group: renders one `toggleBtn` per option and highlights
 * the one whose `value` matches the current selection. Used for the browse
 * "Archived" filter and the statistics view switcher.
 * @param ariaLabel Accessible label for the button group.
 * @param options The selectable values and their button labels.
 * @param value The currently selected value.
 * @param onChange Called with the chosen value when a button is clicked.
 */
function ToggleGroup<T,> ({
	ariaLabel,
	options,
	value,
	onChange,
}: {
	ariaLabel: string
	options: {value: T; label: string}[]
	value: T
	onChange: (value: T,) => void
},) {
	return (
		<div className={css.toggleGroup} role="group" aria-label={ariaLabel}>
			{options.map((option,) => (
				<button
					key={String(option.value,)}
					type="button"
					className={`${css.toggleBtn} ${value === option.value ? css.toggleBtnActive : ''}`}
					onClick={() => onChange(option.value,)}
				>
					{option.label}
				</button>
			))}
		</div>
	)
}

function formatNumber (value: number, fractionDigits = 0,) {
	return value.toLocaleString(undefined, {maximumFractionDigits: fractionDigits,},)
}

function formatPercent (part: number, total: number,) {
	if (!total) { return '0%' }
	return `${formatNumber(part / total * 100, 1,)}%`
}

function formatBytes (bytes: number,) {
	if (bytes < 1024) { return `${formatNumber(bytes,)} B` }
	return `${formatNumber(bytes / 1024, 1,)} KB`
}

function renderPagerControls (
	totalPages: number,
	activePage: number,
	setPage: (i: number,) => void,
) {
	if (totalPages <= 1) { return null }

	const elements: React.ReactNode[] = []
	let leftBound = 0
	let rightBound = totalPages - 1
	if (totalPages > 10) {
		leftBound = Math.max(activePage - 4, 0,)
		rightBound = Math.min(activePage + 4, totalPages - 1,)
	}

	function pageButton (i: number,) {
		return (
			<button
				key={i}
				type="button"
				className={`${css.pagerButton} ${i === activePage ? css.pagerButtonActive : ''}`}
				onClick={() => setPage(i,)}
			>
				{i + 1}
			</button>
		)
	}

	if (leftBound > 0) { elements.push(pageButton(0,),) }
	if (leftBound > 1) { elements.push(<span key="left-ellipsis">...</span>,) }
	for (let i = leftBound; i <= rightBound; i += 1) { elements.push(pageButton(i,),) }
	if (rightBound < totalPages - 2) { elements.push(<span key="right-ellipsis">...</span>,) }
	if (rightBound < totalPages - 1) { elements.push(pageButton(totalPages - 1,),) }

	return elements
}

function UserNotesManagerOverlay ({
	subreddit,
	users: initialUsers,
	colors,
	resolveStorageInfo,
	findColor,
	onRefreshUser,
	onDeleteUser,
	onDeleteNote,
	onRestoreUser,
	onRestoreNote,
	onArchiveNote,
	onArchiveAllNotes,
	onUnarchiveNote,
	archivingAvailable = false,
	currentUser = '',
	onPrune,
	onClose,
}: UserNotesManagerOverlayProps,) {
	const [users, setUsers,] = useState(initialUsers,)
	const [prefs, setPrefs,] = useState<UserNotesManagerPreferences>(defaultPrefs,)
	const [prefsLoaded, setPrefsLoaded,] = useState(false,)
	const [activeTab, setActiveTab,] = useState<ManagerTab>('browse',)
	const [statsView, setStatsView,] = useState<'all' | 'active' | 'archived'>('all',)
	// Actual storage usage is read lazily the first time Statistics is opened,
	// so the (network-bound) read never blocks the manager from appearing.
	const [storageInfo, setStorageInfo,] = useState<UsernotesStorageInfo | undefined>()
	const [storageLoading, setStorageLoading,] = useState(false,)
	// Guards the lazy storage read against re-entry without making it a render
	// dependency (see the resolving effect below).
	const storageRequestedRef = useRef(false,)
	const [page, setPage,] = useState(0,)
	const [refreshStatuses, setRefreshStatuses,] = useState<Record<string, string>>({},)
	const userListRef = useRef<HTMLDivElement>(null,)

	const [lastAction, setLastAction,] = useState<
		{
			type: 'deleteUser' | 'deleteNote'
			user: string
			notes?: UserNoteEntry[]
			note?: UserNoteEntry
			noteIdx?: number
		} | null
	>(null,)

	const uniqueMods = useMemo(() => {
		const mods = new Set<string>()
		users.forEach((user,) => {
			user.notes.forEach((note,) => {
				if (note.mod) { mods.add(note.mod,) }
			},)
		},)
		return Array.from(mods,).sort((a, b,) => a.localeCompare(b, undefined, {sensitivity: 'base',},))
	}, [users,],)

	useEffect(() => {
		getCache(usernotes, prefCacheKey, defaultPrefs,).then(
			(cached: Partial<UserNotesManagerPreferences> & {showArchived?: boolean | 'only'},) => {
				// Migrate the pre-enum `showArchived` flag (false/undefined = hide,
				// true = show, 'only') to the unified `archived` mode.
				const {showArchived, ...rest} = cached
				const archived = rest.archived
					?? (showArchived === 'only' ? 'only' : showArchived ? 'include' : 'exclude')
				setPrefs({...defaultPrefs, ...rest, archived,},)
				setPrefsLoaded(true,)
			},
		)
	}, [],)

	useEffect(() => {
		if (!prefsLoaded) { return }
		setCache(usernotes, prefCacheKey, prefs,)
	}, [prefs, prefsLoaded,],)

	function updatePrefs (next: Partial<UserNotesManagerPreferences>,) {
		setPrefs((prev,) => ({...prev, ...next,}))
		setPage(0,)
	}

	const filteredUsers = useMemo(() => {
		return sortUsers(
			filterUsers(users, {
				userText: prefs.userText,
				contentText: prefs.contentText,
				kind: prefs.kind,
				moderator: prefs.moderator || 'all',
				archived: prefs.archived ?? 'exclude',
			},),
			prefs.sortKey,
			prefs.sortDirection,
			colors,
		)
	}, [users, prefs, colors,],)

	const totalPages = Math.max(1, Math.ceil(filteredUsers.length / prefs.pageSize,),)
	const safePage = Math.min(page, totalPages - 1,)
	const pageStart = safePage * prefs.pageSize
	const pageUsers = filteredUsers.slice(pageStart, pageStart + prefs.pageSize,)

	useEffect(() => {
		userListRef.current?.scrollTo({top: 0,},)
	}, [safePage,],)

	const allStats = useMemo(() => getNoteStats(users, colors,), [users, colors,],)
	const visibleStats = useMemo(() => getNoteStats(filteredUsers, colors,), [filteredUsers, colors,],)
	const hasArchivedNotes = useMemo(
		() => users.some((u,) => u.notes.some((n,) => !isNoteActive(n,))),
		[users,],
	)
	const statisticsUsers = useMemo(() => {
		if (statsView === 'all') { return users }
		const wantActive = statsView === 'active'
		return users.map((u,) => ({...u, notes: u.notes.filter((n,) => isNoteActive(n,) === wantActive),}))
			.filter((u,) => u.notes.length > 0)
	}, [users, statsView,],)
	const statistics = useMemo(() => getUserNotesStatistics(statisticsUsers, colors,), [statisticsUsers, colors,],)
	const storageBytesUsed = storageInfo?.totalBytes ?? statistics.storageBytesUsed
	const storageBytesRemaining = Math.max(0, usernotesWikiMaxBytes - storageBytesUsed,)
	const filtersActive = prefs.userText || prefs.contentText || prefs.kind.length > 0 || prefs.moderator !== 'all'

	// Resolve actual storage usage once, the first time Statistics is opened.
	// `storageLoading` is deliberately NOT a dependency: setting it would re-run
	// the effect, whose cleanup would flip `active` to false and discard the
	// in-flight read before it resolves. Re-entry is instead guarded by a ref.
	useEffect(() => {
		if (activeTab !== 'stats' || storageInfo !== undefined || storageRequestedRef.current) { return }
		storageRequestedRef.current = true
		let active = true
		setStorageLoading(true,)
		resolveStorageInfo().then((info,) => {
			if (active) { setStorageInfo(info,) }
		},).catch(() => {},).finally(() => {
			if (active) { setStorageLoading(false,) }
		},)
		return () => {
			active = false
			// If the read was abandoned (tab switch/unmount) before it resolved,
			// allow a fresh attempt the next time Statistics is opened.
			if (storageInfo === undefined) { storageRequestedRef.current = false }
		}
	}, [activeTab, storageInfo, resolveStorageInfo,],)

	function handleRefreshUser (user: string,) {
		if (refreshStatuses[user]) { return }
		onRefreshUser(user,).then(({status,},) => {
			setRefreshStatuses((prev,) => ({...prev, [user]: status,}))
		},).catch(() => {
			setRefreshStatuses((prev,) => ({...prev, [user]: 'deleted',}))
		},)
	}

	/** Applies an archived-state change to a note (by stable index) of a user in local state. */
	function setLocalNoteArchived (
		user: string,
		noteIndex: number,
		archived?: UserNoteEntry['archived'],
	) {
		setUsers((prev,) =>
			prev.map((u,) =>
				u.name === user
					? {
						...u,
						notes: u.notes.map((note,) => note.index === noteIndex ? withArchived(note, archived,) : note),
					}
					: u
			)
		)
	}

	function handleDeleteUser (user: string,) {
		const u = users.find((usr,) => usr.name === user)
		if (!u) { return }
		const ok = confirm(`This will delete all notes for /u/${user}. Would you like to proceed?`,)
		if (!ok) { return }
		onDeleteUser(user,).then(() => {
			setLastAction({
				type: 'deleteUser',
				user,
				notes: u.notes,
			},)
			setUsers((prev,) => prev.filter((u,) => u.name !== user))
			positiveTextFeedback(`Deleted all notes for /u/${user}`,)
		},)
	}

	function handleDeleteNote (user: string, note: UserNoteEntry, notePosition: number,) {
		onDeleteNote(user, note.index ?? notePosition,).then(() => {
			setLastAction({
				type: 'deleteNote',
				user,
				note,
				noteIdx: notePosition,
			},)
			setUsers((prev,) =>
				prev.map((u,) => {
					if (u.name !== user) { return u }
					const next = [...u.notes,]
					next.splice(notePosition, 1,)
					return {...u, notes: next,}
				},).filter((u,) => u.notes.length > 0)
			)
			positiveTextFeedback(`Deleted note for /u/${user}`,)
		},)
	}

	function handleArchiveNote (user: string, noteIndex: number,) {
		if (!onArchiveNote) { return }
		onArchiveNote(user, noteIndex,).then(() => {
			setLocalNoteArchived(user, noteIndex, {by: currentUser, at: nowInSeconds(),},)
			positiveTextFeedback(`Archived note for /u/${user}`,)
		},)
	}

	function handleArchiveAllUser (user: string,) {
		if (!onArchiveAllNotes) { return }
		const u = users.find((usr,) => usr.name === user)
		if (!u) { return }
		const activeCount = u.notes.filter((n,) => isNoteActive(n,)).length
		if (activeCount === 0) { return }
		const ok = confirm(
			`This will archive all ${activeCount} active note${
				activeCount === 1 ? '' : 's'
			} for /u/${user}. Would you like to proceed?`,
		)
		if (!ok) { return }
		onArchiveAllNotes(user,).then(() => {
			const now = nowInSeconds()
			setUsers((prev,) =>
				prev.map((u,) =>
					u.name === user
						? {
							...u,
							notes: u.notes.map((n,) =>
								isNoteActive(n,) ? {...n, archived: {by: currentUser, at: now,},} : n
							),
						}
						: u
				)
			)
			positiveTextFeedback(`Archived all notes for /u/${user}`,)
		},)
	}

	function handleUnarchiveNote (user: string, noteIndex: number,) {
		if (!onUnarchiveNote) { return }
		onUnarchiveNote(user, noteIndex,).then(() => {
			setLocalNoteArchived(user, noteIndex,)
			positiveTextFeedback(`Unarchived note for /u/${user}`,)
		},)
	}

	function handleUndo () {
		if (!lastAction) { return }
		if (lastAction.type === 'deleteUser') {
			onRestoreUser(lastAction.user, lastAction.notes!,).then(() => {
				setUsers((prev,) => {
					const exists = prev.some((u,) => u.name === lastAction.user)
					if (exists) {
						return prev.map((u,) => u.name === lastAction.user ? {...u, notes: lastAction.notes!,} : u)
					} else {
						return [...prev, {name: lastAction.user, notes: lastAction.notes!,},]
					}
				},)
				positiveTextFeedback(`Restored notes for /u/${lastAction.user}`,)
				setLastAction(null,)
			},)
		} else if (lastAction.type === 'deleteNote') {
			onRestoreNote(lastAction.user, lastAction.note!, lastAction.noteIdx!,).then(() => {
				setUsers((prev,) =>
					prev.map((u,) => {
						if (u.name !== lastAction.user) { return u }
						const next = [...u.notes,]
						next.splice(lastAction.noteIdx!, 0, lastAction.note!,)
						return {...u, notes: next,}
					},)
				)
				positiveTextFeedback(`Restored note for /u/${lastAction.user}`,)
				setLastAction(null,)
			},)
		}
	}

	return (
		<FullPageDialog title={`Toolbox Usernotes - /r/${subreddit}`} className={css.window} onClose={onClose}>
			<TabBar
				tabs={[
					{id: 'browse', label: 'Browse notes',},
					{id: 'prune', label: 'Prune notes',},
					{id: 'stats', label: 'Statistics',},
				]}
				activeTab={activeTab}
				onTabChange={(tab,) => setActiveTab(tab as ManagerTab,)}
				actions={
					<button
						type="button"
						className={css.exportTab}
						onClick={() => exportUsernotesCsv(subreddit, users,)}
						title="Export all notes as CSV"
					>
						Export CSV
					</button>
				}
			/>
			<div className={css.body}>
				{activeTab === 'browse' && (
					<div className={css.tabPanel}>
						<div className={css.summary}>
							<div className={css.summaryMain}>
								<div className={css.eyebrow}>Toolbox Usernotes Manager</div>
								<div className={css.summaryTitle}>/r/{subreddit}</div>
							</div>
							<div className={css.statGrid}>
								<span>{statLabel(allStats.userCount, 'user with notes', 'users with notes',)}</span>
								<span>{statLabel(allStats.noteCount, 'note',)}</span>
								<span>{statLabel(visibleStats.userCount, 'visible user',)}</span>
								<span>{statLabel(visibleStats.noteCount, 'visible note',)}</span>
								{allStats.emptyUserCount > 0 && (
									<span>{statLabel(allStats.emptyUserCount, 'empty user',)}</span>
								)}
								<span>Oldest {formatDate(allStats.oldestNoteTime,)}</span>
								<span>Newest {formatDate(allStats.newestNoteTime,)}</span>
							</div>
						</div>

						{allStats.typeCounts.length > 0 && (
							<div className={css.typeChips} aria-label="Note type distribution">
								<button
									type="button"
									className={`${css.typeChip} ${prefs.kind.length === 0 ? css.typeChipActive : ''}`}
									onClick={() => updatePrefs({kind: [],},)}
								>
									All
									<strong>{allStats.noteCount.toLocaleString()}</strong>
								</button>
								{allStats.typeCounts.map((type,) => (
									<button
										key={type.key}
										type="button"
										className={`${css.typeChip} ${
											prefs.kind.includes(type.key,) ? css.typeChipActive : ''
										}`}
										onClick={() =>
											updatePrefs({
												kind: prefs.kind.includes(type.key,)
													? prefs.kind.filter((k,) => k !== type.key)
													: [...prefs.kind, type.key,],
											},)}
									>
										{type.color && <span style={{backgroundColor: type.color,}} />}
										{type.label}
										<strong>{type.count.toLocaleString()}</strong>
									</button>
								))}
							</div>
						)}

						<div className={css.toolbar}>
							<div className={css.toolbarFilters}>
								<label>
									<span>Username</span>
									<TextInput
										type="text"
										placeholder="Search users"
										value={prefs.userText}
										onChange={(event,) => updatePrefs({userText: event.target.value,},)}
									/>
								</label>
								<label>
									<span>Contents</span>
									<TextInput
										type="text"
										placeholder="Search notes"
										value={prefs.contentText}
										onChange={(event,) => updatePrefs({contentText: event.target.value,},)}
									/>
								</label>
								<label>
									<span>Moderator</span>
									<ActionSelect
										value={prefs.moderator}
										onChange={(event,) => updatePrefs({moderator: event.target.value,},)}
									>
										<option value="all">All mods</option>
										{uniqueMods.map((mod,) => (
											<option key={mod} value={mod}>/u/{mod}</option>
										))}
									</ActionSelect>
								</label>
								{archivingAvailable && (
									<div className={css.archivedToggle}>
										<span>Archived</span>
										<ToggleGroup<ArchivedMode>
											ariaLabel="Show archived notes"
											value={prefs.archived ?? 'exclude'}
											onChange={(archived,) => updatePrefs({archived,},)}
											options={[
												{value: 'exclude', label: 'Hide',},
												{value: 'include', label: 'Show',},
												{value: 'only', label: 'Only',},
											]}
										/>
									</div>
								)}
							</div>
							<div className={css.toolbarSort}>
								<label>
									<span>Sort</span>
									<ActionSelect
										value={prefs.sortKey}
										onChange={(event,) =>
											updatePrefs({sortKey: event.target.value as UserNotesManagerSortKey,},)}
									>
										<option value="username">Username</option>
										<option value="date">Date added</option>
										<option value="kind">Note kind</option>
										<option value="noteCount">Note count</option>
										<option value="moderator">Moderator</option>
									</ActionSelect>
								</label>
								<button
									type="button"
									className={css.iconButtonLarge}
									title={prefs.sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'}
									onClick={() =>
										updatePrefs({
											sortDirection: prefs.sortDirection === 'asc' ? 'desc' : 'asc',
										},)}
								>
									<Icon icon={prefs.sortDirection === 'asc' ? 'sortUp' : 'sortDown'} />
								</button>
								<label>
									<span>Users per page</span>
									<ActionSelect
										value={String(prefs.pageSize,)}
										onChange={(event,) =>
											updatePrefs({pageSize: parseInt(event.target.value, 10,),},)}
									>
										{[25, 50, 100, 200,].map((size,) => (
											<option key={size} value={size}>{size} users</option>
										))}
									</ActionSelect>
								</label>
								<ActionButton onClick={() => updatePrefs(defaultPrefs,)}>
									Reset
								</ActionButton>
							</div>
						</div>

						{lastAction && (
							<div className={css.undoBanner}>
								<span>
									{lastAction.type === 'deleteUser'
										? `Deleted all notes for /u/${lastAction.user}`
										: `Deleted note for /u/${lastAction.user}`}
								</span>
								<button
									type="button"
									className={css.undoButton}
									onClick={handleUndo}
								>
									Undo
								</button>
								<button
									type="button"
									className={css.closeUndoButton}
									onClick={() => setLastAction(null,)}
								>
									<Icon icon="close" />
								</button>
							</div>
						)}

						<div className={css.pagerControls}>
							{renderPagerControls(totalPages, safePage, setPage,)}
						</div>

						<div ref={userListRef} className={css.userList}>
							{allStats.noteCount === 0 && (
								<div className={css.emptyState}>No notes found for this subreddit.</div>
							)}
							{allStats.noteCount > 0 && filteredUsers.length === 0 && (
								<div className={css.emptyState}>
									{filtersActive ? 'No notes match the current filters.' : 'No notes to display.'}
								</div>
							)}
							{pageUsers.map((user,) => (
								<div key={user.name} className={css.userEntry} data-user={user.name}>
									<div className={css.userHeader}>
										<div className={css.userTitle}>
											<a href={`/u/${user.name}`}>/u/{user.name}</a>
											<span>{statLabel(user.notes.length, 'visible note',)}</span>
											<span>
												{statLabel(
													user.originalNotes?.length ?? user.notes.length,
													'total note',
												)}
											</span>
											{refreshStatuses[user.name] && (
												<span className={css.modInfo}>
													Account: {refreshStatuses[user.name]}
												</span>
											)}
										</div>
										<div className={css.userActions}>
											<button
												type="button"
												className={css.iconButton}
												title="Check user status"
												onClick={() => handleRefreshUser(user.name,)}
											>
												<Icon icon="refresh" />
											</button>
											{archivingAvailable && (
												<button
													type="button"
													className={css.iconButton}
													title="Archive all notes for user"
													onClick={() => handleArchiveAllUser(user.name,)}
												>
													<Icon icon="archive" />
												</button>
											)}
											<button
												type="button"
												className={css.iconButton}
												title="Delete all notes for user"
												onClick={() => handleDeleteUser(user.name,)}
											>
												<Icon icon="delete" mood="negative" />
											</button>
										</div>
									</div>
									<div className={css.noteList}>
										{user.notes.map((note, noteIndex,) => {
											const originalIndex = user.originalNotes?.indexOf(note,) ?? noteIndex
											const color = findColor(note.type ?? '',)
											const isHidden = note.archived !== undefined
											return (
												<div
													key={note.index ?? noteIndex}
													className={`${css.noteDetails} ${isHidden ? css.noteHidden : ''}`}
												>
													<div className={css.noteActions}>
														{archivingAvailable && !isHidden && note.index !== undefined
															&& (
																<button
																	type="button"
																	className={css.iconButton}
																	title="Archive note"
																	onClick={() =>
																		handleArchiveNote(user.name, note.index!,)}
																>
																	<Icon icon="archive" />
																</button>
															)}
														{note.archived && note.index !== undefined && (
															<button
																type="button"
																className={css.iconButton}
																title="Unarchive note"
																onClick={() =>
																	handleUnarchiveNote(user.name, note.index!,)}
															>
																<Icon icon="unarchive" />
															</button>
														)}
														<button
															type="button"
															className={css.iconButton}
															title="Delete note"
															onClick={() =>
																handleDeleteNote(user.name, note, originalIndex,)}
														>
															<Icon icon="delete" mood="negative" />
														</button>
													</div>
													<span
														className={css.noteType}
														style={color.key !== 'none'
															? noteTypeColorStyle(color,)
															: undefined}
													>
														{getKindLabel(colors, note.type,)}
													</span>
													{note.link
														? (
															<a className={css.noteText} href={note.link}>
																{note.note}
															</a>
														)
														: (
															<span className={css.noteText}>{note.note}</span>
														)}
													<div className={css.noteMeta}>
														{note.messageLink && (
															<a
																className={css.iconButton}
																href={note.messageLink}
																title="view removal message"
																aria-label="View removal message"
																target="_blank"
																rel="noreferrer"
															>
																<Icon icon="modmail" />
															</a>
														)}
														{note.archived && (
															<span className={css.modInfo}>
																archived {formatArchiveAttribution(note.archived.by,)}
															</span>
														)}
														<span className={css.modInfo}>by /u/{note.mod}</span>
														<RelativeTime date={new Date(note.time * 1000,)} />
													</div>
												</div>
											)
										},)}
									</div>
								</div>
							))}
						</div>
					</div>
				)}

				{activeTab === 'prune' && (
					<div className={`${css.tabPanel} ${css.prunePanel}`}>
						<PruneUserNotesPanel users={users} colors={colors} noteStats={allStats} onConfirm={onPrune} />
					</div>
				)}

				{activeTab === 'stats' && (
					<div className={`${css.tabPanel} ${css.statsPanel}`}>
						{hasArchivedNotes && (
							<div className={css.statsViewToggle}>
								<ToggleGroup<'all' | 'active' | 'archived'>
									ariaLabel="Stats view"
									value={statsView}
									onChange={setStatsView}
									options={[
										{value: 'all', label: 'All',},
										{value: 'active', label: 'Active',},
										{value: 'archived', label: 'Archived',},
									]}
								/>
							</div>
						)}
						<div className={css.statsGrid}>
							<div className={css.statCard}>
								<span>Total notes</span>
								<strong>{formatNumber(statistics.totalNotes,)}</strong>
							</div>
							{statistics.archivedNotes > 0 && (
								<>
									<div className={css.statCard}>
										<span>Active notes</span>
										<strong>
											{formatNumber(statistics.activeNotes,)}
											<small>
												{formatPercent(statistics.activeNotes, statistics.totalNotes,)}
											</small>
										</strong>
									</div>
									<div className={css.statCard}>
										<span>Archived notes</span>
										<strong>
											{formatNumber(statistics.archivedNotes,)}
											<small>
												{formatPercent(statistics.archivedNotes, statistics.totalNotes,)}
											</small>
										</strong>
									</div>
								</>
							)}
							<div className={css.statCard}>
								<span>Users with notes</span>
								<strong>{formatNumber(statistics.usersWithNotes,)}</strong>
							</div>
							<div className={css.statCard}>
								<span>Empty users</span>
								<strong>{formatNumber(statistics.emptyUsers,)}</strong>
							</div>
							<div className={css.statCard}>
								<span>Average notes/user</span>
								<strong>{formatNumber(statistics.averageNotesPerUser, 2,)}</strong>
							</div>
							<div className={css.statCard}>
								<span>Most notes on one user</span>
								<strong>{formatNumber(statistics.maxNotesOnUser,)}</strong>
							</div>
							<div className={css.statCard}>
								<span>Moderators represented</span>
								<strong>{formatNumber(statistics.uniqueModerators,)}</strong>
							</div>
							<div className={css.statCard}>
								<span>Oldest note</span>
								<strong>{formatDate(statistics.oldestNoteTime,)}</strong>
							</div>
							<div className={css.statCard}>
								<span>Newest note</span>
								<strong>{formatDate(statistics.newestNoteTime,)}</strong>
							</div>
							<div className={css.statCard}>
								<span>Notes with links</span>
								<strong>
									{formatNumber(statistics.notesWithLinks,)}
									<small>
										{formatPercent(statistics.notesWithLinks, statistics.totalNotes,)}
									</small>
								</strong>
							</div>
							<div className={css.statCard}>
								<span>Notes without type</span>
								<strong>
									{formatNumber(statistics.notesWithoutTypes,)}
									<small>
										{formatPercent(statistics.notesWithoutTypes, statistics.totalNotes,)}
									</small>
								</strong>
							</div>
							<div className={css.statCard}>
								<span>Average note length</span>
								<strong>{formatNumber(statistics.averageNoteLength, 1,)}</strong>
							</div>
							<div className={css.statCard}>
								<span>Longest note length</span>
								<strong>{formatNumber(statistics.longestNoteLength,)}</strong>
							</div>
							{storageInfo?.mode === 'sharded'
								? (
									<>
										<div className={css.statCard}>
											<span>Wiki storage</span>
											<strong>
												{formatBytes(storageInfo.totalBytes,)}
												<small>
													{storageInfo.shardCount}{' '}
													{storageInfo.shardCount === 1 ? 'page' : 'pages'}
												</small>
											</strong>
										</div>
										<div className={css.statCard}>
											<span>Largest page (splits automatically)</span>
											<strong>
												{formatBytes(storageInfo.largestShardBytes,)}
												<small>
													{formatPercent(
														storageInfo.largestShardBytes,
														SHARD_SOFT_LIMIT_BYTES,
													)}
												</small>
											</strong>
										</div>
										{storageInfo.legacyCompatBytes != null && (
											<div className={css.statCard}>
												<span>6.x wiki storage</span>
												<strong>
													{formatBytes(storageInfo.legacyCompatBytes,)}
													<small>
														{formatPercent(
															storageInfo.legacyCompatBytes,
															usernotesWikiMaxBytes,
														)}
													</small>
												</strong>
											</div>
										)}
									</>
								)
								: (
									<>
										<div className={css.statCard}>
											<span>
												{storageInfo == null
													? (storageLoading
														? 'Estimated wiki storage (loading actual...)'
														: 'Estimated wiki storage')
													: 'Raw wiki storage'}
											</span>
											<strong>
												{formatBytes(storageBytesUsed,)}
												<small>
													{formatPercent(storageBytesUsed, usernotesWikiMaxBytes,)}
												</small>
											</strong>
										</div>
										{statsView !== 'archived' && (
											<div className={css.statCard}>
												<span>Storage remaining</span>
												<strong>{formatBytes(storageBytesRemaining,)}</strong>
											</div>
										)}
									</>
								)}
						</div>

						<div className={css.statsColumns}>
							<section className={css.statsSection}>
								<div className={css.sectionTitle}>Note kinds</div>
								{statistics.typeCounts.map((type,) => (
									<div key={type.key} className={css.statBarRow}>
										<span>{type.label}</span>
										<div>
											<i style={{width: formatPercent(type.count, statistics.totalNotes,),}} />
										</div>
										<strong>{formatNumber(type.count,)}</strong>
									</div>
								))}
							</section>

							<section className={css.statsSection}>
								<div className={css.sectionTitle}>Note age</div>
								{statistics.ageBuckets.map((bucket,) => (
									<div key={bucket.label} className={css.statBarRow}>
										<span>{bucket.label}</span>
										<div>
											<i
												style={{
													width: formatPercent(bucket.count, statistics.totalNotes,),
												}}
											/>
										</div>
										<strong>{formatNumber(bucket.count,)}</strong>
									</div>
								))}
							</section>

							<section className={css.statsSection}>
								<div className={css.sectionTitle}>Top users by note count</div>
								{statistics.topUsers.map((user,) => (
									<div key={user.name} className={css.statListRow}>
										<a href={`/u/${user.name}`}>/u/{user.name}</a>
										<span>{formatNumber(user.count,)} notes</span>
									</div>
								))}
							</section>

							<section className={css.statsSection}>
								<div className={css.sectionTitle}>Top note authors</div>
								{statistics.moderatorCounts.map((mod,) => (
									<div key={mod.name} className={css.statListRow}>
										<span>/u/{mod.name}</span>
										<span>{formatNumber(mod.count,)} notes</span>
									</div>
								))}
							</section>
						</div>
					</div>
				)}
			</div>
		</FullPageDialog>
	)
}

/**
 * Mounts the UserNotesManagerOverlay as a managed popup and returns a cleanup function.
 * @param props Overlay props; `onClose` is supplied by the popup manager.
 */
export function showUserNotesManagerOverlay (props: Omit<UserNotesManagerOverlayProps, 'onClose'>,) {
	return mountPopup((onClose,) => <UserNotesManagerOverlay {...props} onClose={onClose} />)
}
