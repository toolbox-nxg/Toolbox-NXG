/**
 * The proposals gateway - the single entry point UI surfaces call instead of
 * performing a moderation action directly.
 *
 * - {@link maybePropose} decides capture-vs-execute at an action chokepoint. When
 *   the current user is sandboxed for the subreddit (training mode) or explicitly
 *   asked for review (`force`), it captures the action as a proposal and returns
 *   `true` so the caller aborts its real pipeline.
 * - {@link performProposal} replays an accepted proposal's frozen intent inside an
 *   authorized replay context and marks it accepted only on full success; a
 *   partial failure records `needs_attention` instead.
 *
 * Built-in replay for the atomic `approve`/`remove` actions lives here (this module
 * is the allowlisted replay executor, so it may import the primitives). Composite
 * actions (e.g. `removal-reason`) register their replay handler via
 * {@link registerReplayHandler} from their own module, keeping this substrate free
 * of feature-module imports.
 */

import {flairUser,} from '../../../api/resources/flair'
import {banUser, muteUser, unbanUser, unmuteUser,} from '../../../api/resources/relationships'
import {
	approveThing,
	distinguishThing,
	lock,
	markOver18,
	removeThing,
	stickyThread,
	unlock,
	unMarkOver18,
	unstickyThread,
} from '../../../api/resources/things'
import {assertNever,} from '../../../util/data/assertNever'
import {nowInSeconds,} from '../../../util/data/time'
import {isCaptureActiveFor, runInReplay,} from '../../../util/infra/captureGuard'
import {
	isTerminalStatus,
	type Proposal,
	type ProposalItemKind,
	type ProposedAction,
	type ProposedActionType,
} from '../../../util/wiki/schemas/proposals/schema'
import {
	appendProposal,
	claimProposalForReplay,
	createProposalId,
	type ProposalMutationResult,
	transitionProposal,
} from './moduleapi'
import {isMarkedForReview, setReviewMode,} from './reviewMode'
import {sameUsername,} from './usernames'

/** Context for a capture decision at an action chokepoint. */
export interface ProposalContext {
	/** Subreddit the action targets. */
	subreddit: string
	/** Fullname of the targeted thing. */
	itemId: string
	/** Whether the target is a post or comment. */
	itemKind: ProposalItemKind
	/** Squashed/relative permalink for display, if known. */
	link?: string
	/** Optional rationale from the proposer. */
	note?: string
	/** When true, force capture as an explicit second-opinion request. */
	force?: boolean
}

/** Returns the username to record as the proposer/reviewer. Wired in Block 3.
 *  May be async so the gateway can await the current-user load before capture (the
 *  forced second-opinion branch skips the trainee-state path that otherwise awaits it). */
type CurrentUserProvider = () => string | Promise<string>

let currentUserProvider: CurrentUserProvider = () => ''

/**
 * Installs the provider that returns the current logged-in username (wired by the
 * proposals module from cached session state; injectable for tests).
 * @param provider Returns the current username.
 */
export function setCurrentUserProvider (provider: CurrentUserProvider,): void {
	currentUserProvider = provider
}

/**
 * Decides, possibly asynchronously, whether the current user is sandboxed (capture
 * mode) for a subreddit. The proposals module installs one that awaits the warm
 * config so the decision is accurate even before the trainee state is cached; the
 * default mirrors the synchronous capture-guard predicate.
 */
type CaptureDecider = (subreddit: string,) => boolean | Promise<boolean>

let captureDecider: CaptureDecider = (subreddit,) => isCaptureActiveFor(subreddit,)

/**
 * Installs the capture decision used by {@link maybePropose}. Injectable for tests;
 * wired to the warm trainee state by the proposals module.
 * @param decider Per-subreddit capture-active check (sync or async).
 */
export function setCaptureDecider (decider: CaptureDecider,): void {
	captureDecider = decider
}

/**
 * Decides whether a given action *type* is guarded (captured) for a subreddit, once
 * the user is known to be a trainee there. Lets a subreddit guard only some actions
 * (e.g. removes but not approves). The proposals module wires one backed by warm
 * config; the default guards everything, preserving the original all-or-nothing
 * behavior (and keeping tests that don't install one unchanged).
 */
type ActionGuardDecider = (subreddit: string, actionType: ProposedActionType,) => boolean | Promise<boolean>

let actionGuardDecider: ActionGuardDecider = () => true

/**
 * Installs the per-action guard decision used by {@link maybePropose}. Injectable for
 * tests; wired to the warm guarded-action config by the proposals module.
 * @param decider Per-subreddit, per-action-type guard check (sync or async).
 */
