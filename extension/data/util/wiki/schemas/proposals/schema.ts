/**
 * Schema version constants, types, and the state machine for the proposals
 * feature (training mode + second opinions).
 *
 * A *proposal* is a moderation action that was captured to the subreddit's
 * `toolbox-nxg/proposals` wiki page instead of being performed, so a reviewer can
 * Accept it (which performs the real action by replaying a frozen intent) or
 * Reject it with feedback. See `ACTION_SURFACE_CATALOG.md` for which surfaces are
 * captured and the module README/plan for the full design contracts.
 *
 * This file is the Block 0 "schema freeze": the `Proposal` envelope, the state
 * machine, and the removal-reason frozen intent (the first vertical spine) are
 * stable here. Additional `ProposedAction` variants (ban/mute, lock, distinguish,
 * macro composite, bulk) are added in Block 3 and intentionally not yet modeled.
 */

/** The current proposals schema version written to new wiki pages. */
export const proposalsSchema = 1
/** The minimum proposals schema version this build can read. */
export const proposalsMinSchema = 1
/** The maximum proposals schema version this build can read. */
export const proposalsMaxSchema = 1

/**
 * What a proposal targets. `post`/`comment` are things (itemId is a fullname);
 * `user` is a user-level action (itemId is the username).
 */
export type ProposalItemKind = 'post' | 'comment' | 'user'

/**
 * Why a proposal exists.
 * - `training` - captured implicitly because the proposer is on the subreddit's
 *   trainee list.
 * - `second-opinion` - captured because the proposer explicitly requested review,
 *   regardless of whether training mode is enabled for the subreddit.
 */
export type ProposalSource = 'training' | 'second-opinion'

/**
 * Lifecycle status of a proposal. See {@link isTerminalStatus} and
 * {@link canTransition} for the allowed transitions.
 * - `pending` - awaiting review.
 * - `accepted` - a reviewer accepted it AND the real action replay fully
 *   succeeded.
 * - `rejected` - a reviewer declined it (optionally with feedback).
 * - `obsolete` - auto-resolved without a verdict because the target went away
 *   (author deleted it) or was actioned elsewhere.
 * - `needs_attention` - an accept was attempted but replay failed partway; carries
 *   {@link NeedsAttentionDetail} so a reviewer can decide whether retry is safe.
 */
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'obsolete' | 'needs_attention'

/** Why a proposal auto-resolved to `obsolete`. */
export type ObsoleteReason =
	/** The author deleted the target (reliably detectable). */
	| 'deleted'
	/**
	 * The target was approved/removed outside the proposal flow. Persisted only on
	 * strong (modlog-derived) evidence - never on best-effort `getInfoBulk` flags.
	 */
	| 'already-actioned'

/** Delivery mode for a removal message; mirrors removalreasons' `ReasonType`. */
export type FrozenReasonType = 'reply' | 'pm' | 'both' | 'none'

/**
 * The subset of a thing's metadata the removal pipeline actually consumes. Kept
 * here (rather than referencing the heavy `RemovalReasonsData`) so the frozen
 * intent stays small and self-contained, and so `submitRemoval` can narrow its
 * `data` parameter to exactly these fields.
 */
export interface RemovalTarget {
	/** Reddit fullname (e.g. `t3_abc123`). */
	fullname: string
	/** `'submission'` or `'comment'`. */
	kind: string
	/** Subreddit the thing is in. */
	subreddit: string
	/** Author username (empty when unavailable). */
	author: string
	/** Permalink of the thing. */
	url: string
	/** Submission link (same as url for posts; parent post link for comments). */
	link: string
	/** Username of the acting moderator. */
	mod: string
	/** Log subreddit name, if removal logging is configured (empty otherwise). */
	logSub: string
}

/**
 * One selected reason captured for re-seeding the removal overlay on Edit & Accept.
 * Carries the persistent reason id (so the overlay can re-check it against current
 * config) and the resolved per-reason body (fill-in tokens substituted, inline edits
 * applied) so the overlay shows exactly what the trainee composed.
 */
