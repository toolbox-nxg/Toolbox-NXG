/**
 * Storage-level operations on a subreddit's proposals, built on the conflict-safe
 * {@link mutateProposals}. These are the verbs the gateway (capture), the replay
 * executor (accept), and the UI (reject/dismiss/prune) call; none of them perform
 * a real moderation action - that lives in the Block 2 replay executor.
 *
 * Every write goes through `mutateProposals`, so each returns a typed result and a
 * stale write against an already-resolved proposal fails cleanly instead of
 * clobbering a verdict.
 */

import {readWikiPageVersioned,} from '../../../api/resources/wikiVersioned'
import {mapWithConcurrency,} from '../../../util/data/async'
import {nowInSeconds,} from '../../../util/data/time'
import {proposalsCodec,} from '../../../util/wiki/schemas/proposals/codec'
import {
	canTransition,
	isReplayClaimActive,
	isTerminalStatus,
	type ObsoleteReason,
	type Proposal,
	type ProposalsData,
	type ProposalStatus,
} from '../../../util/wiki/schemas/proposals/schema'
import {getCachedProposals, isProposalsCacheFresh, setCachedProposals,} from './events'
import {mutateProposals,} from './mutate'
import {getProposalsPagePath,} from './paths'
import type {SubredditProposals,} from './selectors'
import {sameUsername,} from './usernames'

/** Default ceiling on simultaneous wiki reads during a cross-subreddit fan-out. */
const DEFAULT_FANOUT_CONCURRENCY = 6

/** Username sentinel recorded as the resolver when a proposal auto-resolves. */
export const SYSTEM_RESOLVER = '[system]'

/**
 * The typed result of a proposal mutation.
 * - `ok` - the change was applied (`proposal` is the new state).
 * - otherwise `reason` explains why nothing changed; `current` is the live
 *   proposal when one exists (e.g. for "already resolved by u/X" messaging).
 */
export type ProposalMutationResult =
	| {ok: true; proposal: Proposal}
	| {ok: false; reason: 'not-found'; current?: undefined}
	| {ok: false; reason: 'already-resolved' | 'invalid-transition' | 'in-progress'; current: Proposal}

/** Generates a collision-free proposal id. */
export function createProposalId (): string {
	return globalThis.crypto.randomUUID()
}

/** In-flight cold-cache reads, keyed by subreddit, so concurrent callers share one fetch. */
const inFlightReads = new Map<string, Promise<ProposalsData>>()

/**
 * Reads a subreddit's proposals for display. Returns the session cache when warm
 * unless `force` is set, otherwise fetches canonically and caches the result.
 * Pure read - never writes the wiki (reconciliation/pruning are explicit
 * mutations, never side effects of a display read).
 *
 * Concurrent cold-cache reads of the same subreddit are coalesced into a single wiki
 * fetch (e.g. when many inline badges mount in the same tick), so a queue render does
 * not fire N duplicate reads of the same page before the first one populates the cache.
 * @param subreddit The subreddit to load.
 * @param opts `force: true` bypasses both the cache and the in-flight coalescing.
 */
export function loadProposals (
	subreddit: string,
	opts: {force?: boolean} = {},
): Promise<ProposalsData> {
	if (!opts.force) {
		const cached = getCachedProposals(subreddit,)
		if (cached) { return Promise.resolve(cached,) }
		const inFlight = inFlightReads.get(subreddit,)
		if (inFlight) { return inFlight }
	}
	const read = (async () => {
		const {data,} = await readWikiPageVersioned(subreddit, getProposalsPagePath(), proposalsCodec,)
		// Store monotonically (by page version): a force-read served stale by wiki
		// read-after-write lag must not clobber newer data this tab already holds from a
		// commit or broadcast. Return the cache winner so the caller sees that newer data.
		setCachedProposals(subreddit, data,)
		return getCachedProposals(subreddit,) ?? data
	})()
	if (!opts.force) {
		inFlightReads.set(subreddit, read,)
		// Clear the in-flight entry once settled (success or failure) so a later read
		// re-fetches; by resolution the cache is populated, so followers hit the cache.
		// Use then(cleanup, cleanup) rather than finally().catch so a rejection on this
		// bookkeeping chain is consumed (never unhandled) while the caller still observes
		// the failure through the returned `read`.
		const clearInFlight = () => {
			if (inFlightReads.get(subreddit,) === read) { inFlightReads.delete(subreddit,) }
		}
		void read.then(clearInFlight, clearInFlight,)
	}
	return read
}