export function setActionGuardDecider (decider: ActionGuardDecider,): void {
	actionGuardDecider = decider
}

/**
 * Decides whether to capture `action` as a proposal instead of performing it.
 * @param action The fully-frozen action to capture.
 * @param ctx Where/what the action targets and whether review is forced.
 * @returns `true` if captured (caller MUST abort its real pipeline), else `false`.
 */
export async function maybePropose (action: ProposedAction, ctx: ProposalContext,): Promise<boolean> {
	// An explicit `force`, or the item being armed for review via the inline toggle, both
	// mean "capture this as a second-opinion request" regardless of training state - a
	// second opinion is an explicit per-item request, so it ignores the guarded-action set.
	const forced = ctx.force === true || isMarkedForReview(ctx.itemId,)
	// Otherwise capture only when the user is a trainee here AND this action type is one the
	// subreddit guards. An un-guarded action falls through to the caller's perform branch
	// (authorized past the fail-closed backstop via runInReplay there).
	const capture = forced
		|| (await captureDecider(ctx.subreddit,) && await actionGuardDecider(ctx.subreddit, action.type,))
	if (!capture) { return false }

	// Resolve the proposer up front. The forced second-opinion branch skips the
	// captureDecider path (the only one that awaits the current-user load), so await
	// here too - otherwise an early capture is written with proposedBy: '' and the
	// codec drops it as malformed on the next read. Fail visibly rather than persist
	// data that will silently vanish.
	const proposedBy = await currentUserProvider()
	if (!proposedBy) {
		throw new Error('proposals: cannot capture an action without a resolved current user',)
	}

	const now = nowInSeconds()
	const proposal: Proposal = {
		id: createProposalId(),
		itemId: ctx.itemId,
		itemKind: ctx.itemKind,
		action,
		proposedBy,
		proposedAt: now,
		updatedAt: now,
		source: forced ? 'second-opinion' : 'training',
		status: 'pending',
		...(ctx.note ? {note: ctx.note,} : {}),
		...(ctx.link ? {link: ctx.link,} : {}),
	}
	await appendProposal(ctx.subreddit, proposal,)
	// Disarm the one-shot review toggle now that this item's action has been captured.
	setReviewMode(ctx.itemId, false,)
	return true
}

/** Outcome of a propose-or-perform helper: captured for review, or performed for real. */
export type ProposeOrPerformResult = 'captured' | 'performed'

/**
 * Captures a plain remove as a proposal when sandboxed/forced, otherwise performs
 * the real removal. UI calls this instead of importing `removeThing`, so the
 * static reachability guard can keep moderation primitives out of UI code.
 * @param ctx Where/what the removal targets and whether review is forced.
 * @param spam Whether to remove as spam.
 */
export async function proposeOrRemove (ctx: ProposalContext, spam: boolean,): Promise<ProposeOrPerformResult> {
	if (await maybePropose({type: 'remove', spam,}, ctx,)) { return 'captured' }
	// Authorized perform: a trainee whose sub doesn't guard this action still performs it,
	// so wrap past the fail-closed backstop (a no-op for non-trainees). Same for the helpers below.
	await runInReplay(() => removeThing(ctx.itemId, spam,))
	return 'performed'
}

/**
 * Performs a real removal for an accept surface (the Edit-&-Accept overlay's "Silently
 * remove"), bypassing capture entirely. Runs in the authorized replay window so it still
 * performs even if the accepting reviewer happens to be a trainee in this subreddit - an
 * accept surface must always perform, never re-capture. UI calls this instead of
 * importing `removeThing`.
 * @param ctx Where/what the removal targets.
 * @param spam Whether to remove as spam.
 */
export async function performRemoval (ctx: ProposalContext, spam: boolean,): Promise<void> {
	await runInReplay(() => removeThing(ctx.itemId, spam,))
}

/**
 * Captures an approve as a proposal when sandboxed/forced, otherwise performs the
 * real approval. UI calls this instead of importing `approveThing`.
 * @param ctx Where/what the approval targets and whether review is forced.
 */
export async function proposeOrApprove (ctx: ProposalContext,): Promise<ProposeOrPerformResult> {
	if (await maybePropose({type: 'approve',}, ctx,)) { return 'captured' }
	await runInReplay(() => approveThing(ctx.itemId,))
	return 'performed'
}

/** Captures or performs a lock on the target thing. */
export async function proposeOrLock (ctx: ProposalContext,): Promise<ProposeOrPerformResult> {
	if (await maybePropose({type: 'lock',}, ctx,)) { return 'captured' }
	await runInReplay(() => lock(ctx.itemId,))
	return 'performed'
}

