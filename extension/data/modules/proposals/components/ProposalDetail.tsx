/**
 * The detail pane for the selected proposal: action title, metadata, the "what happens
 * on accept" summary (the reason text + side effects), the proposer's note and any
 * reviewer feedback, an expanded needs-attention diagnostic, and the Accept / Reject /
 * Dismiss actions. Purely presentational - all async work (accept/reject/dismiss) lives
 * in the parent drawer and is passed in as callbacks, so this component is easy to test
 * and re-render.
 */

import {useEffect, useState,} from 'react'

import {ActionButton,} from '../../../shared/controls/ActionButton'
import {Icon,} from '../../../shared/controls/Icon'
import {RelativeTime,} from '../../../shared/controls/RelativeTime'
import {TextareaInput,} from '../../../shared/controls/TextareaInput'
import createLogger from '../../../util/infra/logging'
import {classes,} from '../../../util/ui/reactMount'
import type {UserNoteColor,} from '../../../util/wiki/schemas/usernotes/schema'
import {isOpen, type ProposalAt,} from '../../shared/proposals/selectors'
import {findSubredditColor, getSubredditColors,} from '../../shared/usernotes/moduleapi'
import {FrozenIntentSummary,} from './FrozenIntentSummary'
import {ProposalAuthorContext,} from './ProposalAuthorContext'
import css from './ProposalsReviewPopup.module.css'
import {ProposalTargetPreview, useProposalTarget,} from './ProposalTargetPreview'
import {describeAction, describeStatus,} from './proposalView'

const log = createLogger('TBProposals',)

/** Epoch-seconds -> Date, for the relative-time controls. */
function toDate (epochSeconds: number,): Date {
	return new Date(epochSeconds * 1000,)
}

/** Props for the detail pane. */
interface Props {
	/** The selected proposal and the subreddit it lives in. */
	at: ProposalAt
	/** The logged-in moderator (for the proposer-only Dismiss action). */
	currentUser: string
	/**
	 * The current user's trainee status in this subreddit: `false` means confirmed not a
	 * trainee (Accept allowed), `true` means a trainee (blocked), `undefined` means not
	 * yet resolved (Accept stays disabled until we know).
	 */
	traineeHere: boolean | undefined
	/** Whether a mutation on this proposal is in flight (disables the buttons). */
	isBusy: boolean
	/** Whether the inline reject form is showing. */
	rejecting: boolean
	/** Current text in the reject-feedback box. */
	feedbackDraft: string
	/** Updates the reject-feedback draft. */
	onFeedbackChange: (value: string,) => void
	/** Accept (and replay) the proposal. */
	onAccept: () => void
	/** Open the inline reject form. */
	onStartReject: () => void
	/** Submit the rejection with the current feedback draft. */
	onConfirmReject: () => void
	/** Close the inline reject form without rejecting. */
	onCancelReject: () => void
	/** Acknowledge a resolved proposal (proposer only). */
	onDismiss: () => void
	/** Whether Edit & Accept is available (a removal-reason proposal with a captured selection). */
	canEditAccept: boolean
	/** Re-open the full removal overlay pre-filled from the proposal, then accept on send. */
	onEditAccept: () => void
}