/**
 * The result of a cross-subreddit fan-out: one entry per subreddit (failing subs
 * contribute empty data so the aggregate is always complete) plus the names of the
 * subreddits whose read threw, so the UI can distinguish "no proposals" from
 * "couldn't load" and offer a targeted retry.
 */
export interface FanoutResult {
	/** One entry per requested subreddit, in request order. */
	entries: SubredditProposals[]
	/** Subreddits whose read failed (empty when everything loaded). */
	failedSubs: string[]
}

/**
 * Reads several subreddits' proposals concurrently for the cross-subreddit views.
 * Each subreddit degrades independently: a sub with no proposals page, no wiki
 * access, or a transient read failure contributes empty data rather than failing the
 * whole batch (`readWikiPageVersioned` already maps "no page / no perm" to empty; this
 * adds a catch for unexpected throws), and its name is collected in `failedSubs`.
 * Reads honor the session cache, optionally refreshing entries older than `maxAgeMs`
 * so reopening a view re-fetches stale subs without re-scanning fresh ones.
 * @param subreddits The subreddits to read.
 * @param opts `maxAgeMs` forces a refetch of caches older than this; `concurrency`
 *   caps simultaneous reads (default {@link DEFAULT_FANOUT_CONCURRENCY}).
 */
export async function loadProposalsForSubs (
	subreddits: readonly string[],
	opts: {maxAgeMs?: number; concurrency?: number} = {},
): Promise<FanoutResult> {
	const concurrency = opts.concurrency ?? DEFAULT_FANOUT_CONCURRENCY
	const failedSubs: string[] = []
	const entries = await mapWithConcurrency(
		subreddits,
		concurrency,
		async (subreddit,): Promise<SubredditProposals> => {
			// Refetch only when a freshness window is set and the cache is stale (or
			// missing); otherwise reuse any cached data.
			const force = opts.maxAgeMs !== undefined && !isProposalsCacheFresh(subreddit, opts.maxAgeMs,)
			try {
				return {subreddit, data: await loadProposals(subreddit, {force,},),}
			} catch {
				// Per-sub fallback: never let one subreddit's failure sink the aggregate,
				// but record it so the caller can surface a retry.
				failedSubs.push(subreddit,)
				return {subreddit, data: {ver: 1, proposals: {},},}
			}
		},
	)
	return {entries, failedSubs,}
}

/**
 * Appends a new proposal. Idempotent on id: if a proposal with the same id is
 * already present, no write happens and the existing one is returned.
 * @param subreddit The subreddit to write to.
 * @param proposal The fully-built proposal (id already assigned).
 */
export function appendProposal (subreddit: string, proposal: Proposal,): Promise<ProposalMutationResult> {
	return mutateProposals<ProposalMutationResult>(subreddit, (data,) => {
		const existing = data.proposals[proposal.id]
		if (existing) {
			return {write: false, result: {ok: true, proposal: existing,},}
		}
		data.proposals[proposal.id] = proposal
		return {write: true, result: {ok: true, proposal,},}
	}, `propose ${proposal.action.type} on ${proposal.itemId}`,)
}

/**
 * Removes (in place) every resolved proposal the proposer has acknowledged, or whose
 * resolution is older than the retention window. Pending and `needs_attention`
 * proposals are always kept. The shared core of {@link pruneResolvedProposals} and
 * the opportunistic prune folded into resolve writes.
 * @param data The proposals data to mutate.
 * @param retentionDays Days to keep a resolved-but-unacknowledged proposal.
 * @param now Current epoch seconds.
 * @returns The number of proposals removed.
 */