/** Captures or performs an unlock on the target thing. */
export async function proposeOrUnlock (ctx: ProposalContext,): Promise<ProposeOrPerformResult> {
	if (await maybePropose({type: 'unlock',}, ctx,)) { return 'captured' }
	await runInReplay(() => unlock(ctx.itemId,))
	return 'performed'
}

/** Captures or performs a distinguish on the target thing. */
export async function proposeOrDistinguish (ctx: ProposalContext, sticky: boolean,): Promise<ProposeOrPerformResult> {
	if (await maybePropose({type: 'distinguish', sticky,}, ctx,)) { return 'captured' }
	await runInReplay(() => distinguishThing(ctx.itemId, sticky,))
	return 'performed'
}

/** Captures or performs marking the target post NSFW (`nsfw: false` unmarks it). */
export async function proposeOrMarkNsfw (ctx: ProposalContext, nsfw: boolean,): Promise<ProposeOrPerformResult> {
	if (await maybePropose({type: 'marknsfw', nsfw,}, ctx,)) { return 'captured' }
	await runInReplay(() => nsfw ? markOver18(ctx.itemId,) : unMarkOver18(ctx.itemId,))
	return 'performed'
}

/** Captures or performs stickying the target submission into `num`'s slot (1 or 2). */
export async function proposeOrSticky (
	ctx: ProposalContext,
	num: number | undefined,
): Promise<ProposeOrPerformResult> {
	if (await maybePropose({type: 'sticky', state: true, ...(num !== undefined ? {num,} : {}),}, ctx,)) {
		return 'captured'
	}
	await runInReplay(() => stickyThread(ctx.itemId, num,))
	return 'performed'
}

/** Captures or performs unstickying the target submission. */
export async function proposeOrUnsticky (ctx: ProposalContext,): Promise<ProposeOrPerformResult> {
	if (await maybePropose({type: 'sticky', state: false,}, ctx,)) { return 'captured' }
	await runInReplay(() => unstickyThread(ctx.itemId,))
	return 'performed'
}

/** Captures or performs setting the target user's flair. `ctx.itemId` is the username. */
export async function proposeOrUserFlair (
	ctx: ProposalContext,
	flair: {text?: string; cssClass?: string; templateID?: string},
): Promise<ProposeOrPerformResult> {
	if (await maybePropose({type: 'userflair', ...flair,}, ctx,)) { return 'captured' }
	await runInReplay(() => flairUser({user: ctx.itemId, subreddit: ctx.subreddit, ...flair,},))
	return 'performed'
}

/** Parameters for a ban (the resolved values, ready to perform or freeze). */
export interface BanParams {
	permanent: boolean
	days: number
	note: string
	message: string
	context?: string
}

/**
 * Captures or performs a ban. `ctx.itemId` is the target username and
 * `ctx.itemKind` is `'user'`.
 */
export async function proposeOrBan (ctx: ProposalContext, params: BanParams,): Promise<ProposeOrPerformResult> {
	const action = {type: 'ban' as const, ...params,}
	if (await maybePropose(action, ctx,)) { return 'captured' }
	await runInReplay(() =>
		banUser({
			user: ctx.itemId,
			subreddit: ctx.subreddit,
			note: params.note,
			banMessage: params.message,
			banDuration: params.permanent ? 0 : params.days,
			...(params.context ? {banContext: params.context,} : {}),
		},)
	)
	return 'performed'
}

/** Captures or performs an unban of `ctx.itemId` (username). */
export async function proposeOrUnban (ctx: ProposalContext,): Promise<ProposeOrPerformResult> {
	if (await maybePropose({type: 'unban',}, ctx,)) { return 'captured' }
	await runInReplay(() => unbanUser(ctx.subreddit, ctx.itemId,))
	return 'performed'
}

/** Captures or performs a mute of `ctx.itemId` (username). */
export async function proposeOrMute (
	ctx: ProposalContext,
	params: {duration?: number; note?: string} = {},
): Promise<ProposeOrPerformResult> {
	if (await maybePropose({type: 'mute', ...params,}, ctx,)) { return 'captured' }
	await runInReplay(() =>
		muteUser({
			user: ctx.itemId,
			subreddit: ctx.subreddit,
			...(params.note ? {note: params.note,} : {}),
			...(params.duration ? {duration: params.duration,} : {}),
		},)
	)
	return 'performed'
}

/** Captures or performs an unmute of `ctx.itemId` (username). */
export async function proposeOrUnmute (ctx: ProposalContext,): Promise<ProposeOrPerformResult> {
	if (await maybePropose({type: 'unmute',}, ctx,)) { return 'captured' }
	await runInReplay(() => unmuteUser(ctx.subreddit, ctx.itemId,))
	return 'performed'
}

