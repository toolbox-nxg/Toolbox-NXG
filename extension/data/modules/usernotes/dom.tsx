/** DOM rendering and event handlers for the Usernotes module: note tags, the add-note popup, and the manager overlay. */

import {useEffect, useState,} from 'react'

import {getCurrentUser,} from '../../api/resources/me'
import {isModSub,} from '../../api/resources/modSubs'
import {getModeratorListResult,} from '../../api/resources/relationships'
import type {RedditThing, ThingModData,} from '../../api/resources/things'
import {aboutUser, getUserActivity,} from '../../api/resources/users'
import {readFromWiki,} from '../../api/resources/wiki'
// eslint-disable-next-line no-restricted-imports -- getRatelimit is a read-only rate-limit status helper with no resource-level wrapper
import {getRatelimit,} from '../../api/transport/http'
import {renderAtLocation, type UILocationContext,} from '../../dom/uiLocations'
import {createLifecycle,} from '../../framework/lifecycle'
import {reactAlert,} from '../../shared/controls/ReactAlert'
import {addContextItem, removeContextItem,} from '../../store/contextMenu'
import {negativeTextFeedback, neutralTextFeedback, positiveTextFeedback,} from '../../store/feedback'
import store from '../../store/index'
import {startSpinner, stopSpinner,} from '../../store/spinnerSlice'
import {debounce,} from '../../util/data/async'
import {byteLength,} from '../../util/data/encoding'
import {forEachChunked,} from '../../util/data/iter'
import {nowInSeconds,} from '../../util/data/time'
import createLogger from '../../util/infra/logging'
import type {TBPageContext,} from '../../util/reddit/pageContext'
import {isEditUserPage,} from '../../util/reddit/pageContext'
import {isUserProfileSubreddit,} from '../../util/reddit/profileSubreddit'
import {getApiThingInfo,} from '../../util/reddit/thingInfo'
import {drawPosition,} from '../../util/ui/drawPosition'
import {navigateToSubredditPage, reloadPage,} from '../../util/ui/navigation'
import {
	ExistingNote,
	isNoteActive,
	notesMaxSchema,
	notesMinSchema,
	notesSchema,
	PruneOptions,
	PruneProgress,
	UserNoteEntry,
	UserNotesData,
} from '../../util/wiki/schemas/usernotes/schema'
import {getSessionStorageInfo,} from '../../util/wiki/schemas/usernotes/sharded'
import {OLD_WIKI_PATHS,} from '../../util/wiki/wikiConstants'
import {resolveWikiLayout,} from '../../util/wiki/wikiPaths'
import {getConfig,} from '../config/moduleapi'
import {proposeOrBan,} from '../shared/proposals/gateway'
import {getMessageLink,} from '../shared/usernotes/messageLinkCache'
import {
	createLatestModNoteFetcher,
	findSubredditColor,
	getSubredditColors,
	getUser,
	getUserNotes,
	updateUserNotes,
} from '../shared/usernotes/moduleapi'
import {applyUserNoteMutation, makeUserNoteEntry, type UserNoteMutation,} from '../shared/usernotes/noteMutations'
import {subUsernoteRequireFromConfig,} from '../shared/usernotes/requireRules'
import {getSubredditNotes, publishSubredditNotes,} from '../shared/usernotes/store'
import {showAddUserNotePopup,} from './components/AddUserNotePopup'
import {CombinedNoteTag,} from './components/CombinedNoteTag'
import {showUserNotesManagerOverlay,} from './components/UserNotesManagerOverlay'
import {
	createPrunePreview,
	shouldPruneNoteByArchived,
	type UsernotesStorageInfo,
} from './components/UserNotesManagerOverlay.helpers'
import {UserNotesSettings,} from './settings'

const log = createLogger('UserNotes',)

/** Handlers returned by {@link createNotesDisplay} for wiring up the notes-display lifecycle. */
export interface NotesDisplayHandlers {
	/** Disposes the note-tag renderer registered by this factory. Pass to `lifecycle.mount` in `index.ts`. */
	cleanup: () => Promise<void>
	/** Debounced handler to re-process all known subreddits when new things appear on the page. */
	handleNewThings: () => void
	/**
	 * Opens the add-note popup for a user in a subreddit.
	 * @param link Permalink of the linked thing (empty string if none).
	 * @param disableLink When true, the "Include link" option is disabled.
	 * @param contextID Reddit fullname of the thing being linked to the note.
	 * @param initialTabIndex Tab to open by default (0 = Toolbox, 1 = Native).
	 */
	openNotesPopup: (
		subreddit: string,
		user: string,
		link: string,
		disableLink: boolean,
		initialPosition: {top: number; left: number},
		contextID?: string,
		initialTabIndex?: number,
	) => Promise<void>
}