function pruneInPlace (data: ProposalsData, retentionDays: number, now: number,): number {
	const cutoff = now - retentionDays * 24 * 60 * 60
	let pruned = 0
	for (const [id, proposal,] of Object.entries(data.proposals,)) {
		if (!isTerminalStatus(proposal.status,)) { continue }
		// Acked terminal proposals are always prune-eligible. For age-based pruning, require
		// a real resolvedAt: every normal transition sets it, so a terminal proposal lacking
		// a numeric one is legacy/tampered data whose true resolution time is unknown -
		// falling back to updatedAt could prune it earlier than the retention window intends,
		// so keep it until the proposer acks it.
		const ageEligible = typeof proposal.resolvedAt === 'number' && proposal.resolvedAt < cutoff
		if (proposal.ackedByProposer || ageEligible) {
			delete data.proposals[id]
			pruned++
		}
	}
	return pruned
}

/**
 * Applies a status transition to one proposal, enforcing {@link canTransition}.
 * Internal helper behind {@link rejectProposal}/{@link markProposalObsolete} and
 * accept/needs-attention (via the gateway).
 *
 * When `pruneRetentionDays` is given, the same write that resolves this proposal
 * also prunes resolved/acked proposals past the retention window - opportunistic
 * maintenance with no extra I/O, and never as a side effect of a display read. The
 * just-resolved proposal keeps a fresh `resolvedAt`, so it is never pruned here.
 * @param subreddit The subreddit to mutate.
 * @param id The proposal id.
 * @param to The target status.
 * @param patch Extra fields to set alongside the status (e.g. resolvedBy, feedback).
 * @param reason The wiki revision note.
 * @param pruneRetentionDays Retention window (days) to prune by in the same write, or
 *   omit to skip pruning.
 */
export function transitionProposal (
	subreddit: string,
	id: string,
	to: ProposalStatus,
	patch: Partial<Proposal>,
	reason: string,
	pruneRetentionDays?: number,
): Promise<ProposalMutationResult> {
	const now = nowInSeconds()
	return mutateProposals<ProposalMutationResult>(subreddit, (data,) => {
		const current = data.proposals[id]
		if (!current) {
			return {write: false, result: {ok: false, reason: 'not-found',},}
		}
		// A needs_attention -> needs_attention move is a diagnostic refresh, not a real
		// status change (canTransition rejects from === to). When a reviewer retries an
		// accept that fails again, this lets us re-record the latest failure detail
		// instead of silently keeping the stale one from the first attempt.
		const isNeedsAttentionRefresh = to === 'needs_attention' && current.status === 'needs_attention'
		if (!isNeedsAttentionRefresh && !canTransition(current.status, to,)) {
			return {
				write: false,
				result: {
					ok: false,
					reason: isTerminalStatus(current.status,) ? 'already-resolved' : 'invalid-transition',
					current,
				},
			}
		}
		// A live accept claim means a replay is in flight. Refuse a competing resolution
		// (reject/obsolete) that would mark this proposal resolved out from under the
		// in-flight accept - otherwise the real action lands, then the accept's own
		// `accepted` write loses, leaving a record that contradicts what actually happened.
		// The accept's own resolutions (`accepted` on success, `needs_attention` on failure)
		// hold the claim and must proceed.
		if ((to === 'rejected' || to === 'obsolete') && isReplayClaimActive(current.replayClaim, now,)) {
			return {write: false, result: {ok: false, reason: 'in-progress', current,},}
		}
		const updated: Proposal = {...current, ...patch, status: to, updatedAt: now,}
		// Any status change makes an in-flight replay claim moot (the accept it guarded
		// either resolved this proposal or failed into needs_attention, which is freely
		// retryable), so always drop it rather than leave a stale claim on the record.
		delete updated.replayClaim
		data.proposals[id] = updated
		if (pruneRetentionDays !== undefined) {
			pruneInPlace(data, pruneRetentionDays, now,)
		}
		return {write: true, result: {ok: true, proposal: updated,},}
	}, reason,)
}