/**
 * Whether training/second-opinion capture is active for the current user in
 * `subreddit`. Bulk-action surfaces (which v1 does not capture) call this to refuse
 * gracefully in training mode instead of letting the per-item guard fail-close
 * mid-batch.
 * @param subreddit The subreddit to check.
 */
export async function isTrainingCaptureActive (subreddit: string,): Promise<boolean> {
	return (await captureDecider(subreddit,)) === true
}

/**
 * Reviewer edits applied to a proposal at accept time (accept-with-edit). Only the
 * fields a reviewer can tweak before replay; composite handlers merge these onto the
 * thawed intent. Currently the removal-reason message text only.
 */
export interface AcceptOverrides {
	/** Replacement composed reason text for a removal-reason proposal. */
	reasonText?: string
}

/** A function that replays one proposal's action. Registered per composite type.
 *  Receives the subreddit (proposals carry no subreddit field - it is the page's
 *  context) so composite handlers can re-fetch item metadata as needed, plus any
 *  reviewer overrides to merge in. */
type ReplayHandler = (subreddit: string, proposal: Proposal, overrides?: AcceptOverrides,) => Promise<void>

const replayHandlers = new Map<ProposedAction['type'], ReplayHandler>()

/**
 * Registers the replay handler for a composite action type (e.g. `removal-reason`),
 * called from the owning module so this substrate stays feature-agnostic.
 * @param type The action discriminant to handle.
 * @param handler Replays the action; must throw on failure.
 */
export function registerReplayHandler (type: ProposedAction['type'], handler: ReplayHandler,): void {
	replayHandlers.set(type, handler,)
}

/** Replays a proposal's action, dispatching atomic types inline and composite
 *  types to their registered handler. Runs in an authorized replay context.
 *  Reviewer `overrides` apply to composite replays only (atomic actions have no
 *  editable payload). */
async function replayProposal (subreddit: string, proposal: Proposal, overrides?: AcceptOverrides,): Promise<void> {
	const action = proposal.action
	// `itemId` is a thing fullname for thing actions and a username for user actions.
	const target = proposal.itemId
	switch (action.type) {
		case 'approve':
			await runInReplay(() => approveThing(target,))
			return
		case 'remove':
			await runInReplay(() => removeThing(target, action.spam,))
			return
		case 'lock':
			await runInReplay(() => lock(target,))
			return
		case 'unlock':
			await runInReplay(() => unlock(target,))
			return
		case 'distinguish':
			await runInReplay(() => distinguishThing(target, action.sticky,))
			return
		case 'marknsfw':
			await runInReplay(() => action.nsfw ? markOver18(target,) : unMarkOver18(target,))
			return
		case 'sticky':
			await runInReplay(() => stickyThread(target, action.num, action.state,))
			return
		case 'ban':
			await runInReplay(() =>
				banUser({
					user: target,
					subreddit,
					note: action.note,
					banMessage: action.message,
					banDuration: action.permanent ? 0 : action.days,
					...(action.context ? {banContext: action.context,} : {}),
				},)
			)
			return
		case 'unban':
			await runInReplay(() => unbanUser(subreddit, target,))
			return
		case 'mute':
			await runInReplay(() =>
				muteUser({
					user: target,
					subreddit,
					...(action.note ? {note: action.note,} : {}),
					...(action.duration ? {duration: action.duration,} : {}),
				},)
			)
			return
		case 'unmute':
			await runInReplay(() => unmuteUser(subreddit, target,))
			return
		case 'userflair':
			await runInReplay(() =>
				flairUser({
					user: target,
					subreddit,
					...(action.text !== undefined ? {text: action.text,} : {}),
					...(action.cssClass !== undefined ? {cssClass: action.cssClass,} : {}),
					...(action.templateID !== undefined ? {templateID: action.templateID,} : {}),
				},)
			)
			return
		case 'removal-reason':
			// Composite: dispatch to the handler the owning module registered (keeping this
			// substrate free of feature-module imports). The handler establishes its own
			// replay context around the pipeline.
			await replayComposite(action.type, subreddit, proposal, overrides,)
			return
		default:
			// Exhaustiveness: a new ProposedAction variant must add a case above (atomic) or
			// alongside `removal-reason` (composite), or this fails to compile.
			assertNever(action, 'proposed-action',)
	}
}

/** Replays a composite action via the handler registered by its owning module. */
async function replayComposite (
	type: ProposedActionType,
	subreddit: string,
	proposal: Proposal,
	overrides?: AcceptOverrides,
): Promise<void> {
	const handler = replayHandlers.get(type,)
	if (!handler) {
		throw new Error(`no replay handler registered for action type "${type}"`,)
	}
	await handler(subreddit, proposal, overrides,)
}