export interface FrozenSelectionReason {
	/** Persistent `RemovalReason.id` of the selected template. */
	id: string
	/** Resolved per-reason message body (post fill-in substitution / inline edit). */
	text: string
	/** The reason's display title, for the overlay/preview; omitted when none. */
	title?: string
}

/**
 * The trainee's structured reason selection, captured **in addition to** the composed
 * `reasonText`, purely to re-seed the full removal overlay for "Edit & Accept". Display,
 * excerpts, and plain-Accept replay all use `reasonText` and never touch this.
 */
export interface FrozenRemovalSelection {
	/** Selected reasons in display order. */
	reasons: FrozenSelectionReason[]
	/** Whether the configured header was included; present only when a header is configured. */
	includeHeader?: boolean
	/** Whether the configured footer was included; present only when a footer is configured. */
	includeFooter?: boolean
}

/** Flair to apply during a removal (resolved values); present only when flairing. */
export interface FrozenRemovalFlair {
	text?: string
	cssClass?: string
	templateId?: string
}

/** Usernote to leave during a removal (resolved values); present only when leaving one. */
export interface FrozenRemovalUsernote {
	/** Note body text. */
	text: string
	/** Note type/tag key, if any. */
	type?: string
	/** Include a link to the removed content. */
	includeLink?: boolean
	/** Store the removal modmail conversation link on the note. */
	includeMessage?: boolean
}

/** Ban to issue during a removal (resolved values); present only when banning. */
export interface FrozenRemovalBan {
	/** Permanent ban (ignores `days`). */
	permanent: boolean
	/** Duration in days when not permanent. */
	days: number
	/** Ban mod note. */
	note: string
}

/**
 * The fully-rendered, post-templating intent for a removal-reasons proposal - the
 * first vertical spine. Replay reconstructs the full submission params from this
 * and hands them back to `submitRemoval`. It stores the resolved values (a reason
 * can be edited/deleted between propose and accept, so ids are NOT re-resolved),
 * but is **hand-curated to only what replay needs**: empty/default fields are
 * omitted, optional steps (flair/usernote/ban/log) are nested and present only when
 * used, subreddit usernote colors are re-fetched at replay time, and the item's own
 * metadata (author, permalink, kind, ...) is NOT stored - it is re-fetched from the
 * proposal's `itemId` at replay (the item still exists until accepted), with the
 * note attributed to the proposal's `proposedBy`. The mapping to/from
 * `SubmitRemovalParams` lives in the removalreasons `proposalAdapter`
 * (`freezeRemovalParams`/`thawRemovalIntent`); `thaw`'s return type guards that
 * every param the pipeline reads is reconstructed.
 */
export interface FrozenRemovalIntent {
	/** Final composed reason text, with header/footer and tokens already applied. */
	reasonText: string
	/**
	 * Display title(s) of the selected removal reason template(s), joined with ", " -
	 * captured for review so a reviewer can see *which* reason was chosen at a glance,
	 * not just its rendered body. Omitted when no selected reason has a title.
	 */
	reasonTitle?: string
	/** Delivery mode for the removal message. */
	reasonType: FrozenReasonType
	/** PM/modmail subject line (used for pm/modmail/ban delivery). */
	subject: string
	/** Log subreddit to cross-post the removal to; only when removal logging is on. */
	logSub?: string
	/** Log post title (before `{reason}` substitution); only when a log sub is set. */
	baseLogTitle?: string
	/** Public log reason substituted into `{reason}`; only when used. */
	logReasonText?: string
	/** Flair to apply; omitted when no flair. */
	flair?: FrozenRemovalFlair
	/** Sticky the removal reply comment; omitted when false. */
	reasonSticky?: boolean
	/** Send PM delivery via modmail as the subreddit; omitted when false. */
	reasonAsSub?: boolean
	/** Auto-archive the removal modmail conversation; omitted when false. */
	reasonAutoArchive?: boolean
	/** Post the removal reply as the subreddit (vs the mod); omitted when false. */
	reasonCommentAsSubreddit?: boolean
	/** Lock the removed thread; omitted when false. */
	actionLockThread?: boolean
	/** Lock the removal reply comment; omitted when false. */
	actionLockComment?: boolean
	/** Remove as spam (trains the spam filter) rather than a plain removal; omitted when false. */
	spam?: boolean
	/** Usernote to leave; omitted when none. */
	usernote?: FrozenRemovalUsernote
	/** Ban to issue; omitted when not banning. */
	ban?: FrozenRemovalBan
	/**
	 * The trainee's structured reason selection, for re-seeding the removal overlay on
	 * Edit & Accept. Additive metadata only - replay and display use `reasonText`.
	 * Omitted for captures that predate this field (Edit & Accept falls back to plain
	 * Accept when absent).
	 */
	selection?: FrozenRemovalSelection
}