/**
 * Creates the note-tag rendering and popup-opening handlers for the Usernotes module.
 * Registers note tags at the `authorActions` UI location.
 */
export function createNotesDisplay (
	{maxChars, showDate, showOnModPages, defaultNotesTab,}: UserNotesSettings,
): NotesDisplayHandlers {
	const lifecycle = createLifecycle()
	const getLatestModNote = createLatestModNoteFetcher()
	const defaultTabIndex = (defaultNotesTab as string) === 'native_notes' ? 1 : 0
	const subs: string[] = []
	const pendingSubs = new Set<string>()
	let queueTimeout: ReturnType<typeof setTimeout> | undefined
	// Clear any pending debounce timer on teardown so it can't fire (and process
	// subs / touch the DOM) after the module has been cleaned up. Registered once,
	// not per debounce, so the cleanup list doesn't grow with each schedule.
	lifecycle.mount(() => clearTimeout(queueTimeout,))

	function foundSubreddit (subreddit: string,) {
		if (!subs.includes(subreddit,)) { subs.push(subreddit,) }
	}

	function queueProcessSub (subreddit: string,) {
		clearTimeout(queueTimeout,)
		pendingSubs.add(subreddit,)
		queueTimeout = setTimeout(() => {
			for (const subreddit of pendingSubs) { void processSub(subreddit,) }
			pendingSubs.clear()
		}, 100,)
	}

	async function processSub (subreddit: string,) {
		if (!subreddit) {
			log.warn('Tried to process falsy subreddit, ignoring:', subreddit,)
			return
		}
		if (isUserProfileSubreddit(subreddit,)) { return }

		let notes: UserNotesData
		try {
			notes = await getUserNotes(subreddit,)
		} catch (error) {
			log.warn(`Error reading usernotes for subreddit ${subreddit}:`, error,)
			return
		}

		if (notes.ver < notesMinSchema || notes.ver > notesMaxSchema) {
			publishSubredditNotes(subreddit, {notes, colors: [], error: true,},)
			const message = notes.ver > notesMaxSchema
				? `You are using a version of Toolbox-NXG that cannot read a newer usernote data format in: /r/${subreddit}. Please update your extension.`
				: `You are using a version of Toolbox-NXG that cannot read an old usernote data format in: /r/${subreddit}, schema v${notes.ver}. Message /r/toolbox_nxg for assistance.`
			reactAlert({message,},).then((clicked,) => {
				if (clicked) {
					window.open(
						notes.ver > notesMaxSchema
							? '/r/toolbox_nxg/wiki/get'
							: `/message/compose?to=%2Fr%2Ftoolbox_nxg&subject=Outdated%20usernotes&message=%2Fr%2F${subreddit}%20is%20using%20usernotes%20schema%20v${notes.ver}`,
					)
				}
			},).catch((error: unknown,) => log.error(error,))
			return
		}

		getSubredditColors(subreddit,).then((colors,) => publishSubredditNotes(subreddit, {notes, colors,},)).catch((
			error: unknown,
		) => log.error(error,))
	}

	function NoteTagRenderer ({
		context,
		target,
		renderTag,
	}: {
		context: UILocationContext
		target: Element
		renderTag: (handler: React.MouseEventHandler<HTMLButtonElement>,) => React.ReactNode
	},) {
		const {author, subreddit, thingId, rawDetail,} = context
		const [isMod, setIsMod,] = useState<boolean | null>(null,)

		useEffect(() => {
			target.classList.add('ut-thing',)
			if (subreddit) { target.setAttribute('data-subreddit', subreddit,) }
			if (author) { target.setAttribute('data-author', author,) }
		}, [target, subreddit, author,],)

		useEffect(() => {
			if (!subreddit) { return }
			let alive = true
			isModSub(subreddit,).then((mod,) => {
				if (!alive) { return }
				setIsMod(mod,)
				if (mod) {
					foundSubreddit(subreddit,)
					queueProcessSub(subreddit,)
				}
			},).catch((error: unknown,) => log.error(error,))
			return () => {
				alive = false
			}
		}, [subreddit,],)

		if (!isMod || !author || !subreddit) { return null }

		return renderTag((event,) =>
			void (async () => {
				event.preventDefault()
				event.stopPropagation()
				let link = ''
				let disableLink = false
				const conversationId = (rawDetail as {conversationId?: string} | undefined)?.conversationId
				if (conversationId) {
					const shortId = conversationId.replace('ModmailConversation_', '',)
					if (shortId) { link = `https://www.reddit.com/mail/perma/${shortId}` }
				} else if (thingId) {
					const info = await getApiThingInfo(subreddit, thingId, true,) as {permalink: string}
					link = info.permalink
				} else {
					disableLink = true
				}
				const positions = drawPosition(event.nativeEvent,)
				await openAddNotePopup(
					subreddit,
					author,
					link,
					disableLink,
					{
						top: positions.topPosition,
						left: positions.leftPosition,
					},
					undefined,
					defaultTabIndex,
				)
			})()
		)
	}

	renderAtLocation('authorActions', {id: 'usernotes.tag', order: 10, lifecycle,}, ({context, target,},) => {
		if (isEditUserPage && !showOnModPages) { return null }
		if (!context.author || !context.subreddit) { return null }
		return (
			<NoteTagRenderer
				context={context}
				target={target}
				renderTag={(handler,) => (
					<CombinedNoteTag
						subreddit={context.subreddit!}
						author={context.author!}
						defaultText="N"
						maxChars={maxChars}
						showDate={showDate}
						getLatestModNote={getLatestModNote}
						onClick={handler}
					/>
				)}
			/>
		)
	},)

	async function applyNoteChange (
		subreddit: string,
		user: string,
		mutation: UserNoteMutation,
	) {
		const feedbackAction = {
			add: 'Adding',
			delete: 'Removing',
			edit: 'Updating',
			archive: 'Archiving',
			unarchive: 'Unarchiving',
		}[mutation.change]
		neutralTextFeedback(`${feedbackAction} usernote...`,)

		// Read-merge-write inside the save queue: the mutation is applied to the
		// live wiki state, not a snapshot this page may have loaded before another
		// mod added a note, so concurrent additions are never clobbered.
		const notes = await updateUserNotes(subreddit, (fresh,) => applyUserNoteMutation(fresh, user, mutation,),)
			.catch((err,) => {
				log.warn('Failed to save usernotes:', err,)
				return undefined
			},)

		if (notes?.corrupted) {
			negativeTextFeedback(
				'Toolbox-NXG found an issue with your usernotes while they were being saved. One or more of your notes appear to be written in the wrong format; to prevent further issues these have been deleted. All is well now.',
				{duration: 8000,},
			)
		}

		if (notes) {
			await forEachChunked(subs, 10, 200, (subreddit,) => processSub(subreddit,),)
		}
		return notes
	}

	async function openAddNotePopup (
		subreddit: string,
		user: string,
		link: string,
		disableLink: boolean,
		initialPosition: {top: number; left: number},
		contextID?: string,
		initialTabIndex?: number,
	) {
		const [colors, modListResult, layout, currentUser, config,] = await Promise.all([
			getSubredditColors(subreddit,),
			getModeratorListResult(subreddit, user, '',).catch(() => ({
				targetIsMod: false,
				currentUserPermissions: [],
			})),
			resolveWikiLayout(subreddit,),
			getCurrentUser().catch(() => ''),
			getConfig(subreddit,).catch(() => undefined),
		],)
		const targetIsMod = modListResult.targetIsMod
		// Archive/soft-delete need NXG storage; the legacy v6 page can't carry
		// tombstones, so legacy-fallback subs keep plain hard deletes.
		const archivingAvailable = layout.state !== 'legacyFallback' && !layout.nxgMissing
		const toExistingNotes = (notesData: UserNotesData,): ExistingNote[] =>
			(getUser(notesData.users, user,)?.notes ?? []).map((n, position,) => ({
				id: n.index ?? position,
				type: n.type ?? '',
				note: n.note,
				mod: n.mod,
				time: n.time,
				...(n.link !== undefined && {link: n.link,}),
				...(n.messageLink !== undefined && {messageLink: n.messageLink,}),
				...(n.archived !== undefined && {archived: n.archived,}),
			}))
		const initialNotes = toExistingNotes(getSubredditNotes(subreddit,)?.notes ?? {ver: notesSchema, users: {},},)
		// If a removal earlier this page session sent a modmail for the linked
		// thing, offer to attach that conversation to the note as well.
		const availableMessageLink = link ? getMessageLink(link,) : undefined

		showAddUserNotePopup({
			subreddit,
			user,
			disableLink,
			messageLink: availableMessageLink,
			initialPosition,
			colors,
			initialNotes,
			findColor: (key: string,) => findSubredditColor(colors, key,),
			contextID,
			initialTabIndex,
			targetIsMod,
			archivingAvailable,
			currentUser,
			subRequire: subUsernoteRequireFromConfig(config,),
			onRefreshNotes: async () => {
				const notesData = await getUserNotes(subreddit, true,)
				publishSubredditNotes(subreddit, {notes: notesData, colors,},)
				return toExistingNotes(notesData,)
			},
			onSave: async ({note, type, includeLink, includeMessageLink, triggerBan, banMessage,},) => {
				if (!user || !subreddit) { return }
				const time = nowInSeconds()
				const mod = await getCurrentUser()
				const messageLink = includeMessageLink ? availableMessageLink : undefined
				const newNote = makeUserNoteEntry({
					note,
					time,
					mod,
					link: includeLink ? link : '',
					...(type !== undefined && {type,}),
					...(messageLink !== undefined && {messageLink,}),
				},)
				const savedData = await applyNoteChange(subreddit, user, {change: 'add', note: newNote,},)
				if (triggerBan && type !== undefined) {
					const color = colors.find((c,) => c.key === type)
					if (color?.banDuration !== undefined) {
						await proposeOrBan(
							{subreddit, itemId: user, itemKind: 'user', link: `https://www.reddit.com/user/${user}`,},
							{
								// banDuration 0 means a permanent ban.
								permanent: !color.banDuration,
								days: color.banDuration,
								note: note.trim(),
								message: banMessage,
								...(includeLink && link ? {context: link,} : {}),
							},
						)
					}
				}
				// Surface the note's assigned stable index as its popup id. Match on
				// type too: notes can now be saved with empty text (type only), so
				// `note` alone no longer disambiguates two notes added in the same second.
				const savedNote = savedData && getUser(savedData.users, user,)?.notes
					.find((n,) =>
						n.time === time && n.mod === mod && n.note === note.trim() && (n.type ?? '') === (type ?? '')
					)
				return {
					id: savedNote?.index ?? 0,
					type: type ?? '',
					note: note.trim(),
					mod,
					time,
					link: includeLink ? link : '',
					...(messageLink !== undefined && {messageLink,}),
				} satisfies ExistingNote
			},
			onEditNote: async (noteId, data,) => {
				await applyNoteChange(subreddit, user, {
					change: 'edit',
					index: noteId,
					note: {note: data.note.trim(), type: data.type,},
				},)
			},
			onRemoveNote: async (noteId: number,) => {
				await applyNoteChange(subreddit, user, {change: 'delete', index: noteId,},)
			},
			onArchiveNote: async (noteId: number,) => {
				await applyNoteChange(subreddit, user, {change: 'archive', index: noteId, by: currentUser,},)
			},
			onUnarchiveNote: async (noteId: number,) => {
				await applyNoteChange(subreddit, user, {change: 'unarchive', index: noteId,},)
			},
		},)
	}

	return {
		cleanup: lifecycle.cleanup,
		handleNewThings: debounce(
			() => forEachChunked(subs, 10, 200, (subreddit,) => processSub(subreddit,),),
			500,
		),

		openNotesPopup: openAddNotePopup,
	}
}