/** The outcome of an accept attempt. */
export type PerformResult =
	| {ok: true; proposal: Proposal}
	| {
		ok: false
		reason:
			| 'not-found'
			| 'already-resolved'
			| 'invalid-transition'
			| 'self-accept'
			| 'replay-failed'
			| 'irreversible-retry'
			| 'in-progress'
		current?: Proposal
		error?: string
	}

/**
 * Accepts a proposal: replays its frozen action and, only on full success, marks it
 * `accepted`. A replay failure records `needs_attention` with step detail instead.
 * Enforces our workflow rules (Reddit's API is the real permission gate): a proposer
 * cannot self-accept their own second-opinion request, and terminal proposals
 * cannot be replayed. (The trainees-cannot-accept rule is applied at the UI in
 * Block 3, which knows the reviewer's trainee status.)
 *
 * The accept first {@link claimProposalForReplay | claims} the proposal in one atomic
 * write - the compare-and-set that makes two reviewers accepting the same proposal
 * serialize rather than both replaying the (irreversible) side effect. The claim also
 * re-checks the accept preconditions (terminal / irreversible-retry) against the fresh
 * page, so a stale caller snapshot can't slip a double-apply past them; a refused claim
 * is surfaced as `already-resolved`/`irreversible-retry`/`in-progress`. The replay then
 * uses the freshly-claimed state, not the caller's snapshot.
 * @param subreddit The subreddit the proposal belongs to.
 * @param proposal The proposal to accept (its current known state).
 * @param reviewer Username of the accepting moderator.
 * @param pruneRetentionDays Retention window (days) to prune resolved proposals by in
 *   the same write that marks this one accepted, or omit to skip pruning.
 * @param overrides Reviewer edits to merge into the action before replay (accept-with-
 *   edit); omit to replay the proposal exactly as captured.
 */
export async function performProposal (
	subreddit: string,
	proposal: Proposal,
	reviewer: string,
	pruneRetentionDays?: number,
	overrides?: AcceptOverrides,
): Promise<PerformResult> {
	// Fast paths off the caller snapshot, avoiding a claim write when the answer is
	// already clear from immutable/known-terminal state. The freshness-sensitive checks
	// (terminal-since, mid-replay, irreversible-retry against the *live* page) live in
	// the atomic claim below, which is what actually guards the double-action race.
	if (isTerminalStatus(proposal.status,)) {
		return {ok: false, reason: 'already-resolved', current: proposal,}
	}
	// Usernames are case-insensitive on Reddit; compare case-folded so a casing
	// mismatch between the stored proposer and the reviewer string can't let a
	// proposer slip past the self-accept guard for their own second-opinion request.
	if (proposal.source === 'second-opinion' && sameUsername(proposal.proposedBy, reviewer,)) {
		return {ok: false, reason: 'self-accept', current: proposal,}
	}

	// Claim before any side effect. This is the atomic gate: a now-terminal proposal, one
	// mid-replay by another reviewer, or one whose prior accept already landed an
	// irreversible step is refused here, before replay runs.
	const claim = await claimProposalForReplay(subreddit, proposal.id, reviewer,)
	if (!claim.ok) {
		return claim.current
			? {ok: false, reason: claim.reason, current: claim.current,}
			: {ok: false, reason: claim.reason,}
	}
	// Replay the freshly-claimed state, not the (possibly stale) caller snapshot.
	const claimed = claim.proposal

	try {
		await replayProposal(subreddit, claimed, overrides,)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err,)
		await transitionProposal(subreddit, claimed.id, 'needs_attention', {
			needsAttention: {
				attemptedBy: reviewer,
				attemptedAt: nowInSeconds(),
				failedStep: message,
				// A composite removal may have removed the item before a later step
				// failed; atomic actions are all-or-nothing.
				irreversibleSideEffect: claimed.action.type === 'removal-reason',
				error: message,
			},
		}, `accept failed for ${claimed.id}`,)
		return {ok: false, reason: 'replay-failed', error: message,}
	}

	const result: ProposalMutationResult = await transitionProposal(
		subreddit,
		claimed.id,
		'accepted',
		{
			resolvedBy: reviewer,
			resolvedAt: nowInSeconds(),
		},
		`accept ${claimed.id}`,
		pruneRetentionDays,
	)
	if (result.ok) {
		return {ok: true, proposal: result.proposal,}
	}
	return result.current
		? {ok: false, reason: result.reason, current: result.current,}
		: {ok: false, reason: result.reason,}
}