/** A user ban captured for review (itemId is the target username). */
export interface ProposedBan {
	type: 'ban'
	/** Permanent ban (ignores `days`). */
	permanent: boolean
	/** Duration in days when not permanent. */
	days: number
	/** Mod note (private). */
	note: string
	/** Ban message sent to the user. */
	message: string
	/** Fullname of the thing that prompted the ban, for ban context (optional). */
	context?: string
}

/** A user mute captured for review (itemId is the target username). */
export interface ProposedMute {
	type: 'mute'
	/** Mute duration in days (Reddit's mute is fixed-length; stored for fidelity). */
	duration?: number
	/** Mod note (private). */
	note?: string
}

/**
 * The captured moderation action a proposal represents. Discriminated by `type`.
 * Thing-targeted: approve/remove/removal-reason/lock/unlock/distinguish/marknsfw/sticky
 * (itemId is a fullname). User-targeted: ban/unban/mute/unmute/userflair (itemId is the
 * username).
 */
export type ProposedAction =
	/** Approve the target. */
	| {type: 'approve'}
	/** Remove the target, optionally as spam. */
	| {type: 'remove'; spam: boolean}
	/** Remove via the full removal-reasons composite, replayed from a frozen intent. */
	| {type: 'removal-reason'; intent: FrozenRemovalIntent}
	/** Lock the target thing. */
	| {type: 'lock'}
	/** Unlock the target thing. */
	| {type: 'unlock'}
	/** Distinguish the target thing (optionally sticky). */
	| {type: 'distinguish'; sticky: boolean}
	/** Mark the target post NSFW (`nsfw: false` unmarks it). */
	| {type: 'marknsfw'; nsfw: boolean}
	/** Sticky the target submission into a slot, or unsticky it (`state: false`). */
	| {type: 'sticky'; state: boolean; num?: number}
	/** Ban the target user. */
	| ProposedBan
	/** Unban the target user. */
	| {type: 'unban'}
	/** Mute the target user. */
	| ProposedMute
	/** Unmute the target user. */
	| {type: 'unmute'}
	/** Set the target user's flair (text/cssClass/templateID as captured). */
	| {type: 'userflair'; text?: string; cssClass?: string; templateID?: string}

/**
 * The canonical roster of every proposed-action type, classified by how it replays:
 * `'atomic'` is replayed inline by the gateway via a single moderation primitive;
 * `'composite'` is a multi-step pipeline replayed through a registered handler.
 *
 * This is the **single source of truth** that ties the {@link ProposedAction} union
 * to its consumers (codec validation, gateway replay, UI labels). The
 * `satisfies Record<ProposedAction['type'], ...>` makes adding a variant to the union
 * without listing it here a compile error, and each consumer's exhaustive switch
 * (guarded by `assertNever`) then fails to compile until it handles the new case -
 * so a new action can never be silently dropped on read or fail only at accept time.
 */
export const PROPOSED_ACTION_KINDS = {
	'approve': 'atomic',
	'remove': 'atomic',
	'removal-reason': 'composite',
	'lock': 'atomic',
	'unlock': 'atomic',
	'distinguish': 'atomic',
	'marknsfw': 'atomic',
	'sticky': 'atomic',
	'ban': 'atomic',
	'unban': 'atomic',
	'mute': 'atomic',
	'unmute': 'atomic',
	'userflair': 'atomic',
} satisfies Record<ProposedAction['type'], 'atomic' | 'composite'>