/**
 * The typed result of a {@link claimProposalForReplay} attempt.
 * - `ok` - this reviewer now holds the claim (`proposal` is the freshly-claimed state,
 *   authoritative for the replay).
 * - otherwise `reason` explains why the claim was refused; `current` is the live proposal
 *   when one exists (for messaging and to surface who else is mid-accept).
 */
export type ProposalClaimResult =
	| {ok: true; proposal: Proposal}
	| {ok: false; reason: 'not-found'; current?: undefined}
	| {ok: false; reason: 'already-resolved' | 'irreversible-retry' | 'in-progress'; current: Proposal}

/**
 * Atomically claims a proposal for replay: the conditional wiki write is the
 * compare-and-set that lets only one of several concurrent reviewers begin the accept,
 * so an irreversible action can never be replayed twice. Re-checks the accept
 * preconditions against the *fresh* page (not the caller's possibly-stale snapshot):
 * a now-terminal proposal is `already-resolved`, a `needs_attention` proposal that
 * already landed an irreversible side effect is `irreversible-retry`, and a proposal
 * any accept is actively replaying (a live, non-expired claim, even on the same account)
 * is `in-progress`. Only an expired claim - a crashed holder - is reclaimable. On
 * success the returned proposal is the one to replay.
 * @param subreddit The subreddit to mutate.
 * @param id The proposal id.
 * @param reviewer Username of the accepting moderator.
 */
export function claimProposalForReplay (
	subreddit: string,
	id: string,
	reviewer: string,
): Promise<ProposalClaimResult> {
	const now = nowInSeconds()
	return mutateProposals<ProposalClaimResult>(subreddit, (data,) => {
		const current = data.proposals[id]
		if (!current) {
			return {write: false, result: {ok: false, reason: 'not-found',},}
		}
		if (isTerminalStatus(current.status,)) {
			return {write: false, result: {ok: false, reason: 'already-resolved', current,},}
		}
		// A prior accept of a composite action may have already landed an irreversible step
		// before a later one failed; replaying the whole pipeline would double-apply it.
		if (current.status === 'needs_attention' && current.needsAttention?.irreversibleSideEffect) {
			return {write: false, result: {ok: false, reason: 'irreversible-retry', current,},}
		}
		// A live claim - by anyone, including this same reviewer - means a replay is already
		// in flight (a second drawer, tab, double-click, or Accept + Edit & Accept on one
		// account), so refuse rather than perform the side effect twice. A *failed* accept
		// clears its own claim (every transition does), so a still-active claim genuinely
		// means in-flight; only an expired claim (crashed holder) is reclaimable.
		if (isReplayClaimActive(current.replayClaim, now,)) {
			return {write: false, result: {ok: false, reason: 'in-progress', current,},}
		}
		const updated: Proposal = {...current, replayClaim: {by: reviewer, at: now,}, updatedAt: now,}
		data.proposals[id] = updated
		return {write: true, result: {ok: true, proposal: updated,},}
	}, `claim ${id} for replay`,)
}

/**
 * Releases this reviewer's replay claim on a proposal (a no-op if they don't hold it or
 * the proposal is gone), so a perform that failed before resolving the proposal doesn't
 * block a retry until the claim expires. Resolving the proposal clears the claim on its
 * own - this is only for the abandon/failure paths that leave it pending.
 * @param subreddit The subreddit to mutate.
 * @param id The proposal id.
 * @param reviewer Username whose claim to release.
 */
export function releaseProposalClaim (subreddit: string, id: string, reviewer: string,): Promise<void> {
	return mutateProposals<void>(subreddit, (data,) => {
		const current = data.proposals[id]
		if (!current || !current.replayClaim || !sameUsername(current.replayClaim.by, reviewer,)) {
			return {write: false, result: undefined,}
		}
		const {replayClaim: _released, ...rest} = current
		data.proposals[id] = {...rest, updatedAt: nowInSeconds(),}
		return {write: true, result: undefined,}
	}, `release replay claim ${id}`,)
}

