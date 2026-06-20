/**
 * Full removal-reasons overlay UI: lets a moderator select one or more reasons,
 * compose a combined message, configure delivery options, and submit the removal.
 * Supports both popup and drawer display modes.
 */

import {
	closestCenter,
	DndContext,
	DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from '@dnd-kit/core'
import {arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,} from '@dnd-kit/sortable'
import {ReactNode, useEffect, useMemo, useRef, useState,} from 'react'
import {removalReasons,} from '../../../framework/moduleIds'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {FullPageDialog,} from '../../../shared/window/FullPageDialog'
import {PushDrawer,} from '../../../shared/window/PushDrawer'
import {Window,} from '../../../shared/window/Window'
import {positiveTextFeedback,} from '../../../store/feedback'
import {replaceTokens,} from '../../../util/data/string'
import {runInReplay,} from '../../../util/infra/captureGuard'
import {getCache, setCache,} from '../../../util/persistence/cache'
import {classes, mountPopup,} from '../../../util/ui/reactMount'
import type {
	FrozenReasonType,
	FrozenRemovalSelection,
	FrozenSelectionReason,
} from '../../../util/wiki/schemas/proposals/schema'
import {decodeHtmlAngleBrackets, htmlFieldsToTokens,} from '../../../util/wiki/schemas/shared/tokens'
import {UserNoteColor,} from '../../../util/wiki/schemas/usernotes/schema'
import {requestCounterRefresh,} from '../../notifier/store'
import {maybePropose, performRemoval, proposeOrRemove,} from '../../shared/proposals/gateway'
import {makeDeliveryOption,} from '../../shared/removalReasons/DeliveryOption'
import {getRemovalReasonParser,} from '../../shared/removalReasons/parser'
import {getSubredditColors,} from '../../shared/usernotes/moduleapi'
import {unmetUsernoteRequirement, type UsernoteRequireFlags,} from '../../shared/usernotes/requireRules'
import {submitRemoval, type SubmitRemovalParams,} from '../features/submitRemoval'
import {freezeRemovalParams,} from '../proposalAdapter'

import {
	isDrawerDisplayMode,
	RemovalReason,
	RemovalReasonsData,
	RemovalReasonsDisplayMode,
	RemovalReasonsOverlaySettings,
} from '../schema'
import {
	composeReasonText,
	getDomainLink,
	noReasonError,
	type ReasonType,
	removeError,
	type RenderedReason,
	renderReasonHtml,
	settingToReasonType,
	statusDefaultText,
	syncRadiosToHiddenInput,
} from './RemovalReasonsOverlay.helpers'
import css from './RemovalReasonsOverlay.module.css'
import {SortableReasonCard,} from './SortableReasonCard'

/**
 * Pre-fill for re-opening the overlay to accept-with-edit a captured proposal. Mirrors
 * the structured fields of a `FrozenRemovalIntent` (minus the composed text/subject) so
 * the reviewer sees exactly what the trainee selected and can adjust any of it. When
 * present, the overlay seeds its state from this instead of the configured defaults and
 * suppresses re-capture (`bypassCapture`).
 */
export interface RemovalReasonsOverlayPreseed {
	/** Selected reasons (persistent id + resolved body) in display order. */
	reasons: FrozenSelectionReason[]
	/** Whether the configured header/footer were included. */
	includeHeader?: boolean
	includeFooter?: boolean
	/** Delivery mode. */
	reasonType: FrozenReasonType
	reasonSticky?: boolean
	reasonAsSub?: boolean
	reasonAutoArchive?: boolean
	reasonCommentAsSubreddit?: boolean
	actionLockThread?: boolean
	actionLockComment?: boolean
	/** Public log reason text. */
	logReasonText?: string
	/** Usernote to leave (presence ⇒ leave a note). */
	usernote?: {text: string; type?: string; includeLink?: boolean; includeMessage?: boolean}
	/** Ban to issue (presence ⇒ issue a ban). */
	ban?: {permanent: boolean; days: number; note: string}
	/** When true, the overlay performs the removal directly and never re-captures it. */
	bypassCapture?: boolean
}

/** Props for the RemovalReasonsOverlay component. */
interface RemovalReasonsOverlayProps {
	/** Context data about the thing being removed. */
	data: RemovalReasonsData
	/** Remove as spam (trains the spam filter) rather than a plain removal. */
	spam?: boolean
	/** The subset of reasons to show (filtered by content type). */
	visibleReasons: RemovalReason[]
	displayMode?: RemovalReasonsDisplayMode
	/** Moderator-level default delivery settings. */
	settings: RemovalReasonsOverlaySettings
	/**
	 * The effective usernote save requirements (subreddit floor already combined
	 * with the moderator's personal settings) used to gate leaving a usernote.
	 * Defaults to "only text required" when omitted.
	 */
	usernoteRequire?: UsernoteRequireFlags
	/**
	 * Pre-fill captured from a proposal, for Edit & Accept. When set, the overlay seeds
	 * its selection/usernote/ban/delivery from it and performs the removal directly.
	 */
	seededFromIntent?: RemovalReasonsOverlayPreseed
	/**
	 * Persistent reason ids to pre-check when the overlay opens, from a suggested-reason
	 * mapping matching the item's report. Unlike {@link seededFromIntent} this only seeds
	 * the initial selection (capture/proposal flow is unaffected) and is ignored while
	 * seeding from a captured intent.
	 */
	suggestedReasonIds?: string[]
	/**
	 * For Edit & Accept (`bypassCapture`): an atomic gate run immediately before the
	 * removal is performed, so two reviewers accepting the same proposal can't both
	 * perform it. Returns `{ok: false, message}` to abort the perform (the message is
	 * shown as the overlay status); omit for non-accept removals.
	 */
	beforePerform?: () => Promise<{ok: true} | {ok: false; message: string}>
	/**
	 * For Edit & Accept: called when the removal fails *after* {@link beforePerform}
	 * claimed the proposal, so the caller can release the claim and allow a retry.
	 */
	onPerformError?: () => void
	/** Called after a successful removal, before the overlay closes. */
	onRemoved?: () => void
	onClose: () => void
}

export type {RemovalReasonsDisplayMode,}

const drawerWidthPx = 420
const drawerPushMediaQuery = '(min-width: 900px)'

function Section ({
	title,
	children,
	className,
}: {
	title: string
	children: ReactNode
	className?: string
},) {
	return (
		<section className={classes(css.section, className,)}>
			<div className={css.sectionTitle}>{title}</div>
			{children}
		</section>
	)
}

const DeliveryOption = makeDeliveryOption(css.deliveryOption, css.deliveryOptionSelected,)

/** Renders the removal-reasons overlay for a single post or comment removal. */
export function RemovalReasonsOverlay ({
	data,
	spam,
	visibleReasons,
	displayMode = 'Popup (legacy)',
	settings,
	usernoteRequire = {type: false, text: true, link: false,},
	seededFromIntent,
	suggestedReasonIds,
	beforePerform,
	onPerformError,
	onRemoved,
	onClose,
}: RemovalReasonsOverlayProps,) {
	const drawerMode = isDrawerDisplayMode(displayMode,)
	const isSubmission = data.kind === 'submission'
	const leaveUpToMods = data.removalOption === undefined || data.removalOption === 'leave'
	const forced = data.removalOption === 'force'

	const initialReasonType: ReasonType = leaveUpToMods
		? settingToReasonType(settings.reasonTypeSetting,)
		: ((data.typeReply as ReasonType) || 'reply')
	const initialReasonAsSub = leaveUpToMods ? settings.reasonAsSubSetting : !!data.typeAsSub
	const initialAutoArchive = leaveUpToMods ? settings.reasonAutoArchiveSetting : !!data.autoArchive
	const initialSticky = leaveUpToMods ? settings.reasonStickySetting : !!data.typeStickied
	const initialCommentAsSub = leaveUpToMods
		? settings.reasonCommentAsSubredditSetting
		: !!data.typeCommentAsSubreddit
	const initialLockThread = leaveUpToMods ? settings.actionLockSetting : !!data.typeLockThread
	const initialLockComment = leaveUpToMods ? settings.actionLockCommentSetting : !!data.typeLockComment

	const parser = useMemo(() => getRemovalReasonParser(), [],)

	const tokenSource = useMemo<Record<string, string>>(() => ({
		subreddit: data.subreddit,
		fullname: data.fullname,
		id: data.id,
		author: data.author,
		title: data.title,
		kind: data.kind,
		mod: data.mod,
		url: data.url,
		link: data.link,
		domain: data.domain,
		logSub: data.logSub,
		body: data.body,
		raw_body: data.raw_body,
		uri_body: data.uri_body,
		uri_title: data.uri_title,
	}), [data,],)

	const headerHtml = useMemo(
		() => (data.header ? parser.render(replaceTokens(tokenSource, data.header,),) : ''),
		[data.header, parser, tokenSource,],
	)
	const footerHtml = useMemo(
		() => (data.footer ? parser.render(replaceTokens(tokenSource, data.footer,),) : ''),
		[data.footer, parser, tokenSource,],
	)

	// Render reason markdown once and keep both raw markdown + html so we can
	// walk the markdown later to substitute user inputs in the right order.
	// `markdown` is kept in token form for composition (handleSave replaces data
	// tokens there); `html` has data tokens substituted so the preview reflects
	// the actual post/comment context instead of showing raw placeholders.
	const renderedReasons = useMemo<RenderedReason[]>(() => {
		return visibleReasons.map((reason, reasonIndex,) => {
			// Normalize to token form up front (decoding entity-encoded angle brackets
			// first, so legacy &lt;select&gt; configs convert too): display rendering and
			// the value substitution in handleSave then both work from the same tokens,
			// resolved against the same merged select definitions.
			const {text: markdown, selects: extracted,} = htmlFieldsToTokens(
				decodeHtmlAngleBrackets(`${reason.text}\n\n`,),
				reason.selects ?? [],
			)
			const selects = [...reason.selects ?? [], ...extracted,]
			const html = renderReasonHtml(parser, replaceTokens(tokenSource, markdown,), selects,)
			return {id: `reason-${reasonIndex}`, reason, markdown, selects, html,}
		},)
	}, [visibleReasons, parser, tokenSource,],)

	// When re-opened to accept a proposal, map the captured selection's persistent reason
	// ids onto the overlay's positional ids (`reason-${index}`), skipping any reason that
	// no longer exists in the current config (deleted since capture). Drives the seeded
	// initial selection, order, and per-reason override text.
	const seeded = useMemo(() => {
		if (!seededFromIntent) { return null }
		const positionalByReasonId = new Map<string, string>()
		renderedReasons.forEach((r,) => {
			if (r.reason.id) { positionalByReasonId.set(r.reason.id, r.id,) }
		},)
		const positionalIds: string[] = []
		const overrides = new Map<string, string>()
		for (const sr of seededFromIntent.reasons) {
			const pos = positionalByReasonId.get(sr.id,)
			if (!pos) { continue }
			positionalIds.push(pos,)
			overrides.set(pos, sr.text,)
		}
		return {positionalIds, overrides,}
	}, [seededFromIntent, renderedReasons,],)

	// Suggested-reason pre-selection: map the matched persistent reason ids onto the
	// overlay's positional ids, skipping any reason not currently visible. Ignored
	// while seeding from a captured intent (that path drives its own selection).
	const suggestedPositionalIds = useMemo(() => {
		if (seededFromIntent || !suggestedReasonIds?.length) { return [] }
		const positionalByReasonId = new Map<string, string>()
		renderedReasons.forEach((r,) => {
			if (r.reason.id) { positionalByReasonId.set(r.reason.id, r.id,) }
		},)
		const ids: string[] = []
		for (const reasonId of suggestedReasonIds) {
			const pos = positionalByReasonId.get(reasonId,)
			if (pos) { ids.push(pos,) }
		}
		return ids
	}, [seededFromIntent, suggestedReasonIds, renderedReasons,],)
	const suggestedIdSet = useMemo(() => new Set(suggestedPositionalIds,), [suggestedPositionalIds,],)

	const [reasonOrder, setReasonOrder,] = useState<string[]>(() => {
		const natural = renderedReasons.map((r,) => r.id)
		if (!seeded || seeded.positionalIds.length === 0) { return natural }
		// Seeded reasons first (in captured order), then the rest.
		const seedSet = new Set(seeded.positionalIds,)
		return [...seeded.positionalIds, ...natural.filter((id,) => !seedSet.has(id,)),]
	},)
	const orderedReasons = useMemo(() => {
		const byId = new Map(renderedReasons.map((r,) => [r.id, r,]),)
		return reasonOrder.map((id,) => byId.get(id,)).filter(Boolean,) as RenderedReason[]
	}, [renderedReasons, reasonOrder,],)

	const [selected, setSelected,] = useState<Set<string>>(
		() => new Set(seeded?.positionalIds ?? suggestedPositionalIds,),
	)
	const [reasonType, setReasonType,] = useState<ReasonType>(
		seededFromIntent ? seededFromIntent.reasonType as ReasonType : initialReasonType,
	)
	const [reasonSticky, setReasonSticky,] = useState(
		seededFromIntent ? !!seededFromIntent.reasonSticky : initialSticky,
	)
	const [reasonAsSub, setReasonAsSub,] = useState(
		seededFromIntent ? !!seededFromIntent.reasonAsSub : initialReasonAsSub,
	)
	const [reasonAutoArchive, setReasonAutoArchive,] = useState(
		seededFromIntent ? !!seededFromIntent.reasonAutoArchive : initialAutoArchive,
	)
	const [reasonCommentAsSubreddit, setReasonCommentAsSubreddit,] = useState(
		seededFromIntent ? !!seededFromIntent.reasonCommentAsSubreddit : initialCommentAsSub,
	)
	const [actionLockThread, setActionLockThread,] = useState(
		seededFromIntent ? !!seededFromIntent.actionLockThread : initialLockThread,
	)
	const [actionLockComment, setActionLockComment,] = useState(
		seededFromIntent ? !!seededFromIntent.actionLockComment : initialLockComment,
	)
	const [includeHeader, setIncludeHeader,] = useState(
		seededFromIntent ? (seededFromIntent.includeHeader ?? true) : true,
	)
	const [includeFooter, setIncludeFooter,] = useState(
		seededFromIntent ? (seededFromIntent.includeFooter ?? true) : true,
	)
	const [logReasonText, setLogReasonText,] = useState(seededFromIntent?.logReasonText ?? (data.logReason || ''),)

	const [status, setStatus,] = useState('',)
	const [errorFields, setErrorFields,] = useState<Set<string>>(new Set(),)
	const [saving, setSaving,] = useState(false,)
	const [reasonOverrides, setReasonOverrides,] = useState<Map<string, string>>(() =>
		new Map(seeded?.overrides ?? [],)
	)
	const [editingId, setEditingId,] = useState<string | null>(null,)
	const [editDraft, setEditDraft,] = useState('',)

	const [leaveUsernote, setLeaveUsernote,] = useState(!!seededFromIntent?.usernote,)
	const [usernoteText, setUsernoteText,] = useState(seededFromIntent?.usernote?.text ?? '',)
	const [usernoteType, setUsernoteType,] = useState<string | undefined>(seededFromIntent?.usernote?.type,)
	/** Always-current ref so the sync effect can read usernoteText without depending on it. */
	const usernoteTextRef = useRef('',)
	usernoteTextRef.current = usernoteText
	/** The last note text we auto-set; used to detect user edits. */
	const autoNoteRef = useRef('',)
	const [usernoteIncludeLink, setUsernoteIncludeLink,] = useState(
		seededFromIntent ? !!seededFromIntent.usernote?.includeLink : true,
	)
	const [usernoteIncludeMessage, setUsernoteIncludeMessage,] = useState(
		seededFromIntent ? !!seededFromIntent.usernote?.includeMessage : true,
	)
	const [subredditColors, setSubredditColors,] = useState<UserNoteColor[] | null>(null,)
	const [colorsLoading, setColorsLoading,] = useState(false,)

	// One-shot guards: when seeding from a captured proposal, the `selected`/`usernoteType`
	// -driven effects below would clobber the pre-filled usernote/ban on their first
	// (mount) run. Each effect gets its OWN ref so whichever runs first can't consume a
	// shared flag and leave the others exposed. Cleared after the first skipped run.
	// Also guard the mount reset when we've pre-selected suggested reasons, so the suggested
	// pre-fill survives the first render the same way a seeded intent does (otherwise the reset
	// effect below wipes `selected` immediately).
	const reasonResetSeedConsumed = useRef(!!seededFromIntent || suggestedPositionalIds.length > 0,)
	const usernoteSeedConsumed = useRef(!!seededFromIntent,)
	const banSeedConsumed = useRef(!!seededFromIntent,)
	const banNoteSeedConsumed = useRef(!!seededFromIntent,)

	// Only the type and link requirements can block leaving a note here: the note
	// text auto-fills from the reason, and an empty note saves nothing at all (see
	// submitRemoval), so the text requirement is moot. Reuse the shared evaluator
	// (with text disabled) so the wording matches the usernote popup.
	const usernoteUnmetMessage = leaveUsernote && !!usernoteText.trim()
		? unmetUsernoteRequirement(
			{...usernoteRequire, text: false,},
			{
				hasText: true,
				hasType: usernoteType !== undefined,
				hasLink: usernoteIncludeLink,
				linkEnforceable: true,
			},
		)
		: null
	const usernoteRequirementUnmet = usernoteUnmetMessage !== null

	const [issueBan, setIssueBan,] = useState(!!seededFromIntent?.ban,)
	const [banPermanent, setBanPermanent,] = useState(!!seededFromIntent?.ban?.permanent,)
	const [banDays, setBanDays,] = useState(seededFromIntent?.ban?.days ?? 7,)
	const [banNote, setBanNote,] = useState(seededFromIntent?.ban?.note ?? '',)

	const reasonContentRefs = useRef<Map<string, HTMLDivElement>>(new Map(),)
	const sensors = useSensors(
		useSensor(PointerSensor,),
		useSensor(KeyboardSensor, {coordinateGetter: sortableKeyboardCoordinates,},),
	)

	const showLogReasonInput = !!data.logSub && data.logTitle.indexOf('{reason}',) >= 0
	const showSelectNone = !!data.logSub

	useEffect(() => {
		// Skip the mount run when seeded, so it doesn't wipe the pre-filled selection/order.
		if (reasonResetSeedConsumed.current) {
			reasonResetSeedConsumed.current = false
			return
		}
		setReasonOrder(renderedReasons.map((r,) => r.id),)
		setSelected(new Set(),)
	}, [renderedReasons,],)

	// Pre-fill / persist user-input values inside the rendered reason HTML.
	useEffect(() => {
		const cleanups: (() => void)[] = []
		reasonContentRefs.current.forEach((element, _id,) => {
			const inputs = element.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
				'input[id], textarea[id], select[id]',
			)
			inputs.forEach((input,) => {
				const baseId = input.id
				if (!baseId) { return }
				const cacheKey = `reason-input-${data.subreddit}-${baseId}`
				input.id = cacheKey
				const isRadioGroupInput = (input as HTMLInputElement).type === 'hidden'
					&& !!input.closest('.toolbox-radio-group',)
				getCache(removalReasons, cacheKey, input.value,).then((value,) => {
					if (value != null) {
						input.value = value as string
						// Sync radio checked state after restoring from cache.
						if (isRadioGroupInput) {
							syncRadiosToHiddenInput(input as HTMLInputElement,)
						}
					}
				},)
				const onChange = () => {
					setCache(removalReasons, cacheKey, input.value,)
				}
				input.addEventListener('change', onChange,)
				cleanups.push(() => input.removeEventListener('change', onChange,))

				// Wire radio buttons in the group to push their value into the hidden input.
				if (isRadioGroupInput) {
					element.querySelectorAll<HTMLInputElement>(
						`input[type="radio"][data-sync-select="${baseId}"]`,
					).forEach((radio,) => {
						const onRadioChange = () => {
							if (radio.checked) {
								;(input as HTMLInputElement).value = radio.value
								input.dispatchEvent(new Event('change',),)
							}
						}
						radio.addEventListener('change', onRadioChange,)
						cleanups.push(() => radio.removeEventListener('change', onRadioChange,))
					},)
				}
			},)
		},)
		return () => {
			cleanups.forEach((fn,) => fn())
		}
	}, [renderedReasons, data.subreddit,],)

	// When selection changes, update display of title-reason content blocks.
	useEffect(() => {
		reasonContentRefs.current.forEach((element, id,) => {
			const reason = renderedReasons.find((r,) => r.id === id)?.reason
			if (reason?.title) {
				element.style.display = selected.has(id,) ? '' : 'none'
			}
		},)
	}, [selected, renderedReasons,],)

	// Keep the usernote in sync with the selected reasons: concatenate default notes from all
	// selected reasons that have one (in display order), or clear if none do.
	// Only overwrites the note text if the user hasn't edited it since the last auto-fill;
	// deselecting all reasons always clears regardless of user edits.
	// orderedReasons is included so a drag-and-drop reorder re-evaluates the combined text.
	useEffect(() => {
		// Seeded mount run: keep the pre-filled usernote text/type instead of recomputing.
		if (usernoteSeedConsumed.current) {
			usernoteSeedConsumed.current = false
			return
		}
		const matches = orderedReasons.filter((r,) => selected.has(r.id,) && r.reason.default_note)
		if (matches.length > 0) {
			const autoText = matches.map((r,) => r.reason.default_note!).join(', ',)
			if (usernoteTextRef.current === autoNoteRef.current) {
				setUsernoteText(autoText,)
			}
			autoNoteRef.current = autoText
			setUsernoteType(matches.find((r,) => r.reason.default_note_type)?.reason.default_note_type ?? undefined,)
			void handleLeaveUsernoteToggle(true,)
		} else {
			autoNoteRef.current = ''
			setUsernoteText('',)
			setUsernoteType(undefined,)
			setLeaveUsernote(false,)
		}
	}, [selected, orderedReasons,],) // eslint-disable-line react-hooks/exhaustive-deps

	// When the selected note type has an auto-ban duration, pre-populate the Issue Ban section.
	// Both usernoteType and subredditColors are in deps: colors may load after the type is auto-filled,
	// so we need to re-run once colors arrive.
	useEffect(() => {
		if (usernoteType === undefined || !subredditColors) { return }
		// Guard AFTER the colors-present check: the seeded mount run returns above with
		// colors still null, so consume the one-shot on the first run that would actually
		// act (once colors load) - preserving a seeded ban that differs from the type default.
		if (banSeedConsumed.current) {
			banSeedConsumed.current = false
			return
		}
		const color = subredditColors.find((c,) => c.key === usernoteType)
		if (color?.banDuration !== undefined) {
			setIssueBan(true,)
			setBanPermanent(color.banDuration === 0,)
			if (color.banDuration > 0) { setBanDays(color.banDuration,) }
		}
	}, [usernoteType, subredditColors,],) // eslint-disable-line react-hooks/exhaustive-deps

	// Keep the ban note in sync with the usernote text when a ban is being issued.
	useEffect(() => {
		// Seeded mount run: keep the pre-filled ban note instead of mirroring the usernote.
		if (banNoteSeedConsumed.current) {
			banNoteSeedConsumed.current = false
			return
		}
		if (issueBan) { setBanNote(usernoteText.slice(0, 300,),) }
	}, [usernoteText, issueBan,],)

	// Seeded with a usernote: load the subreddit's note colors on mount so the type chip
	// renders. The auto-fill effect that normally triggers this is skipped while seeding.
	useEffect(() => {
		if (!seededFromIntent?.usernote || subredditColors !== null || colorsLoading) { return }
		setColorsLoading(true,)
		void getSubredditColors(data.subreddit,)
			.then((c,) => setSubredditColors(c,))
			.finally(() => setColorsLoading(false,))
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [],)

	const handleLeaveUsernoteToggle = async (checked: boolean,) => {
		setLeaveUsernote(checked,)
		if (checked && subredditColors === null && !colorsLoading) {
			setColorsLoading(true,)
			try {
				setSubredditColors(await getSubredditColors(data.subreddit,),)
			} finally {
				setColorsLoading(false,)
			}
		}
	}

	const toggleSelected = (id: string,) => {
		if (editingId === id) { setEditingId(null,) }
		setSelected((prev,) => {
			const next = new Set(prev,)
			if (next.has(id,)) { next.delete(id,) }
			else { next.add(id,) }
			return next
		},)
	}

	const handleReasonEdit = (id: string,) => {
		const item = orderedReasons.find((r,) => r.id === id)
		if (!item) { return }
		setEditDraft(reasonOverrides.get(id,) ?? item.markdown.trimEnd(),)
		setEditingId(id,)
	}
	const handleReasonEditSave = () => {
		if (editingId) {
			setReasonOverrides((prev,) => new Map(prev,).set(editingId, editDraft,))
		}
		setEditingId(null,)
	}
	const handleReasonEditCancel = () => setEditingId(null,)

	const handleReasonDragEnd = (event: DragEndEvent,) => {
		const {active, over,} = event
		if (over && active.id !== over.id) {
			setReasonOrder((prev,) => {
				const oldIndex = prev.indexOf(String(active.id,),)
				const newIndex = prev.indexOf(String(over.id,),)
				if (oldIndex < 0 || newIndex < 0) { return prev }
				return arrayMove(prev, oldIndex, newIndex,)
			},)
		}
	}

	const setError = (field: string,) => {
		setErrorFields((prev,) => {
			const next = new Set(prev,)
			next.add(field,)
			return next
		},)
	}

	const clearErrors = () => setErrorFields(new Set(),)

	const handleNoReason = async () => {
		if (saving) { return }
		setSaving(true,)
		setStatus(statusDefaultText,)
		const ctx = {
			subreddit: data.subreddit,
			itemId: data.fullname,
			itemKind: (data.kind === 'comment' ? 'comment' : 'post') as 'comment' | 'post',
			link: data.url,
		}
		try {
			// On the accept surface (Edit-&-Accept) always perform the removal - never
			// re-capture it as a new proposal, even if the accepting reviewer is themselves
			// a trainee in this subreddit (which would otherwise orphan the original
			// proposal and create a duplicate).
			if (seededFromIntent?.bypassCapture) {
				await performRemoval(ctx, false,)
			} else {
				const outcome = await proposeOrRemove(ctx, false,)
				if (outcome === 'captured') {
					positiveTextFeedback('Removal sent for review',)
					onClose()
					return
				}
			}
			requestCounterRefresh()
			onRemoved?.()
			onClose()
		} catch {
			setStatus(removeError,)
			setSaving(false,)
		}
	}

	const handleCancel = () => {
		if (saving) { return }
		onClose()
	}

	/**
	 * Composes the resolved removal params from the current form state, or returns
	 * null after surfacing a validation error. Shared by Send and Request review.
	 */
	const composeParams = (): {params: SubmitRemovalParams; selection: FrozenRemovalSelection} | null => {
		// Iterate visible reasons in current order, but only keep selected ones.
		const checkedOrdered = orderedReasons.filter((item,) => selected.has(item.id,))

		if (!checkedOrdered.length && reasonType !== 'none') {
			setError('reasonTable',)
			setStatus(noReasonError,)
			return null
		}

		const composed = composeReasonText(
			checkedOrdered,
			(id,) => (editingId === id ? editDraft : reasonOverrides.get(id,)),
			(id,) => {
				const contentEl = reasonContentRefs.current.get(id,)
				const inputValues: string[] = []
				if (contentEl) {
					// Exclude radio inputs: each select is represented by a hidden <input type="hidden">
					// inside .toolbox-radio-group whose value reflects the currently-checked radio,
					// so we don't double-count the individual radio inputs.
					contentEl.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
						'select, input:not([type="radio"]), textarea',
					).forEach((input,) => {
						inputValues.push(input.value || '',)
					},)
				}
				return inputValues
			},
		)

		let reason = composed.reason
		if (includeHeader && data.header) { reason = `${data.header}\n\n${reason}` }
		if (includeFooter && data.footer) { reason += `\n\n${data.footer}` }
		reason = replaceTokens(tokenSource, reason,).trim()

		// Selected reason titles, for review display (omit when none have a title).
		const reasonTitle = checkedOrdered.map((item,) => item.reason.title).filter(Boolean,).join(', ',)

		// Structured selection captured alongside the message, to re-seed the overlay on
		// Edit & Accept. The header/footer flags are stored only when one is configured.
		const selection: FrozenRemovalSelection = {reasons: composed.pieces,}
		if (data.header) { selection.includeHeader = includeHeader }
		if (data.footer) { selection.includeFooter = includeFooter }

		const params: SubmitRemovalParams = {
			data,
			reasonText: reason,
			...(reasonTitle ? {reasonTitle,} : {}),
			flairText: composed.flairText.trim(),
			flairCSS: composed.flairCSS.trim(),
			flairTemplateID: composed.flairTemplateID,
			subject: replaceTokens(tokenSource, data.subject,),
			baseLogTitle: replaceTokens(tokenSource, data.logTitle,),
			logReasonText,
			reasonType,
			reasonSticky,
			reasonAsSub,
			reasonAutoArchive,
			reasonCommentAsSubreddit,
			actionLockThread,
			actionLockComment,
			...(spam ? {spam,} : {}),
			leaveUsernote,
			usernoteText,
			usernoteType,
			usernoteIncludeLink,
			usernoteIncludeMessage,
			subredditColors,
			issueBan,
			banPermanent,
			banDays,
			banNote,
		}
		return {params, selection,}
	}

	/** Proposal context for the current thing; `force` requests review explicitly. */
	const proposalCtx = (force: boolean,) => ({
		subreddit: data.subreddit,
		itemId: data.fullname,
		itemKind: (data.kind === 'comment' ? 'comment' : 'post') as 'comment' | 'post',
		link: data.url,
		...(force ? {force: true,} : {}),
	})

	const handleSave = async () => {
		if (saving) { return }
		clearErrors()
		setStatus(statusDefaultText,)
		const composed = composeParams()
		if (!composed) { return }
		const {params, selection,} = composed

		setSaving(true,)
		// A reviewer accepting an edited proposal performs the removal directly; never
		// re-capture it as a new proposal (the overlay is the accept surface here).
		if (!seededFromIntent?.bypassCapture) {
			// Training mode: capture the fully-composed removal as a proposal for review
			// instead of performing it (freezeRemovalParams snapshots the resolved intent).
			const captured = await maybePropose(
				{type: 'removal-reason', intent: freezeRemovalParams(params, selection,),},
				proposalCtx(false,),
			)
			if (captured) {
				setSaving(false,)
				positiveTextFeedback('Removal sent for review',)
				onClose()
				return
			}
		} else if (beforePerform) {
			// Edit & Accept: claim the proposal in one atomic write before performing, so a
			// second reviewer accepting the same proposal can't double-apply the removal.
			const gate = await beforePerform()
			if (!gate.ok) {
				setSaving(false,)
				setStatus(gate.message,)
				return
			}
		}

		// Perform path: either a non-trainee, or a trainee whose sub doesn't guard
		// `removal-reason`. Run the whole composite pipeline (its inner removeThing + message
		// primitives) in an authorized replay window so the fail-closed capture backstop lets
		// it through regardless of whether plain `remove` is independently guarded. The accept
		// surface (bypassCapture) likewise performs here. A no-op authorization for non-trainees.
		const result = await runInReplay(() => submitRemoval(params, setStatus,))

		if (result.ok) {
			setSaving(false,)
			requestCounterRefresh()
			onRemoved?.()
			onClose()
		} else {
			setSaving(false,)
			// Release any claim placed by beforePerform so this failed accept doesn't block a
			// retry (a no-op for non-accept removals, which pass no handler).
			onPerformError?.()
			if (result.errorField) { setError(result.errorField,) }
			setStatus(result.error,)
		}
	}

	/** Explicitly captures the composed removal for a second opinion (force review),
	 *  even when the current moderator is not in training mode. */
	const handleRequestReview = async () => {
		if (saving) { return }
		clearErrors()
		setStatus(statusDefaultText,)
		const composed = composeParams()
		if (!composed) { return }
		const {params, selection,} = composed

		setSaving(true,)
		try {
			await maybePropose(
				{type: 'removal-reason', intent: freezeRemovalParams(params, selection,),},
				proposalCtx(true,),
			)
			positiveTextFeedback('Sent for a second opinion',)
			onClose()
		} catch {
			setSaving(false,)
			setStatus('Could not send for review',)
		}
	}

	const headerDisplay = !!data.header
	const footerDisplay = !!data.footer
	const forcedSettingsSummary = [
		reasonType === 'reply' && 'Reply with a comment',
		reasonType === 'pm' && (reasonAsSub ? `Send modmail as /r/${data.subreddit}` : 'Send as Modmail'),
		reasonType === 'both'
		&& `Reply with a comment and ${reasonAsSub ? `send modmail as /r/${data.subreddit}` : 'send as Modmail'}`,
		reasonType === 'none' && 'Log the removal without sending a message',
		reasonSticky && isSubmission && 'Sticky the removal comment',
		actionLockComment && 'Lock the removal comment',
		reasonCommentAsSubreddit && `Send the reply as /u/${data.subreddit}-ModTeam`,
		reasonAutoArchive && 'Auto-archive sent modmail',
		actionLockThread && isSubmission && 'Lock the removed thread',
	].filter(Boolean,) as string[]
	const itemLabel = data.title || (data.kind === 'comment' ? 'this comment' : 'this submission')
	const domainLink = getDomainLink(data.domain,)
	const replyOptions = (
		<div className={css.subOptions}>
			<CheckboxInput
				label="Sticky the removal comment"
				disabled={!isSubmission}
				checked={reasonSticky && isSubmission}
				onChange={(event,) => setReasonSticky(event.target.checked,)}
			/>
			<CheckboxInput
				label="Lock the removal comment"
				checked={actionLockComment}
				onChange={(event,) => setActionLockComment(event.target.checked,)}
			/>
			<CheckboxInput
				label={`Send as /u/${data.subreddit}-ModTeam`}
				checked={reasonCommentAsSubreddit}
				onChange={(event,) => setReasonCommentAsSubreddit(event.target.checked,)}
			/>
		</div>
	)
	const modmailOptions = (
		<div className={css.subOptions}>
			<CheckboxInput
				label={`Send via modmail as /r/${data.subreddit}`}
				checked={reasonAsSub}
				onChange={(event,) => setReasonAsSub(event.target.checked,)}
			/>
			{reasonAsSub && (
				<p className={css.subNote}>Note: this will clutter up modmail.</p>
			)}
			<CheckboxInput
				label="Auto-archive sent Modmail"
				checked={reasonAutoArchive}
				onChange={(event,) => setReasonAutoArchive(event.target.checked,)}
			/>
		</div>
	)

	const overlayTitle = `Removal reasons for /r/${data.subreddit}`

	const overlayFooter = (
		<>
			<span
				className={status && status !== statusDefaultText
					? `${css.status} ${css.statusError}`
					: css.status}
			>
				{status}
			</span>
			<ActionButton primary onClick={handleSave} disabled={saving || usernoteRequirementUnmet}>Send</ActionButton>
			{!seededFromIntent?.bypassCapture && (
				<ActionButton
					onClick={handleRequestReview}
					disabled={saving || usernoteRequirementUnmet}
					title="Capture this removal for another moderator to review instead of performing it"
				>
					Request second opinion
				</ActionButton>
			)}
			<ActionButton onClick={handleNoReason} disabled={saving}>Silently remove</ActionButton>
			<ActionButton onClick={handleCancel} disabled={saving}>Cancel</ActionButton>
		</>
	)

	const overlayContent = (
		<div className={css.scrollContent}>
			<div className={css.contextHeader}>
				<div className={css.contextEyebrow}>Removing {data.kind}</div>
				<div className={css.contextMeta}>
					<a href={`/r/${data.subreddit}`} target="_blank" rel="noreferrer">
						/r/{data.subreddit}
					</a>
					{data.author && (
						<a href={`/u/${data.author}`} target="_blank" rel="noreferrer">
							u/{data.author}
						</a>
					)}
					{domainLink && (
						<a href={domainLink} target="_blank" rel="noreferrer">
							{data.domain}
						</a>
					)}
				</div>
				<div className={css.contextMain}>
					<a className={css.contextTitle} href={data.url} target="_blank" rel="noreferrer">
						{itemLabel}
					</a>
				</div>
			</div>

			<Section title="Message pieces">
				{headerDisplay && (
					<div className={css.messagePiece}>
						<CheckboxInput
							className={css.includeToggle}
							aria-label="Include header"
							label="Include header"
							checked={includeHeader}
							onChange={(event,) => setIncludeHeader(event.target.checked,)}
						/>
						{includeHeader && (
							<div
								className={css.reasonPreview}
								dangerouslySetInnerHTML={{__html: headerHtml,}}
							/>
						)}
					</div>
				)}

				{suggestedPositionalIds.length > 0 && (
					<div className={css.suggestedNotice}>
						<span>
							{suggestedPositionalIds.length} reason{suggestedPositionalIds.length === 1 ? '' : 's'}{' '}
							pre-selected from this item's reports.
						</span>
						{suggestedPositionalIds.some((id,) => selected.has(id,)) && (
							<button
								type="button"
								className={css.suggestedClear}
								onClick={() =>
									setSelected((prev,) => {
										const next = new Set(prev,)
										for (const id of suggestedPositionalIds) { next.delete(id,) }
										return next
									},)}
							>
								Clear suggested
							</button>
						)}
					</div>
				)}

				<div
					className={`${css.reasonPicker} ${errorFields.has('reasonTable',) ? css.errorHighlight : ''}`}
				>
					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						onDragEnd={handleReasonDragEnd}
					>
						<SortableContext
							items={orderedReasons.map((reason,) => reason.id)}
							strategy={verticalListSortingStrategy}
						>
							<div className={css.reasonCardList}>
								{orderedReasons.map((reason, reasonIndex,) => (
									<SortableReasonCard
										key={reason.id}
										item={reason}
										position={reasonIndex}
										selected={selected.has(reason.id,)}
										suggested={suggestedIdSet.has(reason.id,)}
										onToggle={() => toggleSelected(reason.id,)}
										isEditing={editingId === reason.id}
										editDraft={editDraft}
										overrideHtml={reasonOverrides.has(reason.id,)
											? renderReasonHtml(
												parser,
												replaceTokens(tokenSource, reasonOverrides.get(reason.id,)!,),
												reason.selects,
											)
											: undefined}
										onEdit={() => handleReasonEdit(reason.id,)}
										onEditDraftChange={setEditDraft}
										onEditSave={handleReasonEditSave}
										onEditCancel={handleReasonEditCancel}
										setContentRef={(element,) => {
											if (element) { reasonContentRefs.current.set(reason.id, element,) }
											else { reasonContentRefs.current.delete(reason.id,) }
										}}
									/>
								))}
							</div>
						</SortableContext>
					</DndContext>
				</div>

				{footerDisplay && (
					<div className={css.messagePiece}>
						<CheckboxInput
							className={css.includeToggle}
							aria-label="Include footer"
							label="Include footer"
							checked={includeFooter}
							onChange={(event,) => setIncludeFooter(event.target.checked,)}
						/>
						{includeFooter && (
							<div
								className={css.reasonPreview}
								dangerouslySetInnerHTML={{__html: footerHtml,}}
							/>
						)}
					</div>
				)}

				{showLogReasonInput && (
					<div className={css.logReason}>
						<label className={css.fieldLabel} htmlFor="removal-log-reason">
							Log reason
						</label>
						<input
							id="removal-log-reason"
							type="text"
							className={`${css.logReasonInput} ${
								errorFields.has('logReasonInput',) ? css.errorHighlight : ''
							}`}
							value={logReasonText}
							onChange={(event,) => setLogReasonText(event.target.value,)}
						/>
						<p className={css.fieldHint}>
							Used for posting a log to /r/{data.logSub}. Only used when Send is clicked.
						</p>
					</div>
				)}
			</Section>

			<div className={css.messagePiece}>
				<CheckboxInput
					className={css.includeToggle}
					label="Leave a usernote for this user"
					checked={leaveUsernote}
					onChange={(event,) => void handleLeaveUsernoteToggle(event.target.checked,)}
				/>
				{leaveUsernote && (
					<div className={css.subOptions}>
						{colorsLoading
							? <p className={css.fieldHint}>Loading note types...</p>
							: subredditColors && (
								<div className={css.noteTypeChips}>
									{subredditColors.map((color,) => (
										<button
											key={color.key}
											type="button"
											className={classes(
												css.noteTypeChip,
												usernoteType === color.key && css.noteTypeChipSelected,
											)}
											style={{color: color.color,}}
											onClick={() =>
												setUsernoteType((prev,) => prev === color.key ? undefined : color.key)}
										>
											{color.text}
										</button>
									))}
								</div>
							)}
						<input
							type="text"
							className={css.logReasonInput}
							placeholder="Note text"
							value={usernoteText}
							onChange={(event,) => setUsernoteText(event.target.value,)}
						/>
						<CheckboxInput
							label="Include link to removed item"
							checked={usernoteIncludeLink}
							onChange={(event,) => setUsernoteIncludeLink(event.target.checked,)}
						/>
						{/* Only modmail delivery produces a linkable removal message. */}
						{reasonAsSub && (reasonType === 'pm' || reasonType === 'both') && (
							<CheckboxInput
								label="Include link to removal message"
								checked={usernoteIncludeMessage}
								onChange={(event,) => setUsernoteIncludeMessage(event.target.checked,)}
							/>
						)}
						{usernoteUnmetMessage && (
							<p className={css.fieldHint}>{usernoteUnmetMessage}</p>
						)}
					</div>
				)}
			</div>

			<div className={css.messagePiece}>
				<CheckboxInput
					className={css.includeToggle}
					label="Issue a ban as part of this removal"
					checked={issueBan}
					onChange={(event,) => setIssueBan(event.target.checked,)}
				/>
				{issueBan && (
					<div className={css.subOptions}>
						<CheckboxInput
							label="Permanent ban"
							checked={banPermanent}
							onChange={(event,) => setBanPermanent(event.target.checked,)}
						/>
						{!banPermanent && (
							<label className={css.deliveryLabel}>
								Duration:
								<input
									type="number"
									min={1}
									max={999}
									value={banDays}
									onChange={(event,) => {
										const v = parseInt(event.target.value, 10,)
										if (!isNaN(v,) && v >= 1 && v <= 999) { setBanDays(v,) }
									}}
									style={{width: '60px', marginLeft: '6px',}}
								/>
								<span style={{marginLeft: '4px',}}>days</span>
							</label>
						)}
						<div className={css.logReason}>
							<label className={css.fieldLabel} htmlFor="ban-note-input">
								Internal ban note (mod log only, ≤300 chars)
							</label>
							<input
								id="ban-note-input"
								type="text"
								className={css.logReasonInput}
								maxLength={300}
								value={banNote}
								onChange={(event,) => setBanNote(event.target.value,)}
							/>
						</div>
						{(reasonType === 'pm' || reasonType === 'both') && (
							<p className={css.subNote}>
								The removal message will be sent as the ban notice. No separate Modmail will be sent to
								the user.
							</p>
						)}
					</div>
				)}
			</div>

			<Section title="Delivery settings">
				{forced
					? (
						<div className={css.forcedSettingsSummary}>
							<div className={css.forcedSettingsTitle}>
								This subreddit requires moderators to use these removal settings.
							</div>
							<ul>
								{forcedSettingsSummary.map((item,) => <li key={item}>{item}</li>)}
							</ul>
						</div>
					)
					: (
						<div
							className={`${css.deliverySettings} ${
								errorFields.has('buttons',) ? css.errorHighlight : ''
							}`}
						>
							<DeliveryOption selected={reasonType === 'reply'}>
								<label className={css.deliveryLabel}>
									<input
										type="radio"
										name={`type-${data.subreddit}`}
										value="reply"
										checked={reasonType === 'reply'}
										onChange={() => setReasonType('reply',)}
									/>
									Reply with a comment to the removed item
								</label>
								{reasonType === 'reply' && replyOptions}
							</DeliveryOption>

							<DeliveryOption selected={reasonType === 'pm'}>
								<label className={css.deliveryLabel}>
									<input
										type="radio"
										name={`type-${data.subreddit}`}
										value="pm"
										checked={reasonType === 'pm'}
										onChange={() => setReasonType('pm',)}
									/>
									Send as Modmail
								</label>
								{reasonType === 'pm' && modmailOptions}
							</DeliveryOption>

							<DeliveryOption selected={reasonType === 'both'}>
								<label className={css.deliveryLabel}>
									<input
										type="radio"
										name={`type-${data.subreddit}`}
										value="both"
										checked={reasonType === 'both'}
										onChange={() => setReasonType('both',)}
									/>
									Both comment reply and Modmail
								</label>
								{reasonType === 'both' && (
									<div className={css.combinedOptions}>
										<div className={css.subGroupLabel}>Comment options</div>
										{replyOptions}
										<div className={css.subGroupLabel}>Modmail options</div>
										{modmailOptions}
									</div>
								)}
							</DeliveryOption>

							{showSelectNone && (
								<DeliveryOption selected={reasonType === 'none'}>
									<label className={css.deliveryLabel}>
										<input
											type="radio"
											name={`type-${data.subreddit}`}
											value="none"
											checked={reasonType === 'none'}
											onChange={() => setReasonType('none',)}
										/>
										Log the removal without sending a message
									</label>
								</DeliveryOption>
							)}

							<div className={css.deliverySeparator}>
								<CheckboxInput
									label="Lock the removed thread"
									disabled={!isSubmission}
									checked={actionLockThread && isSubmission}
									onChange={(event,) => setActionLockThread(event.target.checked,)}
								/>
							</div>
						</div>
					)}
			</Section>
		</div>
	)

	if (drawerMode) {
		return (
			<PushDrawer
				widthPx={drawerWidthPx}
				pushMediaQuery={drawerPushMediaQuery}
				className={css.drawerRoot ?? ''}
				onClose={onClose}
			>
				<Window
					title={overlayTitle}
					onClose={onClose}
					className={`${css.overlay} ${css.drawerWindow}`}
					footer={overlayFooter}
				>
					{overlayContent}
				</Window>
			</PushDrawer>
		)
	}

	return (
		<FullPageDialog
			title={overlayTitle}
			onClose={onClose}
			className={css.overlay}
			backdropClassName={css.popupBackdrop}
			footer={overlayFooter}
		>
			{overlayContent}
		</FullPageDialog>
	)
}

/**
 * Mounts the RemovalReasonsOverlay as a popup and returns a cleanup function.
 * @param props Overlay props; `onClose` is optional and supplemented by unmount logic.
 */
export function showRemovalReasonsOverlay (
	props: Omit<RemovalReasonsOverlayProps, 'onClose'> & {onClose?: () => void},
) {
	return mountPopup((onClose,) => <RemovalReasonsOverlay {...props} onClose={onClose} />, props.onClose,)
}
