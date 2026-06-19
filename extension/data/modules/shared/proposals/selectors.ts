/**
 * Pure read-side selectors over {@link ProposalsData}. Kept separate from the UI
 * and storage so the views and the modbar badge derive their state the same way,
 * and so the (subtle) "what's pending / what's mine / what's unacknowledged" logic
 * is unit-testable without rendering anything.
 */

import {isTerminalStatus, type Proposal, type ProposalsData,} from '../../../util/wiki/schemas/proposals/schema'
import {sameUsername,} from './usernames'

/**
 * One subreddit's proposals paired with the subreddit they belong to - the unit the
 * cross-subreddit fan-out (`loadProposalsForSubs`) produces and the `*Across`
 * selectors consume.
 */
export interface SubredditProposals {
	/** The subreddit the proposals were read from. */
	subreddit: string
	/** That subreddit's proposals. */
	data: ProposalsData
}

/**
 * A single proposal tagged with the subreddit it lives in. The cross-sub views need
 * this because every mutation (accept/reject/dismiss) is scoped to a subreddit, and
 * the list has to label which subreddit each row came from.
 */
export interface ProposalAt {
	/** The subreddit the proposal belongs to. */
	subreddit: string
	/** The proposal itself. */
	proposal: Proposal
}

/** Whether a proposal is still awaiting a reviewer (pending or a failed accept). */
export function isOpen (proposal: Proposal,): boolean {
	return proposal.status === 'pending' || proposal.status === 'needs_attention'
}

/** All proposals as an array. */
function all (data: ProposalsData,): Proposal[] {
	return Object.values(data.proposals,)
}

/** Newest-first comparator on creation time. */
function byNewest (a: Proposal, b: Proposal,): number {
	return b.proposedAt - a.proposedAt
}

/**
 * Open proposals (pending / needs_attention) for the review queue, newest first.
 * @param data The subreddit's proposals.
 */
export function openProposals (data: ProposalsData,): Proposal[] {
	return all(data,).filter(isOpen,).sort(byNewest,)
}

/** Count of open proposals - drives the reviewer's modbar badge. */
export function openProposalCount (data: ProposalsData,): number {
	return all(data,).filter(isOpen,).length
}

/**
 * Open proposals targeting a specific item, newest first (for the inline badge).
 * @param data The subreddit's proposals.
 * @param itemId The target fullname.
 */
export function openProposalsForItem (data: ProposalsData, itemId: string,): Proposal[] {
	return all(data,).filter((p,) => p.itemId === itemId && isOpen(p,)).sort(byNewest,)
}

/** Case-insensitive author match. */
function isBy (proposal: Proposal, user: string,): boolean {
	return sameUsername(proposal.proposedBy, user,)
}

/**
 * The current user's own proposals, newest first (the "My proposals" view).
 * @param data The subreddit's proposals.
 * @param user The current username.
 */
export function myProposals (data: ProposalsData, user: string,): Proposal[] {
	if (!user) { return [] }
	return all(data,).filter((p,) => isBy(p, user,)).sort(byNewest,)
}

/**
 * The current user's resolved proposals they haven't acknowledged yet - drives the
 * proposer's modbar badge and the "needs your attention" highlight in My proposals.
 * @param data The subreddit's proposals.
 * @param user The current username.
 */
export function myUnacknowledgedResolved (data: ProposalsData, user: string,): Proposal[] {
	if (!user) { return [] }
	return all(data,)
		.filter((p,) => isBy(p, user,) && isTerminalStatus(p.status,) && !p.ackedByProposer)
		.sort(byNewest,)
}

// --- Cross-subreddit selectors -------------------------------------------------
//
// These mirror the single-subreddit selectors above but operate over a list of
// per-subreddit proposals, tagging each result with its subreddit so the cross-sub
// drawer can label rows and route mutations. They reuse the same single-sub
// predicates so "open / mine / unacknowledged" mean exactly the same thing globally.

/** Newest-first comparator on a tagged proposal's creation time. */
function byNewestAt (a: ProposalAt, b: ProposalAt,): number {
	return b.proposal.proposedAt - a.proposal.proposedAt
}

/**
 * Flattens per-subreddit proposals into one tagged list, keeping only those passing
 * `predicate`, newest first across every subreddit.
 * @param entries Per-subreddit proposals from the fan-out.
 * @param predicate Which proposals to keep.
 */
function collectAcross (
	entries: SubredditProposals[],
	predicate: (proposal: Proposal,) => boolean,
): ProposalAt[] {
	const out: ProposalAt[] = []
	for (const {subreddit, data,} of entries) {
		for (const proposal of Object.values(data.proposals,)) {
			if (predicate(proposal,)) { out.push({subreddit, proposal,},) }
		}
	}
	return out.sort(byNewestAt,)
}

/**
 * Open proposals (pending / needs_attention) across every subreddit, newest first -
 * the cross-sub review queue.
 * @param entries Per-subreddit proposals from the fan-out.
 */
export function openProposalsAcross (entries: SubredditProposals[],): ProposalAt[] {
	return collectAcross(entries, isOpen,)
}

/** Total count of open proposals across every subreddit - drives the global badge. */
export function openProposalCountAcross (entries: SubredditProposals[],): number {
	let count = 0
	for (const {data,} of entries) {
		for (const proposal of Object.values(data.proposals,)) {
			if (isOpen(proposal,)) { count++ }
		}
	}
	return count
}

/**
 * The current user's own proposals across every subreddit, newest first (the global
 * "My proposals" view).
 * @param entries Per-subreddit proposals from the fan-out.
 * @param user The current username.
 */
export function myProposalsAcross (entries: SubredditProposals[], user: string,): ProposalAt[] {
	if (!user) { return [] }
	return collectAcross(entries, (p,) => isBy(p, user,),)
}

/**
 * The current user's resolved-but-unacknowledged proposals across every subreddit -
 * the proposer's contribution to the global badge.
 * @param entries Per-subreddit proposals from the fan-out.
 * @param user The current username.
 */
export function myUnacknowledgedResolvedAcross (entries: SubredditProposals[], user: string,): ProposalAt[] {
	if (!user) { return [] }
	return collectAcross(entries, (p,) => isBy(p, user,) && isTerminalStatus(p.status,) && !p.ackedByProposer,)
}