/** Renders the detail pane for one proposal. */
export function ProposalDetail ({
	at,
	currentUser,
	traineeHere,
	isBusy,
	rejecting,
	feedbackDraft,
	onFeedbackChange,
	onAccept,
	onStartReject,
	onConfirmReject,
	onCancelReject,
	onDismiss,
	canEditAccept,
	onEditAccept,
}: Props,) {
	const {proposal,} = at
	const open = isOpen(proposal,)
	const resolved = !open
	// Disable Accept until we've confirmed the user is NOT a trainee in this sub.
	const acceptBlocked = traineeHere !== false
	const na = proposal.needsAttention
	const target = useProposalTarget(at,)
	// Author for the history panel: the target's author for things, the user itself for
	// user-targeted actions (ban/mute), where itemId IS the username.
	const author = proposal.itemKind === 'user'
		? proposal.itemId
		: target.phase === 'loaded'
		? target.info.author
		: ''
	// Usernote type chips need the subreddit's note palette; fetch only when a removal
	// proposal actually leaves a usernote (colors are cached).
	const needsColors = proposal.action.type === 'removal-reason' && !!proposal.action.intent.usernote
	const [usernoteColors, setUsernoteColors,] = useState<UserNoteColor[]>([],)
	useEffect(() => {
		if (!needsColors) { return }
		let cancelled = false
		void getSubredditColors(at.subreddit,).then((c,) => {
			if (!cancelled) { setUsernoteColors(c,) }
		},).catch((err: unknown,) => {
			if (!cancelled) {
				log.warn(`Failed to load subreddit colors for /r/${at.subreddit}`, err,)
			}
		},)
		return () => {
			cancelled = true
		}
	}, [needsColors, at.subreddit,],)
	// Resolve the usernote type's color here (this module already loads the usernotes api),
	// so FrozenIntentSummary stays free of that heavy import.
	const usernoteType = proposal.action.type === 'removal-reason' ? proposal.action.intent.usernote?.type : undefined
	const usernoteColor = usernoteType && usernoteColors.length > 0
		? findSubredditColor(usernoteColors, usernoteType,)
		: undefined
	return (
		<div className={css.detail}>
			<div className={css.detailTitle}>{describeAction(proposal.action,)}</div>
			<dl className={css.detailMeta}>
				<dt>Subreddit</dt>
				<dd>r/{at.subreddit}</dd>
				<dt>Proposed by</dt>
				<dd>
					u/{proposal.proposedBy} ({proposal.source === 'second-opinion' ? 'second opinion' : 'training'})
				</dd>
				<dt>When</dt>
				<dd>
					<RelativeTime date={toDate(proposal.proposedAt,)} />
				</dd>
				<dt>Status</dt>
				<dd>{describeStatus(proposal,)}</dd>
				{proposal.link && (
					<>
						<dt>Item</dt>
						<dd>
							<a href={proposal.link} target="_blank" rel="noreferrer">View on Reddit</a>
						</dd>
					</>
				)}
			</dl>

			<ProposalTargetPreview state={target} />

			<FrozenIntentSummary action={proposal.action} usernoteColor={usernoteColor} />

			{proposal.note && <div className={css.detailNote}>
				<strong>Note:</strong> {proposal.note}
			</div>}
			{proposal.feedback && <div className={css.detailNote}>
				<strong>Feedback:</strong> {proposal.feedback}
			</div>}

			<ProposalAuthorContext subreddit={at.subreddit} author={author} />
			{proposal.status === 'needs_attention' && na && (
				<div className={css.alert} role="alert">
					<Icon icon="modqueue" className={classes(css.alertIcon,)} />
					<div className={css.alertBody}>
						<div>
							<strong>Previous accept failed at “{na.failedStep}”.</strong> {na.error}
						</div>
						<div>
							Attempted by u/{na.attemptedBy} <RelativeTime date={toDate(na.attemptedAt,)} />
						</div>
						{na.irreversibleSideEffect && (
							<div>
								A previous attempt already applied part of this action; retrying could duplicate it.
								Resolve it manually (reject, or finish the remaining step yourself).
							</div>
						)}
					</div>
				</div>
			)}

			{open && rejecting && (
				<div className={css.rejectForm}>
					<TextareaInput
						aria-label="Feedback for the proposer"
						placeholder="Optional feedback for the proposer"
						value={feedbackDraft}
						onChange={(e,) => onFeedbackChange(e.target.value,)}
					/>
					<div className={css.actions}>
						<ActionButton type="button" busy={isBusy} onClick={onConfirmReject}>
							{isBusy ? 'Rejecting...' : 'Confirm reject'}
						</ActionButton>
						<ActionButton type="button" disabled={isBusy} onClick={onCancelReject}>Cancel</ActionButton>
					</div>
				</div>
			)}
			{open && !rejecting && (
				<div className={css.actions}>
					<ActionButton
						primary
						type="button"
						busy={isBusy}
						disabled={acceptBlocked}
						title={traineeHere ? 'Trainees cannot accept proposals in this subreddit' : undefined}
						onClick={onAccept}
					>
						{isBusy ? 'Accepting...' : 'Accept'}
					</ActionButton>
					{canEditAccept && (
						<ActionButton
							type="button"
							disabled={isBusy || acceptBlocked}
							title={traineeHere
								? 'Trainees cannot accept proposals in this subreddit'
								: 'Re-open the removal editor pre-filled, adjust anything, then send'}
							onClick={onEditAccept}
						>
							Edit &amp; accept
						</ActionButton>
					)}
					<ActionButton type="button" disabled={isBusy} onClick={onStartReject}>
						Reject
					</ActionButton>
				</div>
			)}
			{resolved && !proposal.ackedByProposer
				&& proposal.proposedBy.toLowerCase() === currentUser.toLowerCase() && (
					<div className={css.actions}>
						<ActionButton type="button" busy={isBusy} onClick={onDismiss}>
							{isBusy ? 'Dismissing...' : 'Dismiss'}
						</ActionButton>
					</div>
				)}
		</div>
	)
}
