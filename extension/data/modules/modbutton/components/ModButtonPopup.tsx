/** Multi-tab popup for performing mod actions (ban, flair, modmail, etc.) on a Reddit user. */

import {ChangeEvent, useEffect, useMemo, useRef, useState,} from 'react'

import {getFlairSelector, getUserFlairTemplates,} from '../../../api/resources/flair'
import {getCurrentUser,} from '../../../api/resources/me'
import {getModSubs,} from '../../../api/resources/modSubs'
import {getModLog,} from '../../../api/resources/subreddits'
import type {RequestError,} from '../../../api/transport/http'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {ActionSelect,} from '../../../shared/controls/ActionSelect'
import {TextInput,} from '../../../shared/controls/NormalInput'
import {RelativeTime,} from '../../../shared/controls/RelativeTime'
import {SelectInput,} from '../../../shared/controls/SelectInput'
import {Window,} from '../../../shared/window/Window'
import {WindowTabs,} from '../../../shared/window/WindowTabs'
import store from '../../../store'
import {negativeTextFeedback, neutralTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import {startSpinner, stopSpinner,} from '../../../store/spinnerSlice'
import {replaceTokens,} from '../../../util/data/string'
import createLogger from '../../../util/infra/logging'
import type {ThingInfo,} from '../../../util/reddit/thingInfo'
import {useFetched,} from '../../../util/ui/hooks'
import {ModNotesPager,} from '../../shared/modnotes/ModNotesPager'

import {classes, mountPopup,} from '../../../util/ui/reactMount'

import {type ActionKind, type BanMacros, DEFAULT_BAN_PRESETS, type ModButtonActions, type SubStatus,} from '../schema'
import {BanForm,} from './BanForm'
import {
	actionMap,
	errorMessage,
	type ExistingBan,
	fetchSubStatus,
	getDefaultActionForUrl,
	hasPermission,
	isActionApplicable,
	loadingStatus,
	maxBanMessageLength,
	maxBanReasonLength,
	notApplicableReason,
	removalNotice,
} from './ModButtonPopup.helpers'
import css from './ModButtonPopup.module.css'
import {SendModmailTab,} from './SendModmailTab'
import {StatusBadges, SubredditRow,} from './SubredditRow'
import {type FlairTemplate, UserFlairTab,} from './UserFlairTab'

const log = createLogger('ModButton',)

/** Props for the ModButtonPopup component. */
interface ModButtonPopupProps {
	/** Normalized thing/author info used to pre-populate ban fields and token replacement. */
	info: ThingInfo
	initialPosition: {top: number; left: number}
	/** Whether to restore the last-used action type when the popup opens. */
	rememberLastAction: boolean
	/** Whether to show the "Global action" toggle for acting on all moderated subs at once. */
	globalButton: boolean
	/** Subreddits to exclude from the global action. */
	excludeGlobal: string[]
	/** User-pinned subreddits shown in the always-visible area of the subreddit list. */
	savedSubs: string[]
	/** Called whenever the pinned-subs list changes so the parent can persist it. */
	onSavedSubsChange: (subs: string[],) => void
	/** The most recently used action type (used when `rememberLastAction` is `true`). */
	lastAction: string
	/** Called to persist the action type after a successful action. */
	setLastAction: (a: string,) => void
	onClose: () => void
	/** Write operations and cross-module reads delegated to the parent layer. */
	actions: ModButtonActions
}

/** Renders the full mod-button popup window with Role, User Flair, Send Modmail, and User Modlog tabs. */
export function ModButtonPopup ({
	info,
	initialPosition,
	rememberLastAction,
	globalButton,
	excludeGlobal,
	savedSubs,
	onSavedSubsChange,
	lastAction,
	setLastAction,
	onClose,
	actions,
}: ModButtonPopupProps,) {
	const contextSub: string = info.subreddit ?? ''
	const user: string = info.user || info.author
	const thingId: string = info.fullname

	const [activeTabIndex, setActiveTabIndex,] = useState(0,)

	// The active subreddit - starts as the context subreddit, can be changed by the user
	const [activeSub, setActiveSub,] = useState<string>(contextSub,)

	// Action select
	const initialAction = getDefaultActionForUrl()
		?? (rememberLastAction ? (lastAction as ActionKind) : 'ban')
	const [actionType, setActionType,] = useState<ActionKind>(initialAction,)

	// Subreddit selection state
	const [currentSubChecked, setCurrentSubChecked,] = useState(
		getDefaultActionForUrl() == null,
	)
	const [checkedSubs, setCheckedSubs,] = useState<Set<string>>(new Set(),)
	const [localSavedSubs, setLocalSavedSubs,] = useState<string[]>(savedSubs,)
	const [allSubsExpanded, setAllSubsExpanded,] = useState(false,)
	const [subFilter, setSubFilter,] = useState('',)

	// Ban form fields
	const [banNote, setBanNote,] = useState('',)
	const [banMessage, setBanMessage,] = useState('',)
	const [banDuration, setBanDuration,] = useState('',)
	const [banPermanent, setBanPermanent,] = useState(true,)
	const [showCustomDuration, setShowCustomDuration,] = useState(false,)
	const [banDurationPresets, setBanDurationPresets,] = useState<number[]>(DEFAULT_BAN_PRESETS,)
	const [removeAll, setRemoveAll,] = useState(false,)

	// Mute duration (3, 7, or 28 days)
	const [muteDuration, setMuteDuration,] = useState(3,)

	// Existing ban info for the active subreddit
	const [existingBan, setExistingBan,] = useState<ExistingBan | null>(null,)

	// Per-subreddit lazy-loaded status map
	const [subStatuses, setSubStatuses,] = useState<Map<string, SubStatus>>(new Map(),)

	// Current moderator's username (fetched once on mount)
	const [currentUser, setCurrentUser,] = useState('',)

	// Status / error message in Role tab footer
	const [status, setStatus,] = useState('',)

	// Global mode toggle
	const [isGlobalMode, setIsGlobalMode,] = useState(false,)

	// In-popup confirmation dialog state
	const [pendingConfirm, setPendingConfirm,] = useState<{message: string; onConfirm: () => void} | null>(null,)

	// Progress tracking for mass actions
	const [actionProgress, setActionProgress,] = useState<{done: number; total: number} | null>(null,)

	// Ban note suggestion from usernotes
	const [notesSuggestError, setNotesSuggestError,] = useState('',)

	// Flair tab
	const [flairTemplates, setFlairTemplates,] = useState<FlairTemplate[]>([],)
	const [flairTemplateId, setFlairTemplateId,] = useState('',)
	const [flairText, setFlairText,] = useState('',)
	const [flairClass, setFlairClass,] = useState('',)
	const [flairClassDisabled, setFlairClassDisabled,] = useState(false,)
	const [flairLoaded, setFlairLoaded,] = useState(false,)

	// User Modlog tab
	const [userModlogLoaded, setUserModlogLoaded,] = useState(false,)

	// Mod subs list
	const modSubs = (useFetched(getModSubs(false,),)) ?? []

	// Moderated subs eligible for global actions (excludeGlobal filtered out)
	const globalTargetSubs = useMemo(
		() => modSubs.filter((s,) => !excludeGlobal.includes(s,)),
		[modSubs, excludeGlobal,],
	)

	// Modmail "from" dropdown options - activeSub floated to the top. Consumed only by the
	// always-recreated SendModmailTab element below, so memoizing the array buys nothing.
	const modmailSubOptions = (activeSub && modSubs.includes(activeSub,))
		? [activeSub, ...modSubs.filter((s,) => s !== activeSub),]
		: modSubs

	// Pinned subs visible in the always-shown area (not the active subreddit)
	const visibleSavedSubs = useMemo(
		() => localSavedSubs.filter((s,) => modSubs.includes(s,) && s !== activeSub),
		[localSavedSubs, modSubs, activeSub,],
	)

	// All mod subs that are neither the active subreddit nor pinned
	const allOtherSubs = useMemo(
		() => modSubs.filter((s,) => s !== activeSub && !localSavedSubs.includes(s,)),
		[modSubs, activeSub, localSavedSubs,],
	)

	// Checked "other" subs - floated above the collapsible so they're always visible
	const checkedOtherSubs = useMemo(
		() => allOtherSubs.filter((s,) => checkedSubs.has(s,)),
		[allOtherSubs, checkedSubs,],
	)

	// Unchecked "other" subs - hidden inside the collapsible
	const uncheckedFilteredOtherSubs = useMemo(() => {
		const unchecked = allOtherSubs.filter((s,) => !checkedSubs.has(s,))
		return subFilter
			? unchecked.filter((s,) => s.toLowerCase().includes(subFilter.toLowerCase(),))
			: unchecked
	}, [allOtherSubs, checkedSubs, subFilter,],)

	// Fetch current user once on mount
	useEffect(() => {
		getCurrentUser().then((u,) => setCurrentUser(u,)).catch((error: unknown,) => {
			log.error('Failed to fetch current user:', error,)
		},)
	}, [],)

	// When activeSub changes, reset per-subreddit state and re-fetch
	const statusAutoApplied = useRef(false,)
	useEffect(() => {
		if (!activeSub || !user) { return }
		let cancelled = false

		if (checkedSubs.has(activeSub,)) {
			setCheckedSubs((prev,) => {
				const next = new Set(prev,)
				next.delete(activeSub,)
				return next
			},)
			setCurrentSubChecked(true,)
		}

		setExistingBan(null,)
		setBanNote('',)
		setBanMessage('',)
		setBanDuration('',)
		setBanPermanent(true,)
		setRemoveAll(false,)
		setBanDurationPresets(DEFAULT_BAN_PRESETS,)
		setFlairLoaded(false,)
		setUserModlogLoaded(false,)
		statusAutoApplied.current = false

		actions.getBanMacros(activeSub,).then((macros: BanMacros | null,) => {
			if (cancelled || !macros) { return }
			if (macros.banNote) { setBanNote(replaceTokens(info as Record<string, string>, macros.banNote,),) }
			if (macros.banMessage) { setBanMessage(replaceTokens(info as Record<string, string>, macros.banMessage,),) }
			const permanent = macros.defaultBanPermanent !== false
			setBanPermanent(permanent,)
			let presets: number[] = DEFAULT_BAN_PRESETS
			if (Array.isArray(macros.banDurationPresets,) && macros.banDurationPresets.length > 0) {
				presets = macros.banDurationPresets
				setBanDurationPresets(presets,)
			}
			if (!permanent && macros.defaultBanDuration > 0) {
				setBanDuration(String(macros.defaultBanDuration,),)
				if (!presets.includes(macros.defaultBanDuration,)) {
					setShowCustomDuration(true,)
				}
			}
		},).catch((error: unknown,) => {
			log.error('Failed to load ban macros:', error,)
		},)
		void (async () => {
			setSubStatuses((prev,) => new Map(prev,).set(activeSub, loadingStatus,))
			const currentUserName = currentUser || await getCurrentUser()
			if (cancelled) { return }
			if (!currentUser) { setCurrentUser(currentUserName,) }

			const {status, banInfo,} = await fetchSubStatus(activeSub, user, currentUserName,)
			if (cancelled) { return }

			setSubStatuses((prev,) => new Map(prev,).set(activeSub, status,))

			if (banInfo) {
				const userFullname = banInfo.id
				const timestamp = new Date(banInfo.date * 1000,)
				let modName = ''
				let modLink = '#'
				try {
					// Typed at the API response boundary; getModLog returns untyped JSON.
					const logData = await getModLog(activeSub, {type: 'banuser', limit: '1000',},) as {
						data: {children: Array<{data: {target_fullname: string; mod: string}}>}
					}
					// Defensive: an unexpected response shape (missing data/children) yields an
					// empty list rather than throwing mid-loop and logging a spurious warning.
					const entries = logData.data?.children ?? []
					for (const entry of entries) {
						if (entry.data.target_fullname === userFullname) {
							modName = entry.data.mod
							modLink = `/u/${modName}`
							break
						}
					}
				} catch (e) {
					log.warn('Error looking up ban mod:', e,)
				}
				if (cancelled) { return }
				setExistingBan({
					note: banInfo.note ?? '',
					timestamp,
					modName,
					modLink,
					daysLeft: banInfo.days_left ?? null,
				},)
				setBanNote(banInfo.note ?? '',)
			}
		})()

		return () => {
			cancelled = true
		}
	}, [activeSub, user,],)

	// Clear stale status/error/global-mode when action type changes
	useEffect(() => {
		setStatus('',)
		setIsGlobalMode(false,)
		setPendingConfirm(null,)
	}, [actionType,],)

	// Auto-select the most appropriate action once active subreddit status loads
	useEffect(() => {
		if (statusAutoApplied.current) { return }
		const s = subStatuses.get(activeSub,)
		if (!s || s.loading) { return }
		statusAutoApplied.current = true

		const perms = s.currentUserPermissions
		const hasAccess = hasPermission(perms, 'access',)
		const hasMail = hasPermission(perms, 'mail',)

		if (hasAccess) {
			if (s.isMod) {
				setActionType('demod',)
			} else if (s.banned) {
				setActionType('change ban',)
			} else if (s.isContributor) {
				setActionType('remove submitter',)
			}
		} else if (hasMail) {
			setActionType(s.isMuted ? 'unmute' : 'mute',)
		}
	}, [subStatuses, activeSub,],)

	const loadSubStatus = async (subreddit: string,) => {
		if (subStatuses.has(subreddit,)) { return }
		setSubStatuses((prev,) => new Map(prev,).set(subreddit, loadingStatus,))
		const {status,} = await fetchSubStatus(subreddit, user, currentUser,)
		setSubStatuses((prev,) => new Map(prev,).set(subreddit, status,))
	}

	// User modlog tab - mark loaded when tab becomes active
	useEffect(() => {
		if (!activeSub || !user || activeTabIndex !== 3 || userModlogLoaded) { return }
		setUserModlogLoaded(true,)
	}, [activeSub, user, activeTabIndex, userModlogLoaded,],)

	useEffect(() => {
		if (!activeSub || !user || activeTabIndex !== 1 || flairLoaded) { return }
		void (async () => {
			try {
				const [userFlairInfo, userFlairTemplates,] = await Promise.all([
					getFlairSelector(activeSub, user,),
					getUserFlairTemplates(activeSub,),
				],)
				if (!userFlairInfo.current) { return }
				setFlairTemplates(userFlairTemplates,)
				setFlairText(userFlairInfo.current.flair_text || '',)
				setFlairClass(userFlairInfo.current.flair_css_class || '',)
				if (userFlairInfo.current.flair_template_id) {
					setFlairTemplateId(userFlairInfo.current.flair_template_id,)
					setFlairClassDisabled(true,)
				}
				setFlairLoaded(true,)
			} catch (e) {
				log.error('Error loading user flair info:', e,)
			}
		})()
	}, [activeSub, user, activeTabIndex, flairLoaded,],)

	const onFlairTemplateChange = (event: ChangeEvent<HTMLSelectElement>,) => {
		const id = event.target.value
		setFlairTemplateId(id,)
		if (!id) {
			setFlairText('',)
			setFlairClass('',)
			setFlairClassDisabled(false,)
			return
		}
		const selected = flairTemplates.find((f,) => f.id === id)
		if (selected) {
			setFlairText(selected.text || '',)
			setFlairClass(selected.css_class || '',)
			setFlairClassDisabled(true,)
		}
	}

	const handleFlairSave = async () => {
		if (!user || !activeSub) { return }
		neutralTextFeedback('saving user flair...',)
		try {
			await actions.flairUser({
				user,
				subreddit: activeSub,
				text: flairText,
				cssClass: flairClass,
				templateID: flairTemplateId,
			},)
			positiveTextFeedback('saved user flair',)
			setStatus('',)
		} catch (error: unknown) {
			const msg = errorMessage(error,)
			log.error('Error saving user flair:', error,)
			negativeTextFeedback(`failed to save user flair: ${msg}`,)
			setStatus(`error: ${msg}`,)
		}
	}

	const [modmailSubject, setModmailSubject,] = useState('',)
	const [modmailBody, setModmailBody,] = useState('',)
	const [modmailCallback, setModmailCallback,] = useState<{text: string; kind: '' | 'error' | 'success'}>({
		text: '',
		kind: '',
	},)
	const [modmailSub, setModmailSub,] = useState<string>(contextSub,)
	const [modmailIsHidden, setModmailIsHidden,] = useState(false,)

	const handleSendModmail = async () => {
		if (!modmailSubject || !modmailBody) {
			setModmailCallback({text: 'You forgot a subject or message', kind: 'error',},)
			return
		}
		store.dispatch(startSpinner(),)
		try {
			await actions.sendModmail({
				subreddit: modmailSub || activeSub,
				to: user,
				subject: modmailSubject,
				body: modmailBody,
				isAuthorHidden: modmailIsHidden,
			},)
			positiveTextFeedback('message sent.', {duration: 1500,},)
			setModmailCallback({text: 'message sent', kind: 'success',},)
		} catch (error: unknown) {
			let message = errorMessage(error,)
			const response = error instanceof Error ? (error as RequestError).response : undefined
			if (response) {
				try {
					const data = await response.json() as {fields?: string[]; explanation?: string; message?: string}
					if (data.fields && Array.isArray(data.fields,)) {
						message = `${data.fields.join(', ',)}: ${data.explanation}`
					} else {
						message = data.message ?? message
					}
				} catch { /* keep original message */ }
			}
			setModmailCallback({text: `an error occurred: ${message}`, kind: 'error',},)
		}
		store.dispatch(stopSpinner(),)
	}

	const pin = (subreddit: string,) => {
		if (localSavedSubs.includes(subreddit,)) { return }
		const next = [...localSavedSubs, subreddit,]
		setLocalSavedSubs(next,)
		onSavedSubsChange(next,)
	}

	const unpin = (subreddit: string,) => {
		const next = localSavedSubs.filter((s,) => s !== subreddit)
		setLocalSavedSubs(next,)
		onSavedSubsChange(next,)
		setCheckedSubs((prev,) => {
			const nextSet = new Set(prev,)
			nextSet.delete(subreddit,)
			return nextSet
		},)
	}

	const toggleSubCheck = (subreddit: string, checked: boolean,) => {
		setCheckedSubs((prev,) => {
			const next = new Set(prev,)
			if (checked) { next.add(subreddit,) }
			else { next.delete(subreddit,) }
			return next
		},)
		if (checked) { void loadSubStatus(subreddit,) }
	}

	// Auto-uncheck subs that become non-applicable when status loads or action changes
	useEffect(() => {
		setCheckedSubs((prev,) => {
			const next = new Set(prev,)
			let changed = false
			for (const subreddit of next) {
				const s = subStatuses.get(subreddit,)
				if (s && !s.loading && !isActionApplicable(s, actionType,)) {
					next.delete(subreddit,)
					changed = true
				}
			}
			return changed ? next : prev
		},)
	}, [subStatuses, actionType,],)

	const collectSelectedSubs = (): string[] => {
		const subs: string[] = []
		if (currentSubChecked && activeSub) { subs.push(activeSub,) }
		for (const subreddit of [...visibleSavedSubs, ...allOtherSubs,]) {
			if (checkedSubs.has(subreddit,)) { subs.push(subreddit,) }
		}
		// Dedup defensively: the result drives per-sub mod actions (ban/unban/modmail), so a
		// stray duplicate in the saved-subs setting must never cause the action to fire twice.
		return Array.from(new Set(subs,),)
	}

	const requestConfirm = (message: string, onConfirm: () => void,) => {
		setPendingConfirm({message, onConfirm,},)
	}

	const performAction = async (subreddit: string,): Promise<void> => {
		switch (actionType) {
			case 'ban':
			case 'change ban': {
				const messageToSend = (removeAll && banPermanent)
					? banMessage + removalNotice
					: banMessage
				await actions.ban({
					user,
					subreddit,
					note: banNote,
					banMessage: messageToSend,
					banDuration: banPermanent ? 0 : parseInt(banDuration, 10,) || 0,
					banContext: thingId,
				},)
				if (removeAll && banPermanent) {
					await actions.removeAllUserContent(subreddit, user,)
				}
				break
			}
			case 'add submitter': {
				await actions.addContributor(subreddit, user,)
				break
			}
			case 'remove submitter':
				await actions.removeContributor(subreddit, user,)
				break
			case 'mod': {
				await actions.addModerator(subreddit, user,)
				break
			}
			case 'demod':
				await actions.removeModerator(subreddit, user,)
				break
			case 'mute':
				await actions.muteUser({user, subreddit, duration: muteDuration,},)
				break
			case 'unmute':
				await actions.unmuteUser(subreddit, user,)
				break
		}
	}

	const executeBatch = async (
		subs: string[],
		action: (subreddit: string,) => Promise<void>,
		label: string,
	): Promise<string[]> => {
		const failedSubs: string[] = []
		setActionProgress({done: 0, total: subs.length,},)
		store.dispatch(startSpinner(),)
		neutralTextFeedback(label,)
		await Promise.all(subs.map(async (subreddit,) => {
			try {
				await action(subreddit,)
			} catch (error) {
				log.error(`action threw for /r/${subreddit}:`, error,)
				failedSubs.push(subreddit,)
			} finally {
				setActionProgress((p,) => p ? {...p, done: p.done + 1,} : p)
			}
		},),)
		store.dispatch(stopSpinner(),)
		setActionProgress(null,)
		actions.refreshCounters()
		return failedSubs
	}

	const executeOnSubs = (subs: string[],) => executeBatch(subs, performAction, 'Performing mod action',)
	const executeUnbanOnSubs = (subs: string[],) =>
		executeBatch(subs, (subreddit,) => actions.unban(subreddit, user,), 'Unbanning user',)

	const runMassAction = async (subs: string[],) => {
		const failed = await executeOnSubs(subs,)
		if (failed.length > 0) {
			requestConfirm(`${failed.length} failed again. Retry?`, () => void runMassAction(failed,),)
		} else {
			onClose()
		}
	}

	const handleSave = async (isGlobal: boolean,) => {
		setLastAction(actionType,)

		if (actionType === 'ban' || actionType === 'change ban') {
			if (banNote.length > maxBanReasonLength) {
				setStatus(`error, ban note is ${banNote.length - maxBanReasonLength} characters over limit`,)
				return
			}
			if (banMessage.length > effectiveMaxMessage) {
				setStatus(`error, ban message is ${banMessage.length - effectiveMaxMessage} characters over limit`,)
				return
			}
		}

		if (isGlobal) {
			requestConfirm(
				`This will ${actionType} /u/${user} on ${globalTargetSubs.length} subreddits. Are you sure?`,
				() => {
					void (async () => {
						const failed = await executeOnSubs(globalTargetSubs,)
						if (failed.length > 0) {
							requestConfirm(
								`Action complete, however ${failed.length} failed. Retry?`,
								() => void runMassAction(failed,),
							)
						} else {
							onClose()
						}
					})()
				},
			)
			return
		}

		const targetSubs = collectSelectedSubs()
		if (targetSubs.length < 1) {
			setStatus('error, no subreddits selected',)
			return
		}

		const failed = await executeOnSubs(targetSubs,)
		if (failed.length > 0) {
			requestConfirm(
				`Action complete, however ${failed.length} failed. Retry?`,
				() => void runMassAction(failed,),
			)
		} else {
			onClose()
		}
	}

	const handleUnban = async () => {
		const targetSubs = collectSelectedSubs()
		if (targetSubs.length < 1) {
			setStatus('error, no subreddits selected',)
			return
		}
		const failed = await executeUnbanOnSubs(targetSubs,)
		if (failed.length > 0) {
			requestConfirm(`Unban complete, however ${failed.length} failed. Retry?`, () => {
				void (async () => {
					await executeUnbanOnSubs(failed,)
					onClose()
				})()
			},)
		} else {
			onClose()
		}
	}

	const handleSuggestFromNotes = async () => {
		setNotesSuggestError('',)
		try {
			const note = await actions.suggestBanNote(activeSub, user,)
			if (note === null) {
				setNotesSuggestError('no notes found',)
				return
			}
			setBanNote(note,)
		} catch {
			setNotesSuggestError('no notes found',)
		}
	}

	const activeSubStatus = subStatuses.get(activeSub,)

	const visibleActions = useMemo((): ActionKind[] => {
		if (!activeSubStatus || activeSubStatus.loading) {
			return ['ban', 'change ban', 'add submitter', 'remove submitter', 'mod', 'demod', 'mute', 'unmute',]
		}
		const perms = activeSubStatus.currentUserPermissions
		const hasAccess = hasPermission(perms, 'access',)
		const hasMail = hasPermission(perms, 'mail',)
		const actions: ActionKind[] = []

		if (hasAccess) {
			// Mods can't be banned or muted - only demoddable
			if (activeSubStatus.isMod) {
				actions.push('demod',)
			} else {
				actions.push(activeSubStatus.banned ? 'change ban' : 'ban',)
				actions.push('mod',)
				actions.push(activeSubStatus.isContributor ? 'remove submitter' : 'add submitter',)
			}
		}
		if (hasMail && !activeSubStatus.isMod) {
			actions.push(activeSubStatus.isMuted ? 'unmute' : 'mute',)
		}
		return actions
	}, [activeSubStatus,],)

	// Once modSubs loads, ensure the selection is valid - default to contextSub if available, else first modsub.
	useEffect(() => {
		if (modSubs.length === 0) { return }
		if (!modSubs.includes(modmailSub,)) {
			setModmailSub(modSubs.includes(contextSub,) ? contextSub : modSubs[0]!,)
		}
	}, [modSubs,],)

	// If the current action is no longer available (e.g. switched from a subreddit where the target was
	// a mod so 'demod' was selected, to one where they're not), fall back to the first available.
	useEffect(() => {
		if (visibleActions.length > 0 && !visibleActions.includes(actionType,)) {
			setActionType(visibleActions[0]!,)
		}
	}, [visibleActions,],)

	const isBanRelated = actionType === 'ban' || actionType === 'change ban'
	const isMuteAction = actionType === 'mute'
	const effectiveMaxMessage = (removeAll && banPermanent)
		? maxBanMessageLength - removalNotice.length
		: maxBanMessageLength

	let footer: React.ReactNode = null
	if (activeTabIndex === 0) {
		footer = pendingConfirm
			? (
				<>
					<span className={css.status}>{pendingConfirm.message}</span>
					<ActionButton
						primary
						onClick={() => {
							const {onConfirm,} = pendingConfirm
							setPendingConfirm(null,)
							onConfirm()
						}}
					>
						Confirm
					</ActionButton>
					<ActionButton onClick={() => setPendingConfirm(null,)}>Cancel</ActionButton>
				</>
			)
			: (
				<>
					{actionProgress
						? <span className={css.status}>Working... ({actionProgress.done}/{actionProgress.total})</span>
						: <span className={classes(css.status, css.error,)}>{status}</span>}
					<ActionSelect
						className={css.modAction}
						value={actionType}
						onChange={(event,) => setActionType(event.target.value as ActionKind,)}
					>
						{visibleActions.map((name,) => (
							<option
								key={name}
								value={name}
								className={actionMap[name].kind === 'negative' ? css.negative : css.positive}
							>
								{name}
							</option>
						))}
					</ActionSelect>
					<ActionButton primary onClick={() => void handleSave(isGlobalMode,)}>Save</ActionButton>
					{actionType === 'change ban' && (
						<ActionButton className={css.unbanButton} onClick={() => void handleUnban()}>
							Unban
						</ActionButton>
					)}
				</>
			)
	} else if (activeTabIndex === 1) {
		footer = (
			<>
				<span className={classes(css.status, css.error,)}>{status}</span>
				<ActionButton onClick={() => void handleFlairSave()}>Save Flair</ActionButton>
			</>
		)
	} else if (activeTabIndex === 2) {
		footer = <ActionButton disabled={!modmailSub} onClick={() => void handleSendModmail()}>
			Send Modmail
		</ActionButton>
	}

	const tabItems = [
		{
			title: 'Role',
			content: (
				<div className={css.subList}>
					{globalButton && (
						<label className={css.globalToggleRow}>
							<input
								type="checkbox"
								checked={isGlobalMode}
								onChange={(e,) => setIsGlobalMode(e.target.checked,)}
							/>
							<span>Global action - all {globalTargetSubs.length} moderated subs</span>
							{excludeGlobal.length > 0 && (
								<span className={css.globalExcludeNote}>({excludeGlobal.length} excluded)</span>
							)}
						</label>
					)}
					<div className={isGlobalMode ? classes(css.subScrollArea, css.subListDimmed,) : css.subScrollArea}>
						{/* ── Active subreddit row ── */}
						<div className={css.subRow}>
							<input
								type="checkbox"
								aria-label={`Include /r/${activeSub} in action`}
								checked={currentSubChecked}
								disabled={!activeSub}
								onChange={(event,) => setCurrentSubChecked(event.target.checked,)}
							/>
							{activeSub
								? (
									<span className={css.subLabel}>
										/r/{activeSub}
										{activeSub === contextSub && <span className={css.currentBadge}>current</span>}
									</span>
								)
								: <span className={css.subPlaceholder}>select a subreddit</span>}
							{activeSub && <StatusBadges status={subStatuses.get(activeSub,)} />}
							{activeSub && (localSavedSubs.includes(activeSub,)
								? <button
									type="button"
									className={css.pinBtn}
									title="Remove from quick list"
									onClick={() => unpin(activeSub,)}
								>
									★
								</button>
								: <button
									type="button"
									className={css.pinBtn}
									title="Save to quick list"
									onClick={() => pin(activeSub,)}
								>
									☆
								</button>)}
							{existingBan && (
								<div className={css.alreadyBanned}>
									banned by <a href={existingBan.modLink}>{existingBan.modName}</a>{' '}
									<RelativeTime date={existingBan.timestamp} />
									{existingBan.daysLeft !== null
										? ` · ${existingBan.daysLeft} day${
											existingBan.daysLeft !== 1 ? 's' : ''
										} remaining`
										: ' · permanent'}
								</div>
							)}
						</div>

						{/* ── Pinned subs ── */}
						{visibleSavedSubs.length > 0 && (
							<div className={css.savedSubRows}>
								{visibleSavedSubs.map((subreddit,) => {
									const st = subStatuses.get(subreddit,)
									return (
										<SubredditRow
											key={subreddit}
											subreddit={subreddit}
											checked={checkedSubs.has(subreddit,)}
											applicable={isActionApplicable(st, actionType,)}
											notApplicableTitle={st && !st.loading
												? notApplicableReason(actionType,)
												: undefined}
											status={st}
											pinned
											onToggle={(checked,) => toggleSubCheck(subreddit, checked,)}
											onActivate={() => setActiveSub(subreddit,)}
											onPinToggle={() => unpin(subreddit,)}
										/>
									)
								},)}
							</div>
						)}

						{/* ── Checked subs from the full list (always visible) ── */}
						{checkedOtherSubs.length > 0 && (
							<div className={css.savedSubRows}>
								{checkedOtherSubs.map((subreddit,) => {
									const st = subStatuses.get(subreddit,)
									return (
										<SubredditRow
											key={subreddit}
											subreddit={subreddit}
											checked
											applicable={isActionApplicable(st, actionType,)}
											notApplicableTitle={st && !st.loading
												? notApplicableReason(actionType,)
												: undefined}
											status={st}
											pinned={false}
											onToggle={(checked,) => toggleSubCheck(subreddit, checked,)}
											onActivate={() => setActiveSub(subreddit,)}
											onPinToggle={() => pin(subreddit,)}
										/>
									)
								},)}
							</div>
						)}
					</div>

					{/* ── All subreddits (unchecked only, collapsible) ── */}
					{allOtherSubs.length > 0 && (
						<div className={css.allSubsSection}>
							<button
								type="button"
								className={css.allSubsHeader}
								onClick={() => setAllSubsExpanded((e,) => !e)}
							>
								{allSubsExpanded ? '▼' : '▶'}{' '}
								All subreddits ({allOtherSubs.length - checkedOtherSubs.length})
							</button>
							{allSubsExpanded && (
								<>
									<TextInput
										type="text"
										className={css.subFilter}
										placeholder="Filter..."
										value={subFilter}
										onChange={(e,) => setSubFilter(e.target.value,)}
									/>
									<div className={css.allSubsList}>
										{uncheckedFilteredOtherSubs.map((subreddit,) => {
											const st = subStatuses.get(subreddit,)
											return (
												<SubredditRow
													key={subreddit}
													subreddit={subreddit}
													checked={false}
													applicable={isActionApplicable(st, actionType,)}
													notApplicableTitle={st && !st.loading
														? notApplicableReason(actionType,)
														: undefined}
													status={st}
													pinned={false}
													onToggle={(checked,) => toggleSubCheck(subreddit, checked,)}
													onActivate={() => setActiveSub(subreddit,)}
													onPinToggle={() => pin(subreddit,)}
												/>
											)
										},)}
									</div>
								</>
							)}
						</div>
					)}

					{/* ── Ban fields ── */}
					{isBanRelated && (
						<BanForm
							banNote={banNote}
							onBanNoteChange={setBanNote}
							banMessage={banMessage}
							onBanMessageChange={setBanMessage}
							banDuration={banDuration}
							onBanDurationChange={setBanDuration}
							banPermanent={banPermanent}
							showCustomDuration={showCustomDuration}
							banDurationPresets={banDurationPresets}
							removeAll={removeAll}
							effectiveMaxMessage={effectiveMaxMessage}
							notesSuggestError={notesSuggestError}
							showFromNotes={!!activeSub}
							onSuggestFromNotes={() => void handleSuggestFromNotes()}
							onSelectPreset={(days,) => {
								setBanDuration(String(days,),)
								setBanPermanent(false,)
								setShowCustomDuration(false,)
								setRemoveAll(false,)
							}}
							onSelectPermanent={() => {
								setBanPermanent(true,)
								setShowCustomDuration(false,)
							}}
							onSelectCustom={() => {
								setShowCustomDuration(true,)
								setBanPermanent(false,)
								setRemoveAll(false,)
							}}
							onRemoveAllChange={setRemoveAll}
						/>
					)}

					{/* ── Mute duration ── */}
					{isMuteAction && (
						<div className={css.muteDurationRow}>
							<label className={css.muteDurationLabel}>Mute duration:</label>
							<SelectInput
								className={css.muteDurationSelect}
								value={muteDuration}
								onChange={(e,) => setMuteDuration(parseInt(e.target.value, 10,),)}
							>
								<option value={3}>3 days</option>
								<option value={7}>7 days</option>
								<option value={28}>28 days</option>
							</SelectInput>
						</div>
					)}
				</div>
			),
		},
		...(activeSub
			? [
				{
					title: 'User Flair',
					content: (
						<UserFlairTab
							flairTemplates={flairTemplates}
							flairTemplateId={flairTemplateId}
							flairText={flairText}
							flairClass={flairClass}
							flairClassDisabled={flairClassDisabled}
							onTemplateChange={onFlairTemplateChange}
							onTextChange={setFlairText}
							onClassChange={setFlairClass}
						/>
					),
				},
				{
					title: 'Send Modmail',
					content: (
						<SendModmailTab
							modmailSubOptions={modmailSubOptions}
							modmailSub={modmailSub}
							onModmailSubChange={setModmailSub}
							isHidden={modmailIsHidden}
							onIsHiddenChange={setModmailIsHidden}
							subject={modmailSubject}
							onSubjectChange={setModmailSubject}
							body={modmailBody}
							onBodyChange={setModmailBody}
							callback={modmailCallback}
							activeSub={activeSub}
						/>
					),
				},
				{
					title: 'User Modlog',
					content: userModlogLoaded
						? <ModNotesPager user={user} subreddit={activeSub} filter="MOD_ACTION" />
						: null,
				},
			]
			: []),
	]

	return (
		<Window
			title={`Mod Actions - /u/${user}`}
			className={css.popup}
			draggable
			initialPosition={initialPosition}
			onClose={onClose}
			footer={footer}
		>
			<WindowTabs tabs={tabItems} defaultTabIndex={0} onTabChange={setActiveTabIndex} />
		</Window>
	)
}

/**
 * Mounts a ModButtonPopup in a detached shadow DOM and returns a function that unmounts it.
 * @param props All ModButtonPopupProps except `onClose`, which is handled internally.
 */
export function showModButtonPopup (
	props: Omit<ModButtonPopupProps, 'onClose'> & {onClose?: () => void},
) {
	// Per-target by the acted-on user (+ subreddit context): mod-button popups for
	// different users coexist; re-opening the same target reveals the live popup so
	// any half-typed ban message/note is preserved. Omit the key if no author is
	// resolvable, to avoid collapsing unrelated popups onto an empty key.
	const author = props.info?.author ?? props.info?.user
	const key = author ? `modbutton:${props.info?.subreddit ?? ''}:${author}` : undefined
	return mountPopup((onClose,) => <ModButtonPopup {...props} onClose={onClose} />, props.onClose, key,)
}