/** Discriminant string of a {@link ProposedAction}. */
export type ProposedActionType = ProposedAction['type']

/**
 * A short-lived claim a reviewer places on a proposal in the same atomic write that
 * begins an accept, immediately before its action is replayed. Two reviewers accepting
 * the same proposal would otherwise both replay the (irreversible) side effect before
 * either marked it accepted; persisting the claim makes the conditional wiki write the
 * compare-and-set that lets only one in. Cleared when the proposal resolves or the
 * claim is released; a claim older than {@link REPLAY_CLAIM_TTL_SECONDS} is ignored so
 * a crashed/abandoned accept frees the proposal for retry without manual repair.
 */
export interface ReplayClaim {
	/** Username of the reviewer who holds the claim. */
	by: string
	/** Epoch seconds when the claim was placed. */
	at: number
}

/** Diagnostic detail recorded when an accept attempt fails partway through replay. */
export interface NeedsAttentionDetail {
	/** Username of the moderator who attempted the accept. */
	attemptedBy: string
	/** Epoch seconds when the attempt happened. */
	attemptedAt: number
	/** Which replay step failed (e.g. `'removeThing'`, `'sendRemovalMessage'`). */
	failedStep: string
	/**
	 * Whether an irreversible side effect already landed before the failure (e.g.
	 * the item was removed but the message send failed). Tells a reviewer whether a
	 * naive retry is safe.
	 */
	irreversibleSideEffect: boolean
	/** Human-readable error text from the failed step. */
	error: string
}

/** A single captured proposal, keyed by its stable {@link Proposal.id}. */
export interface Proposal {
	/**
	 * Stable, collision-free id. Generated (not derived from item+time+mod, which
	 * collides on rapid double-clicks). `itemId`/`proposedBy`/`proposedAt` are
	 * query fields, not identity.
	 */
	id: string
	/** Fullname of the target (e.g. `t3_abc`, `t1_def`). */
	itemId: string
	/** Whether the target is a post or comment. */
	itemKind: ProposalItemKind
	/** The captured action to replay on accept. */
	action: ProposedAction
	/** Username of the moderator who proposed the action. */
	proposedBy: string
	/** Epoch seconds when the proposal was created. */
	proposedAt: number
	/** Why the proposal exists. */
	source: ProposalSource
	/** Optional free-text rationale from the proposer. */
	note?: string
	/** Squashed permalink to the target, for display/linking (see usernotes codec). */
	link?: string
	/** Current lifecycle status. */
	status: ProposalStatus
	/** Epoch seconds of the last mutation to this proposal (any field). */
	updatedAt: number
	/** Username of the resolver, or a system sentinel for `obsolete`. */
	resolvedBy?: string
	/** Epoch seconds when the proposal reached a terminal status. */
	resolvedAt?: number
	/** Rejecting reviewer's explanation (reject only). */
	feedback?: string
	/** Why the proposal auto-resolved (obsolete only). */
	obsoleteReason?: ObsoleteReason
	/** Failure diagnostics (needs_attention only). */
	needsAttention?: NeedsAttentionDetail
	/**
	 * The in-flight accept claim, set in the same atomic write that begins a replay and
	 * cleared when the proposal resolves or the claim is released. Gates concurrent
	 * accepts of the same proposal (see {@link ReplayClaim}).
	 */
	replayClaim?: ReplayClaim
	/**
	 * Whether the proposer has acknowledged the outcome. Gates pruning: a resolved
	 * proposal is kept until acked or until `proposalRetentionDays` elapses.
	 */
	ackedByProposer?: boolean
}

/**
 * The full shape stored on the proposals wiki page.
 *
 * **Single-page** layout, confirmed by the Block 0 concurrency probe: Reddit's
 * `/api/wiki/edit` honors `previous` (stale writes get HTTP 409 `EDIT_CONFLICT`)
 * and read-after-write lag is small (~190 ms), so optimistic concurrency on one
 * page is safe. The bucketed fallback was not needed. See `CONCURRENCY_PROBE.md`.
 */
