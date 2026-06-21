/**
 * Inline preview of the post/comment a proposal targets, so the reviewer can judge the
 * removal without leaving the drawer. Fetches the thing once per selection via
 * `getApiThingInfo`. When the target is definitively gone - Reddit returns no such thing
 * (not-found), or the author deleted it - the still-open proposal is auto-resolved to
 * `obsolete`/`deleted` via `markProposalObsolete` (the first thing to actually drive that
 * path), and the drawer refreshes through the usual proposals-changed event. Transient
 * fetch failures show a soft "couldn't load" state and never resolve anything.
 */

import {useEffect, useMemo, useRef, useState,} from 'react'

import {ActionButton,} from '../../../shared/controls/ActionButton'
import {getApiThingInfo, isInfoRemoved, ThingNotFoundError,} from '../../../util/reddit/thingInfo'
import {classes,} from '../../../util/ui/reactMount'
import {markProposalObsolete,} from '../../shared/proposals/moduleapi'
import {isOpen, type ProposalAt,} from '../../shared/proposals/selectors'
import {getRemovalReasonParser,} from '../../shared/removalReasons/parser'
import {ProposalSpinner,} from './ProposalSpinner'
import css from './ProposalsReviewPopup.module.css'

/** Normalized thing info as returned by {@link getApiThingInfo}. */
type ThingInfo = Awaited<ReturnType<typeof getApiThingInfo>>

/** The fetch lifecycle for a proposal's target. */
type TargetPhase =
	/** User-targeted action (ban/mute): there is no thing to preview. */
	| {phase: 'idle'}
	| {phase: 'loading'}
	| {phase: 'loaded'; info: ThingInfo}
	/** Definitively gone (not-found or author-deleted); the proposal is auto-resolved. */
	| {phase: 'gone'}
	/** Transient failure; nothing is resolved. */
	| {phase: 'error'}

/** The fetch lifecycle plus a `retry()` to re-attempt after a transient failure. */
export type TargetState = TargetPhase & {retry: () => void}

/** Whether normalized thing info indicates the author deleted the content. */
function isAuthorDeleted (info: ThingInfo,): boolean {
	return info.author === '' && info.raw_body === '[deleted]'
}

/**
 * Fetches the target thing for a proposal and reports its lifecycle, auto-resolving the
 * proposal as obsolete when the target is definitively gone. Refetches when the selected
 * proposal changes; cancels in-flight work on change/unmount.
 * @param at The selected proposal and its subreddit.
 */
export function useProposalTarget (at: ProposalAt,): TargetState {
	const {subreddit, proposal,} = at
	const [state, setState,] = useState<TargetPhase>({phase: 'loading',},)
	// Bumped by `retry()` to re-run the fetch effect after a transient failure.
	const [reloadNonce, setReloadNonce,] = useState(0,)
	// Proposal ids we've already auto-resolved, so a re-render can't double-write.
	const resolvedRef = useRef(new Set<string>(),)

	useEffect(() => {
		if (proposal.itemKind === 'user') {
			setState({phase: 'idle',},)
			return
		}
		let cancelled = false
		setState({phase: 'loading',},)

		/** Auto-resolve the proposal as obsolete/deleted, at most once. */
		function autoResolveGone () {
			if (!isOpen(proposal,) || resolvedRef.current.has(proposal.id,)) { return }
			resolvedRef.current.add(proposal.id,)
			void markProposalObsolete(subreddit, proposal.id, 'deleted',).catch(() => {/* best-effort */},)
		}

		void (async () => {
			try {
				const info = await getApiThingInfo(subreddit, proposal.itemId,)
				if (cancelled) { return }
				if (isAuthorDeleted(info,)) {
					setState({phase: 'gone',},)
					autoResolveGone()
				} else {
					setState({phase: 'loaded', info,},)
				}
			} catch (err) {
				if (cancelled) { return }
				// `getApiThingInfo` throws `ThingNotFoundError` only when the API responds
				// with an empty listing - a definitive not-found. Anything else is transient.
				if (err instanceof ThingNotFoundError) {
					setState({phase: 'gone',},)
					autoResolveGone()
				} else {
					setState({phase: 'error',},)
				}
			}
		})()

		return () => {
			cancelled = true
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [subreddit, proposal.id, proposal.itemKind, proposal.itemId, reloadNonce,],)

	return {...state, retry: () => setReloadNonce((n,) => n + 1),}
}

/** Body length (chars) past which the preview clamps behind "Show full post". */
const BODY_CLAMP_CHARS = 280

/** The loaded post/comment, with its body rendered as markdown and a Show full/less toggle. */
function LoadedTargetPreview ({info,}: {info: ThingInfo},) {
	const [expanded, setExpanded,] = useState(false,)
	const parser = useMemo(() => getRemovalReasonParser(), [],)
	const isPost = info.kind === 'submission'
	const removed = isInfoRemoved(info,)
	const reportCount = (info.userReports?.length ?? 0) + (info.modReports?.length ?? 0)
	const body = info.raw_body.trim()
	const bodyHtml = useMemo(() => (body ? parser.render(body,) : ''), [parser, body,],)
	// Clamp long bodies with CSS (not truncation) so partial markdown can't render broken.
	const longBody = body.length > BODY_CLAMP_CHARS
	return (
		<div className={css.targetPreview}>
			<div className={css.targetMeta}>
				<span className={css.itemKind}>{isPost ? 'Post' : 'Comment'}</span>
				{info.author ? <span>u/{info.author}</span> : <span className={css.empty}>[deleted author]</span>}
				{info.domain && <span className={css.targetDomain}>{info.domain}</span>}
				{removed && <span className={css.warn}>already removed</span>}
				{reportCount > 0
					&& <span className={css.warn}>{reportCount} report{reportCount === 1 ? '' : 's'}</span>}
			</div>
			{isPost && info.title && <div className={css.targetTitle}>{info.title}</div>}
			{bodyHtml && (
				<div
					className={classes(css.targetBody, !expanded && longBody && css.targetBodyClamped,)}
					dangerouslySetInnerHTML={{__html: bodyHtml,}}
				/>
			)}
			{longBody && (
				<button type="button" className={css.showMore} onClick={() => setExpanded((e,) => !e)}>
					{expanded ? 'Show less' : 'Show full post'}
				</button>
			)}
			{info.permalink && (
				<a href={info.permalink} target="_blank" rel="noreferrer" className={css.detailNote}>
					View on Reddit
				</a>
			)}
		</div>
	)
}

/** Renders the target preview for the given fetch state. */
export function ProposalTargetPreview ({state,}: {state: TargetState},) {
	if (state.phase === 'idle') { return null }
	if (state.phase === 'loading') {
		return <div className={css.targetPreview}>
			<ProposalSpinner label="Loading target..." />
		</div>
	}
	if (state.phase === 'gone') {
		return (
			<div className={css.targetPreview}>
				<div className={css.warn}>This item is no longer available - the proposal was marked obsolete.</div>
			</div>
		)
	}
	if (state.phase === 'error') {
		return <div className={css.targetPreview}>
			<span className={css.empty}>Couldn’t load the target content.</span>
			<ActionButton type="button" inline onClick={state.retry}>Retry</ActionButton>
		</div>
	}
	return <LoadedTargetPreview info={state.info} />
}