/**
 * Rejects a proposal with optional reviewer feedback.
 * @param subreddit The subreddit to mutate.
 * @param id The proposal id.
 * @param reviewer Username of the rejecting moderator.
 * @param feedback Optional explanation shown to the proposer.
 * @param pruneRetentionDays Retention window (days) to prune by in the same write, or
 *   omit to skip pruning.
 */
export function rejectProposal (
	subreddit: string,
	id: string,
	reviewer: string,
	feedback?: string,
	pruneRetentionDays?: number,
): Promise<ProposalMutationResult> {
	return transitionProposal(
		subreddit,
		id,
		'rejected',
		{
			resolvedBy: reviewer,
			resolvedAt: nowInSeconds(),
			...(feedback ? {feedback,} : {}),
		},
		`reject proposal ${id}`,
		pruneRetentionDays,
	)
}

/**
 * Auto-resolves a proposal to `obsolete` (target deleted or actioned elsewhere).
 * @param subreddit The subreddit to mutate.
 * @param id The proposal id.
 * @param obsoleteReason Why it became obsolete.
 */
export function markProposalObsolete (
	subreddit: string,
	id: string,
	obsoleteReason: ObsoleteReason,
): Promise<ProposalMutationResult> {
	return transitionProposal(subreddit, id, 'obsolete', {
		resolvedBy: SYSTEM_RESOLVER,
		resolvedAt: nowInSeconds(),
		obsoleteReason,
	}, `obsolete proposal ${id} (${obsoleteReason})`,)
}

/**
 * Marks a resolved proposal as acknowledged by its proposer (clears it from the
 * proposer's "My proposals" badge and makes it eligible for pruning). Allowed on
 * any existing proposal regardless of status; only the proposer should call this
 * (enforced at the gateway/UI).
 *
 * When `pruneRetentionDays` is given, the same write also prunes resolved/acked
 * proposals past the retention window - so dismissing a resolved proposal removes it
 * immediately (an acked terminal proposal is always prune-eligible) rather than
 * lingering until a later maintenance pass.
 * @param subreddit The subreddit to mutate.
 * @param id The proposal id.
 * @param pruneRetentionDays Retention window (days) to prune by in the same write, or
 *   omit to skip pruning.
 */
export function dismissProposal (
	subreddit: string,
	id: string,
	pruneRetentionDays?: number,
): Promise<ProposalMutationResult> {
	const now = nowInSeconds()
	return mutateProposals<ProposalMutationResult>(subreddit, (data,) => {
		const current = data.proposals[id]
		if (!current) {
			return {write: false, result: {ok: false, reason: 'not-found',},}
		}
		if (current.ackedByProposer) {
			return {write: false, result: {ok: true, proposal: current,},}
		}
		const updated: Proposal = {...current, ackedByProposer: true, updatedAt: now,}
		data.proposals[id] = updated
		if (pruneRetentionDays !== undefined) {
			pruneInPlace(data, pruneRetentionDays, now,)
		}
		return {write: true, result: {ok: true, proposal: updated,},}
	}, `dismiss proposal ${id}`,)
}

/**
 * Prunes resolved proposals that the proposer has acknowledged, or whose
 * resolution is older than the subreddit's retention window. Pending and
 * `needs_attention` proposals are always kept. Explicit maintenance call - never
 * run as a side effect of a display read.
 * @param subreddit The subreddit to prune.
 * @param retentionDays Days to keep a resolved-but-unacknowledged proposal.
 * @param now Current epoch seconds (injectable for tests; defaults to now).
 * @returns The number of proposals pruned.
 */
export function pruneResolvedProposals (
	subreddit: string,
	retentionDays: number,
	now: number = nowInSeconds(),
): Promise<number> {
	return mutateProposals<number>(subreddit, (data,) => {
		const pruned = pruneInPlace(data, retentionDays, now,)
		return pruned > 0
			? {write: true, result: pruned,}
			: {write: false, result: 0,}
	}, `prune ${retentionDays}d resolved proposals`,)
}