/** Handlers returned by {@link createNotesManager} for the modbox manage-usernotes links. */
export interface NotesManagerHandlers {
	/** Adds or removes modbox context items when the page subreddit changes. */
	handleNewPage: (event: CustomEvent<TBPageContext>,) => Promise<void>
	/** Opens the manager for the subreddit passed via the event's `detail.subreddit` field. */
	handleOpenManagerEvent: (event: Event,) => void
	/** Opens the manager for the subreddit stored in the clicked element's `data-subreddit` attribute. */
	handleManagerClick: (element: Element,) => Promise<void>
	/** Loads usernotes and opens the manager overlay for the given subreddit. */
	openManagerForSubreddit: (subreddit: string,) => Promise<void>
	/** Navigates to the subreddit's ban management page. */
	handleBansLinkClick: (element: Element,) => void
	/** Navigates to the subreddit's mute management page. */
	handleMutesLinkClick: (element: Element,) => void
	/** Navigates to the subreddit's flair management page. */
	handleFlairLinkClick: (element: Element,) => void
}

/**
 * Creates the manager-link and overlay-open handlers for the Usernotes module.
 * @param unManagerLink Whether to show the "manage usernotes" link in the modbox context menu.
 */
export function createNotesManager ({unManagerLink,}: UserNotesSettings,): NotesManagerHandlers {
	async function openManagerForSubreddit (subreddit: string,) {
		store.dispatch(startSpinner(),)
		neutralTextFeedback('Loading usernotes',)

		let notes: UserNotesData
		try {
			notes = await getUserNotes(subreddit,)
			if (!Object.keys(notes.users,).length) { throw new Error('No users found',) }
		} catch (_) {
			store.dispatch(stopSpinner(),)
			negativeTextFeedback('No notes found',)
			return
		}

		const [colors, layout, currentUser,] = await Promise.all([
			getSubredditColors(subreddit,),
			resolveWikiLayout(subreddit,),
			getCurrentUser().catch(() => ''),
		],)
		// Archive/soft-delete need NXG storage; the legacy v6 page can't carry
		// tombstones, so legacy-fallback subs keep plain hard deletes.
		const archivingAvailable = layout.state !== 'legacyFallback' && !layout.nxgMissing
		// Layout-aware storage stats, resolved lazily by the overlay only when
		// the Statistics tab is opened (it can hit the network): legacy-fallback
		// subs are bound by the legacy page's 1MB allowance (report its raw
		// size), while NXG subs use the sharded layout's session stats plus,
		// when compatibility writes are on, the 6.x mirror page's size.
		const resolveStorageInfo = async (): Promise<UsernotesStorageInfo | undefined> => {
			if (layout.state === 'legacyFallback') {
				const rawUsernotes = await readFromWiki(subreddit, OLD_WIKI_PATHS.usernotes, false,)
				return rawUsernotes.ok ? {mode: 'legacy', totalBytes: byteLength(rawUsernotes.data,),} : undefined
			}
			const shardedInfo = getSessionStorageInfo(subreddit,)
			if (!shardedInfo) { return undefined }
			let legacyCompatBytes: number | undefined
			if (layout.compatibilityWrites) {
				const rawLegacy = await readFromWiki(subreddit, OLD_WIKI_PATHS.usernotes, false,)
				if (rawLegacy.ok) { legacyCompatBytes = byteLength(rawLegacy.data,) }
			}
			return {mode: 'sharded', ...shardedInfo, ...(legacyCompatBytes !== undefined && {legacyCompatBytes,}),}
		}
		const subUsernotes = notes

		// Adopts the merged dataset returned by a queued write into the manager's
		// working copy, so this long-lived overlay's later operations (and the
		// prune scan) act on state that includes notes other mods saved while it
		// was open, instead of the snapshot loaded when it first opened.
		const adoptMerged = (merged: UserNotesData | undefined,) => {
			if (!merged) { return }
			subUsernotes.users = merged.users
			if (merged.types !== undefined) { subUsernotes.types = merged.types }
			subUsernotes.ver = merged.ver
		}

		const usersList = Object.values(subUsernotes.users,).map((u,) => ({
			name: u.name,
			notes: u.notes,
		}))

		showUserNotesManagerOverlay({
			subreddit,
			users: usersList,
			colors,
			resolveStorageInfo,
			findColor: (key: string,) => findSubredditColor(colors, key,),
			onRefreshUser: async (user: string,) => {
				try {
					await aboutUser(user,)
					return {status: 'active' as const,}
				} catch (_) {
					return {status: 'deleted' as const,}
				}
			},
			archivingAvailable,
			currentUser,
			onDeleteUser: async (user: string,) => {
				adoptMerged(
					await updateUserNotes(subreddit, (fresh,) => {
						if (!fresh.users[user]) { return undefined }
						delete fresh.users[user]
						return `deleted all notes for /u/${user}`
					},).catch(() => undefined),
				)
			},
			onDeleteNote: async (user: string, noteIndex: number,) => {
				// Delete is index-addressed, so it applies cleanly to the live
				// dataset. An emptied user keeps their record so `nextIndex`
				// survives and the deleted index is never reissued.
				adoptMerged(
					await updateUserNotes(
						subreddit,
						(fresh,) =>
							applyUserNoteMutation(fresh, user, {change: 'delete', index: noteIndex,},)
							&& `deleted note ${noteIndex} for /u/${user}`,
					).catch(() => undefined),
				)
			},
			onRestoreUser: async (user: string, notes: UserNoteEntry[],) => {
				adoptMerged(
					await updateUserNotes(subreddit, (fresh,) => {
						// Carry over a retained record's `nextIndex` - the restored
						// notes may not include the highest index ever issued.
						const existingNextIndex = fresh.users[user]?.nextIndex
						fresh.users[user] = {
							name: user,
							notes,
							...(existingNextIndex !== undefined ? {nextIndex: existingNextIndex,} : {}),
						}
						return `restored all notes for /u/${user}`
					},).catch(() => undefined),
				)
			},
			onRestoreNote: async (user: string, note: UserNoteEntry, position: number,) => {
				adoptMerged(
					await updateUserNotes(subreddit, (fresh,) => {
						if (!fresh.users[user]) { fresh.users[user] = {name: user, notes: [],} }
						fresh.users[user].notes.splice(position, 0, note,)
						return `restored a note for /u/${user}`
					},).catch(() => undefined),
				)
			},
			onArchiveNote: async (user: string, noteIndex: number,) => {
				adoptMerged(
					await updateUserNotes(
						subreddit,
						(fresh,) =>
							applyUserNoteMutation(fresh, user, {change: 'archive', index: noteIndex, by: currentUser,},)
							&& `archived note ${noteIndex} for /u/${user}`,
					).catch(() => undefined),
				)
			},
			onArchiveAllNotes: async (user: string,) => {
				adoptMerged(
					await updateUserNotes(subreddit, (fresh,) => {
						const userRecord = fresh.users[user]
						if (!userRecord) { return undefined }
						const now = nowInSeconds()
						let changed = false
						for (const note of userRecord.notes) {
							if (isNoteActive(note,)) {
								note.archived = {by: currentUser, at: now,}
								changed = true
							}
						}
						return changed ? `archived all notes for /u/${user}` : undefined
					},).catch(() => undefined),
				)
			},
			onUnarchiveNote: async (user: string, noteIndex: number,) => {
				adoptMerged(
					await updateUserNotes(
						subreddit,
						(fresh,) =>
							applyUserNoteMutation(fresh, user, {change: 'unarchive', index: noteIndex,},)
							&& `unarchived note ${noteIndex} for /u/${user}`,
					).catch(() => undefined),
				)
			},
			onPrune: async (options: PruneOptions, onProgress?: (progress: PruneProgress,) => void,) => {
				onProgress?.({stage: 'preparing', message: 'Preparing prune preview...',},)
				const preview = createPrunePreview(subUsernotes.users, options, colors,)
				const totalNotes = preview.totalNotes
				const totalUsers = preview.totalUsers
				// Single source of truth for "what gets pruned": seeded with the
				// age/type/archived matches from the preview, then extended with
				// account-status matches below. Both apply paths read from it.
				const matched = preview.matched
				/** Adds a note's stable index to the match set for a user. */
				const addMatch = (user: string, index: number,) => {
					const indexes = matched.get(user,) ?? matched.set(user, new Set(),).get(user,)!
					indexes.add(index,)
				}
				const pruneReasons: string[] = []

				if (options.pruneByNoteAge) {
					const limit = options.pruneByNoteAgeLimit
					const ageThreshold = Date.now() - limit
					pruneReasons.push(`notes before ${new Date(ageThreshold,).toISOString()}`,)
					if (
						options.pruneNoteTypeMode && options.pruneNoteTypeMode !== 'all'
						&& options.pruneNoteTypes?.length
					) {
						pruneReasons.push(
							`${options.pruneNoteTypeMode} note kinds: ${options.pruneNoteTypes.join(', ',)}`,
						)
					}
				}

				if (options.pruneByUserDeleted || options.pruneByUserSuspended || options.pruneByUserInactivity) {
					const dateThreshold = Date.now() - options.pruneByUserInactivityLimit
					if (options.pruneByUserInactivity) {
						pruneReasons.push(`users inactive since ${new Date(dateThreshold,).toISOString()}`,)
					}
					if (options.pruneByUserDeleted) { pruneReasons.push('deleted users',) }
					if (options.pruneByUserSuspended) { pruneReasons.push('suspended users',) }

					store.dispatch(startSpinner(),)
					neutralTextFeedback('Checking user activity, this could take a bit',)

					const userEntries = Object.entries(subUsernotes.users,)
					onProgress?.({
						stage: 'checkingUsers',
						checkedUsers: 0,
						totalUsers: userEntries.length,
						message: 'Checking user account status...',
					},)

					try {
						let rateLimitInfo = await getRatelimit().catch(() => null)

						for (let i = 0; i < userEntries.length; i++) {
							const [username, user,] = userEntries[i]!
							onProgress?.({
								stage: 'checkingUsers',
								checkedUsers: i,
								totalUsers: userEntries.length,
								currentUser: username,
								message: 'Checking user account status...',
							},)

							if (rateLimitInfo) {
								const remaining = parseInt(rateLimitInfo.ratelimitRemaining, 10,)
								const reset = parseInt(rateLimitInfo.ratelimitReset, 10,)
								if (remaining < 5 && reset > 0) {
									neutralTextFeedback(`Nearing API rate limit. Pausing for ${reset} seconds...`,)
									onProgress?.({
										stage: 'rateLimited',
										checkedUsers: i,
										totalUsers: userEntries.length,
										currentUser: username,
										message: `Nearing API rate limit. Pausing for ${reset} seconds...`,
									},)
									await new Promise((resolve,) => setTimeout(resolve, (reset + 1) * 1000,))
								}
							}

							let accountDeleted = false
							let accountSuspended = false
							let accountInactive = false
							await getUserActivity(username, {sort: 'new',},).then((response,) => {
								const data = response.data as {children: RedditThing<ThingModData>[]}
								accountInactive = !data.children.some((thing,) =>
									thing.data.created_utc * 1000 > dateThreshold
								)
							},).catch((error: unknown,) => {
								const status = error instanceof Object && 'response' in error
									? (error as {response?: {status?: number}}).response?.status
									: undefined
								if (status === undefined) { return }
								if (status === 404) {
									accountDeleted = true
									// A deleted account has no activity, so it also qualifies for inactivity pruning.
									accountInactive = true
								} else if (status === 403) { accountSuspended = true }
							},)
							if (
								options.pruneByUserDeleted && accountDeleted
								|| options.pruneByUserSuspended && accountSuspended
								|| options.pruneByUserInactivity && accountInactive
							) {
								// Account matched: add its archived-eligible notes to the match set.
								for (const note of user.notes) {
									if (note.index !== undefined && shouldPruneNoteByArchived(note, options,)) {
										addMatch(username, note.index,)
									}
								}
							}

							onProgress?.({
								stage: 'checkingUsers',
								checkedUsers: i + 1,
								totalUsers: userEntries.length,
								currentUser: username,
								message: 'Checking user account status...',
							},)

							rateLimitInfo = await getRatelimit().catch(() => null)

							await new Promise((resolve,) => setTimeout(resolve, 200,))
						}
					} finally {
						store.dispatch(stopSpinner(),)
					}
				}

				// Derive the counts from the final match set, scoped to what the
				// chosen action actually changes. Archive only touches currently
				// active notes (already-archived matches are no-ops) and never
				// empties a user, so its count and wording differ from delete/purge.
				const isArchive = options.pruneAction === 'archive'
				let affectedNotes = 0
				let emptiedUsers = 0
				for (const [username, user,] of Object.entries(subUsernotes.users,)) {
					const indexes = matched.get(username,)
					if (!indexes || indexes.size === 0) { continue }
					const changedCount = user.notes.filter((note,) =>
						note.index !== undefined && indexes.has(note.index,) && (!isArchive || isNoteActive(note,))
					).length
					affectedNotes += changedCount
					// Only delete/purge can leave a user with no notes; archive keeps them.
					if (!isArchive && changedCount === user.notes.length) {
						emptiedUsers += 1
					}
				}

				if (affectedNotes === 0) {
					positiveTextFeedback('No usernotes matched the selected prune rules',)
					onProgress?.({stage: 'complete', message: 'No usernotes matched the selected prune rules.',},)
					return
				}
				onProgress?.({
					stage: 'confirming',
					message: 'Waiting for confirmation...',
				},)
				const ok = confirm(
					isArchive
						? `${affectedNotes} of ${totalNotes} notes will be archived. Proceed?`
						: `${affectedNotes} of ${totalNotes} notes will be pruned. ${emptiedUsers} of ${totalUsers} users will no longer have any notes. Proceed?`,
				)
				if (!ok) {
					onProgress?.({stage: 'complete', message: 'Prune canceled.',},)
					return
				}
				onProgress?.({stage: 'saving', message: 'Saving pruned usernotes...',},)
				// Apply the prune to the live dataset inside the save queue. The
				// match set is keyed by stable note index, so notes another mod
				// added since this overlay opened simply aren't in it and survive.
				adoptMerged(
					await updateUserNotes(subreddit, (fresh,) => {
						if (options.pruneAction === 'archive') {
							// Archive matched notes in place instead of deleting them.
							for (const [username, user,] of Object.entries(fresh.users,)) {
								const indexes = matched.get(username,)
								if (!indexes) { continue }
								for (const note of user.notes) {
									if (note.index !== undefined && indexes.has(note.index,) && isNoteActive(note,)) {
										note.archived = {by: currentUser, at: nowInSeconds(),}
									}
								}
							}
						} else {
							// Remove matched notes. Purge always drops empty user records;
							// delete on legacy v6 storage also drops them (no nextIndex to
							// preserve), while NXG delete retains them so indexes are never reused.
							for (const [username, user,] of Object.entries(fresh.users,)) {
								const indexes = matched.get(username,)
								if (!indexes || indexes.size === 0) { continue }
								user.notes = user.notes.filter((note,) =>
									note.index === undefined || !indexes.has(note.index,)
								)
							}
							if (options.pruneAction === 'purge' || layout.state === 'legacyFallback') {
								for (const username of Object.keys(fresh.users,)) {
									if (fresh.users[username]!.notes.length === 0) {
										delete fresh.users[username]
									}
								}
							}
						}
						return `prune: ${pruneReasons.join(', ',)}`
					},).catch(() => undefined),
				)
				onProgress?.({stage: 'complete', message: 'Prune complete.',},)
				reloadPage()
			},
		},)

		store.dispatch(stopSpinner(),)
		positiveTextFeedback('Usernotes loaded',)
	}

	return {
		handleNewPage: async (event: CustomEvent<TBPageContext>,) => {
			if (!unManagerLink) { return }
			const subreddit = event.detail.pageDetails.subreddit
			if (subreddit) {
				if (await isModSub(subreddit,)) {
					addContextItem('toolbox-manage-bans-link', {
						text: 'manage bans',
						icon: 'ban',
						title: `manage bans for /r/${subreddit}`,
						dataAttributes: {subreddit,},
						order: 10,
					},)
					addContextItem('toolbox-manage-mutes-link', {
						text: 'manage mutes',
						icon: 'mute',
						title: `manage mutes for /r/${subreddit}`,
						dataAttributes: {subreddit,},
						order: 20,
					},)
					addContextItem('toolbox-manage-flair-link', {
						text: 'manage flair',
						icon: 'flair',
						title: `manage flair for /r/${subreddit}`,
						dataAttributes: {subreddit,},
						order: 30,
					},)
					addContextItem('toolbox-un-config-link', {
						text: 'manage usernotes',
						icon: 'usernote',
						title: `edit usernotes for /r/${subreddit}`,
						dataAttributes: {subreddit,},
						order: 50,
					},)
				} else {
					removeContextItem('toolbox-un-config-link',)
					removeContextItem('toolbox-manage-bans-link',)
					removeContextItem('toolbox-manage-mutes-link',)
					removeContextItem('toolbox-manage-flair-link',)
				}
			} else {
				removeContextItem('toolbox-un-config-link',)
				removeContextItem('toolbox-manage-bans-link',)
				removeContextItem('toolbox-manage-mutes-link',)
				removeContextItem('toolbox-manage-flair-link',)
			}
		},

		openManagerForSubreddit,

		handleManagerClick: async (element: Element,) => {
			await openManagerForSubreddit(element.getAttribute('data-subreddit',) ?? '',)
		},
		handleOpenManagerEvent: (event,) => {
			void openManagerForSubreddit((event as CustomEvent<{subreddit: string}>).detail.subreddit,)
		},
		handleBansLinkClick: (element: Element,) => {
			const subreddit = element.getAttribute('data-subreddit',)
			if (!subreddit) { return }
			navigateToSubredditPage(subreddit, 'banned',)
		},
		handleMutesLinkClick: (element: Element,) => {
			const subreddit = element.getAttribute('data-subreddit',)
			if (!subreddit) { return }
			navigateToSubredditPage(subreddit, 'muted',)
		},
		handleFlairLinkClick: (element: Element,) => {
			const subreddit = element.getAttribute('data-subreddit',)
			if (!subreddit) { return }
			navigateToSubredditPage(subreddit, 'flair',)
		},
	}
}
