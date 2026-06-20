/**
 * The proposals review drawer - the central review surface, shown as a 2-pane push
 * drawer (like Subreddit Notes): a sidebar list (Review queue / My proposals) and a
 * detail pane for the selected proposal with its actions.
 *
 * The drawer aggregates proposals across **every subreddit the user moderates**, not
 * just the current one: it lazily fans out (bounded-concurrency) to each modded sub's
 * proposals page on open. The current subreddit's proposals are grouped first so the
 * cross-sub view stays oriented. Reads go through the selectors and re-render on
 * proposals-changed events; the drawer never performs a moderation action directly
 * (accept replays through the gateway, scoped to each proposal's own subreddit).
 */

import {type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState,} from 'react'

import {getCurrentUser,} from '../../../api/resources/me'
import {getModSubs,} from '../../../api/resources/modSubs'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {Icon,} from '../../../shared/controls/Icon'
import {reactAlert,} from '../../../shared/controls/ReactAlert'
import {RelativeTime,} from '../../../shared/controls/RelativeTime'
import {PushDrawer,} from '../../../shared/window/PushDrawer'
import {Window,} from '../../../shared/window/Window'
import {negativeTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import {nowInSeconds,} from '../../../util/data/time'
import createLogger from '../../../util/infra/logging'
import {classes, mountPopup,} from '../../../util/ui/reactMount'
import {getConfig,} from '../../config/moduleapi'
import type {RemovalReasonsOverlayPreseed,} from '../../removalreasons/components/RemovalReasonsOverlay'
import {openRemovalOverlayForProposal,} from '../../removalreasons/dom'
import {onProposalsChanged,} from '../../shared/proposals/events'
import {performProposal,} from '../../shared/proposals/gateway'
import {
	claimProposalForReplay,
	dismissProposal,
	loadProposals,
	loadProposalsForSubs,
	rejectProposal,
	releaseProposalClaim,
	transitionProposal,
} from '../../shared/proposals/moduleapi'
import {
	myProposalsAcross,
	openProposalsAcross,
	type ProposalAt,
	type SubredditProposals,
} from '../../shared/proposals/selectors'
import {sameSub,} from '../../shared/proposals/subreddits'
import {isTraineeFor,} from '../../shared/proposals/traineeState'
import {ProposalDetail,} from './ProposalDetail'
import {defaultFilters, filterOptions, filterSortProposals, type ProposalFilters,} from './proposalFilter'
import {ProposalFilterBar,} from './ProposalFilterBar'
import {ProposalSpinner,} from './ProposalSpinner'
import css from './ProposalsReviewPopup.module.css'
import {describeAction, describeStatus, isAging, itemKindLabel, proposalExcerpt,} from './proposalView'

const log = createLogger('TBProposals',)

/** Page-push width for the drawer. Keep in sync with `.drawerRoot { width }` in the module CSS. */
const DRAWER_WIDTH_PX = 720
const DRAWER_PUSH_MEDIA_QUERY = '(min-width: 1120px)'
/** Refresh a subreddit's cache on open when it's older than this (ms). */
const FANOUT_MAX_AGE_MS = 60_000

/** Props for the review drawer. */
interface Props {
	/** The subreddit in the user's current page context (grouped first); may be empty. */
	currentSubreddit: string
	/** Called when the drawer closes. */
	onClose: () => void
}

/**
 * Reads a subreddit's resolved-proposal retention window (days) so a resolve write can
 * opportunistically prune in the same pass. Returns `undefined` (skip pruning, never
 * clobber) when the config or setting can't be read.
 * @param subreddit The subreddit whose retention setting to read.
 */
async function retentionDaysFor (subreddit: string,): Promise<number | undefined> {
	try {
		const config = await getConfig(subreddit,)
		const days = config?.proposalRetentionDays
		return typeof days === 'number' && days > 0 ? days : undefined
	} catch {
		return undefined
	}
}

/**
 * Splits proposals into those in `currentSubreddit` and everything else. With no current-sub
 * context, every item is treated as "others" so callers fall back to a flat/unordered view.
 * @param items The proposals to split.
 * @param currentSubreddit The page's subreddit, or empty string.
 */
function splitByCurrentSub (
	items: ProposalAt[],
	currentSubreddit: string,
): {current: ProposalAt[]; others: ProposalAt[]} {
	if (!currentSubreddit) { return {current: [], others: items,} }
	return {
		current: items.filter((at,) => sameSub(at.subreddit, currentSubreddit,)),
		others: items.filter((at,) => !sameSub(at.subreddit, currentSubreddit,)),
	}
}

/**
 * Orders proposals so the current page's subreddit comes first, matching how the
 * grouped list renders. With no current-sub context the input order is preserved.
 * @param items The proposals to order.
 * @param currentSubreddit The page's subreddit, or empty string.
 */
function orderByCurrentSub (items: ProposalAt[], currentSubreddit: string,): ProposalAt[] {
	const {current, others,} = splitByCurrentSub(items, currentSubreddit,)
	return [...current, ...others,]
}

/** The review drawer body. */
function ProposalsReviewPopup ({currentSubreddit, onClose,}: Props,) {
	// `null` until the first fan-out resolves (drives the loading state).
	const [entries, setEntries,] = useState<SubredditProposals[] | null>(null,)
	const [view, setView,] = useState<'review' | 'mine'>('review',)
	const [selected, setSelected,] = useState<{subreddit: string; id: string} | null>(null,)
	const [currentUser, setCurrentUser,] = useState('',)
	// Per-subreddit trainee status for the current user; gates the Accept button so a
	// trainee can't accept in a sub where they're sandboxed. `undefined` = not resolved.
	const [traineeBySub, setTraineeBySub,] = useState<Record<string, boolean>>({},)
	const [busy, setBusy,] = useState<{subreddit: string; id: string} | null>(null,)
	const [rejecting, setRejecting,] = useState(false,)
	const [feedbackDraft, setFeedbackDraft,] = useState('',)
	const [filters, setFilters,] = useState<ProposalFilters>(defaultFilters,)
	// Subreddits whose last fan-out read failed; drives the retry banner.
	const [failedSubs, setFailedSubs,] = useState<string[]>([],)
	// True while a manual refresh / retry fan-out is in flight (header button spinner).
	const [refreshing, setRefreshing,] = useState(false,)
	// The user's moderated subs, resolved once on mount and reused by refresh/retry.
	const modSubsRef = useRef<string[] | null>(null,)
	// The detail pane, so Enter in the list can move focus to its primary action.
	const paneRef = useRef<HTMLDivElement>(null,)
	// Flipped on unmount so async fan-outs started before unmount don't setState after.
	const mountedRef = useRef(true,)

	/** Replaces a single subreddit's entry in place (after a mutation to it). */
	function patchSub (subreddit: string, data: SubredditProposals['data'],) {
		setEntries((prev,) => {
			if (!prev) { return prev }
			const idx = prev.findIndex((e,) => sameSub(e.subreddit, subreddit,))
			if (idx === -1) { return [...prev, {subreddit, data,},] }
			const next = prev.slice()
			next[idx] = {subreddit, data,}
			return next
		},)
	}

	/**
	 * Fans out to the given subreddits and merges the result into `entries`, recording
	 * any that failed for the retry banner. Used by the initial load, the header Refresh
	 * button (all subs, forced) and the banner Retry (only the previously-failed subs).
	 * @param subs Subreddits to read.
	 * @param force When true, bypass the freshness window and re-fetch every sub.
	 */
	async function runFanout (subs: readonly string[], force: boolean,) {
		// Guard here so callers don't each have to check: a fan-out already in flight wins.
		if (refreshing) { return }
		setRefreshing(true,)
		try {
			const {entries: loaded, failedSubs: failed,} = await loadProposalsForSubs(
				subs,
				{maxAgeMs: force ? 0 : FANOUT_MAX_AGE_MS,},
			)
			if (!mountedRef.current) { return }
			// On a partial retry, splice the freshly-read subs into the existing list
			// rather than replacing it; on a full load, adopt the whole result.
			setEntries((prev,) => {
				if (!prev) { return loaded }
				const next = prev.slice()
				for (const entry of loaded) {
					const idx = next.findIndex((e,) => sameSub(e.subreddit, entry.subreddit,))
					if (idx === -1) { next.push(entry,) }
					else { next[idx] = entry }
				}
				return next
			},)
			setFailedSubs(failed,)
		} finally {
			if (mountedRef.current) { setRefreshing(false,) }
		}
	}

	useEffect(() => {
		mountedRef.current = true
		;(async () => {
			try {
				const user = await getCurrentUser()
				if (mountedRef.current) { setCurrentUser(user,) }
			} catch (err) {
				log.warn('could not resolve current user', err,)
			}
			try {
				const subs = await getModSubs()
				modSubsRef.current = subs
				await runFanout(subs, false,)
			} catch (err) {
				log.warn('could not load cross-sub proposals', err,)
				if (mountedRef.current) { setEntries([],) }
			}
		})()
		// A mutation anywhere updates that sub's cache; re-read it (cache hit) and patch.
		const off = onProposalsChanged((subreddit,) => {
			if (!mountedRef.current) { return }
			void loadProposals(subreddit,).then((data,) => {
				if (mountedRef.current) { patchSub(subreddit, data,) }
			},)
		},)
		return () => {
			mountedRef.current = false
			off()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [],)

	/** Re-reads every moderated sub (forced); wired to the header Refresh button. */
	function refreshAll () {
		const subs = modSubsRef.current
		if (subs) { void runFanout(subs, true,) }
	}

	/** Re-reads only the subs that failed last time; wired to the retry banner. */
	function retryFailed () {
		if (failedSubs.length > 0) { void runFanout(failedSubs, true,) }
	}

	// Resolve the current user's trainee status for a subreddit on demand (cached).
	function ensureTraineeKnown (subreddit: string,) {
		const key = subreddit.toLowerCase()
		if (key in traineeBySub) { return }
		void isTraineeFor(subreddit,).then((value,) => {
			setTraineeBySub((prev,) => ({...prev, [key]: value,}))
		},)
	}

	const list = entries ?? []
	// Memoize the cross-sub derivations (each walks every proposal across every sub) so a
	// high-churn state change - typing feedback, selection, busy/rejecting - doesn't
	// recompute them; they only depend on the fanned-out entries, the user, and filters.
	const reviewList = useMemo(() => openProposalsAcross(entries ?? [],), [entries,],)
	const mineList = useMemo(() => myProposalsAcross(entries ?? [], currentUser,), [entries, currentUser,],)
	// The current view's full list (drives the tab counts and filter options), then the
	// filtered + sorted subset that's actually rendered.
	const viewList = view === 'review' ? reviewList : mineList
	const options = useMemo(() => filterOptions(viewList,), [viewList,],)
	const shown = useMemo(() => filterSortProposals(viewList, filters,), [viewList, filters,],)
	// The list in the same order it renders (current subreddit's items first), so keyboard
	// navigation and "select first" follow what the eye sees.
	const orderedShown = useMemo(() => orderByCurrentSub(shown, currentSubreddit,), [shown, currentSubreddit,],)
	const selectedAt: ProposalAt | null = selected
		? (() => {
			const entry = list.find((e,) => sameSub(e.subreddit, selected.subreddit,))
			const proposal = entry?.data.proposals[selected.id]
			return proposal ? {subreddit: entry!.subreddit, proposal,} : null
		})()
		: null

	// Auto-select the first proposal once results arrive (and after a view/filter change
	// clears the selection), so the detail pane isn't an empty prompt on open.
	useEffect(() => {
		if (entries !== null && !selected && orderedShown.length > 0) {
			void selectProposal(orderedShown[0]!,)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [entries, selected, orderedShown,],)

	/**
	 * Confirms before discarding unsent rejection feedback. Returns `true` to proceed
	 * (nothing to discard, or the user confirmed) or `false` to keep the draft.
	 */
	async function confirmDiscardFeedback (): Promise<boolean> {
		if (!rejecting || !feedbackDraft.trim()) { return true }
		return reactAlert({message: 'Discard your unsent rejection feedback? Click OK to discard.',},)
	}

	/** Switches list view and clears the (now-irrelevant) selection and filters. */
	async function switchView (next: 'review' | 'mine',) {
		if (!(await confirmDiscardFeedback())) { return }
		setView(next,)
		setSelected(null,)
		setRejecting(false,)
		setFeedbackDraft('',)
		setFilters(defaultFilters,)
	}

	/** Selects a proposal for the detail pane (guarding any unsent reject feedback). */
	async function selectProposal (at: ProposalAt,) {
		if (!(await confirmDiscardFeedback())) { return }
		setSelected({subreddit: at.subreddit, id: at.proposal.id,},)
		setRejecting(false,)
		setFeedbackDraft('',)
		ensureTraineeKnown(at.subreddit,)
	}

	/** Closes the inline reject form, confirming first if feedback has been typed. */
	async function cancelReject () {
		if (!(await confirmDiscardFeedback())) { return }
		setRejecting(false,)
		setFeedbackDraft('',)
	}

	async function handleAccept (at: ProposalAt,) {
		setBusy({subreddit: at.subreddit, id: at.proposal.id,},)
		try {
			const result = await performProposal(
				at.subreddit,
				at.proposal,
				currentUser,
				await retentionDaysFor(at.subreddit,),
			)
			if (result.ok) {
				positiveTextFeedback('Proposal accepted and performed',)
			} else if (result.reason === 'already-resolved') {
				negativeTextFeedback('Already resolved by another moderator',)
			} else if (result.reason === 'self-accept') {
				negativeTextFeedback('You cannot accept your own second-opinion request',)
			} else if (result.reason === 'in-progress') {
				negativeTextFeedback('Another moderator is currently accepting this proposal',)
			} else if (result.reason === 'replay-failed') {
				negativeTextFeedback(`Action failed: ${result.error ?? 'unknown error'}`,)
			} else if (result.reason === 'irreversible-retry') {
				negativeTextFeedback(
					'A previous attempt already applied part of this action; retrying could duplicate it. '
						+ 'Resolve it manually (reject, or finish the remaining step yourself).',
				)
			} else {
				negativeTextFeedback('Could not accept the proposal',)
			}
		} finally {
			setBusy(null,)
			void loadProposals(at.subreddit, {force: true,},).then((data,) => {
				if (mountedRef.current) { patchSub(at.subreddit, data,) }
			},)
		}
	}

	/**
	 * Edit & Accept: re-open the full removal overlay seeded from the captured proposal so
	 * the reviewer can adjust any setting, then perform the removal. The overlay performs
	 * it directly (bypassing the gateway replay), so on success we mark the proposal
	 * accepted with a direct transition - never via {@link performProposal} (that would
	 * remove/message/ban a second time).
	 */
	async function handleEditAccept (at: ProposalAt,) {
		const action = at.proposal.action
		if (action.type !== 'removal-reason') { return }
		const intent = action.intent
		const sel = intent.selection
		if (!sel) { return }
		const preseed: RemovalReasonsOverlayPreseed = {
			reasons: sel.reasons,
			...(sel.includeHeader !== undefined ? {includeHeader: sel.includeHeader,} : {}),
			...(sel.includeFooter !== undefined ? {includeFooter: sel.includeFooter,} : {}),
			reasonType: intent.reasonType,
			...(intent.reasonSticky ? {reasonSticky: true,} : {}),
			...(intent.reasonAsSub ? {reasonAsSub: true,} : {}),
			...(intent.reasonAutoArchive ? {reasonAutoArchive: true,} : {}),
			...(intent.reasonCommentAsSubreddit ? {reasonCommentAsSubreddit: true,} : {}),
			...(intent.actionLockThread ? {actionLockThread: true,} : {}),
			...(intent.actionLockComment ? {actionLockComment: true,} : {}),
			...(intent.logReasonText ? {logReasonText: intent.logReasonText,} : {}),
			...(intent.usernote ? {usernote: {...intent.usernote,},} : {}),
			...(intent.ban
				? {ban: {permanent: intent.ban.permanent, days: intent.ban.days, note: intent.ban.note,},}
				: {}),
		}
		const result = await openRemovalOverlayForProposal({
			subreddit: at.subreddit,
			fullname: at.proposal.itemId,
			isComment: at.proposal.itemKind === 'comment',
			seededFromIntent: preseed,
			// Claim/release gate: passing it puts the overlay in direct-perform mode (never
			// re-capturing) and brackets the perform with the claim, so two reviewers editing
			// the same proposal can't both perform it. The claim is placed at perform time
			// (not when the overlay opens), so an in-progress edit never holds it.
			acceptGate: {
				claim: async () => {
					const claim = await claimProposalForReplay(at.subreddit, at.proposal.id, currentUser,)
					if (claim.ok) { return {ok: true,} }
					return {
						ok: false,
						message: claim.reason === 'already-resolved'
							? 'Already resolved by another moderator'
							: claim.reason === 'in-progress'
							? 'Another moderator is currently accepting this proposal'
							: claim.reason === 'irreversible-retry'
							? 'A previous attempt already applied part of this action; resolve it manually instead.'
							: 'Could not start the accept; the proposal may have been resolved.',
					}
				},
				// The removal failed after we claimed; release the claim so it can be retried.
				release: () => {
					void releaseProposalClaim(at.subreddit, at.proposal.id, currentUser,)
				},
			},
			onAccepted: () => {
				void finalizeEditAccept(at,)
			},
		},)
		if (!result.ok) {
			negativeTextFeedback(
				result.reason === 'no-reasons'
					? 'This subreddit has no removal reasons configured'
					: 'Could not open the removal editor',
			)
		}
	}

	/** Marks a proposal accepted after Edit & Accept performed the removal via the overlay. */
	async function finalizeEditAccept (at: ProposalAt,) {
		const result = await transitionProposal(
			at.subreddit,
			at.proposal.id,
			'accepted',
			{resolvedBy: currentUser, resolvedAt: nowInSeconds(),},
			`accept (edited) ${at.proposal.id}`,
			await retentionDaysFor(at.subreddit,),
		)
		if (result.ok) {
			positiveTextFeedback('Proposal accepted',)
		} else if (result.reason === 'already-resolved') {
			negativeTextFeedback('Already resolved by another moderator',)
		} else {
			negativeTextFeedback('Removal performed, but the proposal could not be marked accepted',)
		}
		void loadProposals(at.subreddit, {force: true,},).then((data,) => {
			if (mountedRef.current) { patchSub(at.subreddit, data,) }
		},)
	}

	async function handleReject (at: ProposalAt,) {
		setBusy({subreddit: at.subreddit, id: at.proposal.id,},)
		try {
			const result = await rejectProposal(
				at.subreddit,
				at.proposal.id,
				currentUser,
				feedbackDraft.trim() || undefined,
				await retentionDaysFor(at.subreddit,),
			)
			if (result.ok) {
				positiveTextFeedback('Proposal rejected',)
			} else if (result.reason === 'already-resolved') {
				negativeTextFeedback('Already resolved by another moderator',)
			} else if (result.reason === 'in-progress') {
				negativeTextFeedback('A moderator is currently accepting this proposal; try again in a moment',)
			} else {
				negativeTextFeedback('Could not reject the proposal',)
			}
		} finally {
			setBusy(null,)
			setRejecting(false,)
			setFeedbackDraft('',)
			void loadProposals(at.subreddit, {force: true,},).then((data,) => {
				if (mountedRef.current) { patchSub(at.subreddit, data,) }
			},)
		}
	}

	async function handleDismiss (at: ProposalAt,) {
		setBusy({subreddit: at.subreddit, id: at.proposal.id,},)
		try {
			await dismissProposal(at.subreddit, at.proposal.id, await retentionDaysFor(at.subreddit,),)
		} finally {
			setBusy(null,)
			void loadProposals(at.subreddit, {force: true,},).then((data,) => {
				if (mountedRef.current) { patchSub(at.subreddit, data,) }
			},)
		}
	}

	/** Arrow-key navigation and Enter-to-act for the sidebar list. */
	function onListKeyDown (event: ReactKeyboardEvent,) {
		// Don't hijack arrows/Enter while typing in the filter fields.
		const tag = (event.target as HTMLElement).tagName
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { return }
		if (event.key === 'Enter') {
			// Move focus into the detail pane's first action so the keyboard flow continues.
			const action = paneRef.current?.querySelector<HTMLElement>('button',)
			if (action) {
				event.preventDefault()
				action.focus()
			}
			return
		}
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') { return }
		if (orderedShown.length === 0) { return }
		event.preventDefault()
		const idx = selected
			? orderedShown.findIndex((at,) =>
				at.proposal.id === selected.id && sameSub(at.subreddit, selected.subreddit,)
			)
			: -1
		const nextIdx = event.key === 'ArrowDown'
			? Math.min(idx + 1, orderedShown.length - 1,)
			: Math.max(idx <= 0 ? 0 : idx - 1, 0,)
		void selectProposal(orderedShown[nextIdx]!,)
	}

	/** One row in the sidebar list. */
	function listItem (at: ProposalAt,) {
		const {proposal,} = at
		const active = selected?.id === proposal.id && sameSub(selected.subreddit, at.subreddit,)
		// A mutation on this row is in flight; dim it so the gap before the
		// proposals-changed refresh removes/updates it reads as intentional.
		const rowBusy = busy?.id === proposal.id && sameSub(busy.subreddit, at.subreddit,)
		const excerpt = proposalExcerpt(proposal,)
		return (
			<li key={`${at.subreddit}/${proposal.id}`}>
				<button
					type="button"
					className={classes(
						css.listItem,
						active && css.active,
						isAging(proposal,) && css.aging,
						rowBusy && css.rowBusy,
					)}
					aria-current={active ? 'true' : undefined}
					onClick={() => void selectProposal(at,)}
				>
					<span className={css.itemAction}>
						<span className={css.itemKind}>{itemKindLabel(proposal.itemKind,)}</span>
						{describeAction(proposal.action,)}
						{rowBusy && <span className={css.loadingSpinner} aria-hidden="true" />}
					</span>
					{excerpt && <span className={css.itemExcerpt}>{excerpt}</span>}
					<span className={css.itemMeta}>
						r/{at.subreddit} · u/{proposal.proposedBy} ·{' '}
						<RelativeTime date={new Date(proposal.proposedAt * 1000,)} />
					</span>
					<span className={css.itemStatus}>{describeStatus(proposal,)}</span>
				</button>
			</li>
		)
	}

	/**
	 * Renders the list grouped into the current subreddit (first) and everything
	 * else, so the cross-sub view stays oriented to where the user is.
	 */
	function groupedList (items: ProposalAt[],) {
		const {current, others,} = splitByCurrentSub(items, currentSubreddit,)
		// With no current-sub context, or when one group is empty, show a flat list.
		if (current.length === 0 || others.length === 0) {
			return <ul className={css.list}>{items.map(listItem,)}</ul>
		}
		return (
			<ul className={css.list}>
				<li className={css.sectionLabel}>r/{currentSubreddit}</li>
				{current.map(listItem,)}
				<li className={css.sectionLabel}>Other subreddits</li>
				{others.map(listItem,)}
			</ul>
		)
	}

	/** The detail pane for the selected proposal. */
	function detail (at: ProposalAt,) {
		const isBusy = busy?.id === at.proposal.id && sameSub(busy.subreddit, at.subreddit,)
		return (
			<ProposalDetail
				at={at}
				currentUser={currentUser}
				traineeHere={traineeBySub[at.subreddit.toLowerCase()]}
				isBusy={isBusy}
				rejecting={rejecting}
				feedbackDraft={feedbackDraft}
				onFeedbackChange={setFeedbackDraft}
				onAccept={() => handleAccept(at,)}
				onStartReject={() => setRejecting(true,)}
				onConfirmReject={() => handleReject(at,)}
				onCancelReject={() => void cancelReject()}
				onDismiss={() => handleDismiss(at,)}
				canEditAccept={at.proposal.action.type === 'removal-reason' && !!at.proposal.action.intent.selection}
				onEditAccept={() => handleEditAccept(at,)}
			/>
		)
	}

	return (
		<PushDrawer
			widthPx={DRAWER_WIDTH_PX}
			pushMediaQuery={DRAWER_PUSH_MEDIA_QUERY}
			className={css.drawerRoot ?? ''}
			onClose={onClose}
		>
			<Window
				title="Proposals · all moderated subreddits"
				className={css.popup}
				headerButtons={
					<button
						type="button"
						aria-label="Refresh proposals"
						title="Refresh proposals"
						disabled={refreshing || modSubsRef.current === null}
						onClick={refreshAll}
					>
						<Icon icon="refresh" className={classes(refreshing && css.spinning,)} />
					</button>
				}
				closable
				onClose={onClose}
			>
				<div className={css.workspace}>
					{/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
					<div className={css.sidebar} onKeyDown={onListKeyDown}>
						<div className={css.tabs}>
							<ActionButton
								type="button"
								primary={view === 'review'}
								onClick={() => void switchView('review',)}
							>
								Review ({reviewList.length})
							</ActionButton>
							<ActionButton
								type="button"
								primary={view === 'mine'}
								onClick={() => void switchView('mine',)}
							>
								Mine ({mineList.length})
							</ActionButton>
						</div>
						{viewList.length > 0 && (
							<ProposalFilterBar options={options} filters={filters} onChange={setFilters} />
						)}
						{viewList.length > 0 && (
							<div className={css.resultCount}>
								<span>Showing {shown.length} of {viewList.length}</span>
							</div>
						)}
						{failedSubs.length > 0 && (
							<div className={css.loadError} role="alert">
								<span>
									Couldn’t load proposals from {failedSubs.map((s,) => `r/${s}`).join(', ',)}.
								</span>
								<ActionButton type="button" inline busy={refreshing} onClick={retryFailed}>
									Retry
								</ActionButton>
							</div>
						)}
						{entries === null && <ProposalSpinner label="Loading proposals..." />}
						{entries !== null && shown.length === 0 && (
							<div className={css.empty}>
								{viewList.length > 0
									? 'No proposals match the filters.'
									: view === 'review'
									? 'Nothing to review.'
									: 'No proposals here.'}
							</div>
						)}
						{shown.length > 0 && groupedList(shown,)}
					</div>
					<div className={css.pane} ref={paneRef}>
						{selectedAt
							? detail(selectedAt,)
							: <div className={css.empty}>Select a proposal to review.</div>}
					</div>
				</div>
			</Window>
		</PushDrawer>
	)
}

/**
 * Opens the cross-subreddit proposals review drawer. Returns a close function.
 * @param currentSubreddit The user's current page subreddit, grouped first in the
 *   list (pass an empty string when there is no subreddit context).
 * @param onClose Optional callback merged with the mount cleanup.
 */
export function showProposalsReviewPopup (currentSubreddit: string, onClose?: () => void,): () => void {
	return mountPopup(
		(close,) => <ProposalsReviewPopup currentSubreddit={currentSubreddit} onClose={close} />,
		onClose,
		'proposals-review',
	)
}