export interface ProposalsData {
	/** Schema version; used by future migrations. */
	ver: number
	/**
	 * Monotonically increasing page version, bumped by one on every committed write to
	 * this page (see `mutateProposals`). Distinct from {@link ProposalsData.ver} (the
	 * schema version, which only changes across builds) and from Reddit's opaque wiki
	 * revision id (which isn't orderable). Because it lives *in the data*, it travels
	 * with the page from any source - a read, a local commit, or a cross-tab broadcast
	 * - giving display caches a single lag-proof order so they never roll backward.
	 * Optional/absent on legacy pages and ad-hoc literals, where it is treated as `0`.
	 *
	 * Note: a hand-edit or admin revision-restore on the wiki that *lowers* `seq` can
	 * leave an open tab showing newer-cached data until it reloads - outside the normal
	 * mutation flow (every code-path write bumps from the current value) and self-healing
	 * on reload.
	 */
	seq?: number
	/** All proposals, keyed by {@link Proposal.id}. */
	proposals: Record<string, Proposal>
}

/** Default empty proposals data used when a subreddit has no existing page. */
export const defaultProposalsData: ProposalsData = {
	ver: proposalsSchema,
	seq: 0,
	proposals: {},
}

/**
 * How long a replay claim stays valid before the proposal may be reclaimed (seconds).
 *
 * A normal accept clears its claim explicitly on *every* outcome - success transitions to
 * `accepted`, failure to `needs_attention`, abandonment via an explicit release - so this
 * window only governs the hard-crash case (the holding tab is killed between claiming and
 * resolving). The risk to weigh: if the claim expired *mid-replay*, a second accept could
 * reclaim and replay the side effect again - exactly the double-action this guards. So the
 * window is set well above any plausible worst-case replay rather than tuned tight: a
 * removal-reason composite chains remove -> message (PM/modmail) -> optional log post ->
 * optional ban -> optional usernote (its own wiki read+write), each a network round-trip
 * with retries, on a slow connection. Five minutes clears that with wide margin; the only
 * cost of erring long is that a genuinely-crashed accept blocks retry until it lapses,
 * which is strictly safer than ever acting twice.
 */
export const REPLAY_CLAIM_TTL_SECONDS = 300

/** The statuses from which a proposal can never transition again. */
export const TERMINAL_STATUSES: readonly ProposalStatus[] = ['accepted', 'rejected', 'obsolete',]

/**
 * Returns whether a status is terminal (immutable). `needs_attention` is NOT
 * terminal - it can still be retried into `accepted`, or moved to `rejected`/
 * `obsolete`.
 * @param status The status to test.
 */
export function isTerminalStatus (status: ProposalStatus,): boolean {
	return TERMINAL_STATUSES.includes(status,)
}

/**
 * Returns whether `claim` is still active (present and not yet expired) at `now`. An
 * expired claim is treated as absent so a crashed accept can be retried.
 * @param claim The claim to test (or undefined when none is held).
 * @param now Current epoch seconds.
 */
export function isReplayClaimActive (claim: ReplayClaim | undefined, now: number,): boolean {
	return claim !== undefined && now - claim.at < REPLAY_CLAIM_TTL_SECONDS
}

/**
 * Returns whether a proposal may move from `from` to `to`. Enforced by the
 * mutation layer so a stale write against an already-resolved proposal fails with
 * a typed result instead of silently overwriting a verdict.
 *
 * Allowed:
 * - `pending` -> any other status.
 * - `needs_attention` -> `accepted` (retry succeeded), `rejected`, or `obsolete`.
 * - Terminal statuses -> nothing.
 * @param from Current status.
 * @param to Proposed next status.
 */
export function canTransition (from: ProposalStatus, to: ProposalStatus,): boolean {
	if (from === to) { return false }
	if (isTerminalStatus(from,)) { return false }
	if (from === 'pending') { return true }
	// from === 'needs_attention'
	return to === 'accepted' || to === 'rejected' || to === 'obsolete'
}
