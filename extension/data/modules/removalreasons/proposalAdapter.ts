/**
 * Capture/replay adapter for removal-reason proposals. Lives in the removalreasons
 * module (not the generic proposals substrate) so the substrate never imports a
 * feature module: the proposals gateway dispatches a `removal-reason` replay to the
 * handler registered here.
 *
 * The frozen intent is **hand-curated** (see {@link FrozenRemovalIntent}): capture
 * stores only the resolved values replay needs - empties/defaults dropped, optional
 * steps nested, subreddit usernote colors omitted (re-fetched on replay). `thaw`
 * reconstructs the full `SubmitRemovalParams`; its return type is the compile-time
 * guard that every param the pipeline reads is rebuilt. (We deliberately moved off
 * verbatim-params storage because it captured the whole reason list, body variants,
 * and colors on every proposal.)
 */

import {runInReplay,} from '../../util/infra/captureGuard'
import {getApiThingInfo,} from '../../util/reddit/thingInfo'
import type {FrozenRemovalIntent, FrozenRemovalSelection, Proposal,} from '../../util/wiki/schemas/proposals/schema'
import {getSubredditColors,} from '../shared/usernotes/moduleapi'
import {submitRemoval, type SubmitRemovalParams,} from './features/submitRemoval'

/**
 * Snapshots resolved removal params into the curated frozen intent, omitting empty/
 * default fields and nesting the optional flair/usernote/ban/log steps so a captured
 * proposal carries only what replay needs. The item's own metadata is NOT stored -
 * it is re-fetched at replay from the proposal's `itemId` (see {@link thawRemovalIntent}).
 * @param params The fully-composed params the overlay would pass to `submitRemoval`.
 * @param selection The trainee's structured reason selection, captured **in addition**
 *   to the composed `reasonText` purely to re-seed the overlay for Edit & Accept. Stored
 *   only when it has reasons; replay and display never read it.
 */
export function freezeRemovalParams (
	params: SubmitRemovalParams,
	selection?: FrozenRemovalSelection,
): FrozenRemovalIntent {
	const intent: FrozenRemovalIntent = {
		reasonText: params.reasonText,
		reasonType: params.reasonType,
		subject: params.subject,
	}

	// Structured selection for Edit & Accept (additive; never used by replay/display).
	if (selection && selection.reasons.length > 0) { intent.selection = selection }

	// Reason title(s): review-only metadata, kept when present.
	if (params.reasonTitle) { intent.reasonTitle = params.reasonTitle }

	// Log post: only meaningful when a log subreddit is configured. logSub is removal
	// config (not item metadata), so it is stored on the intent rather than re-fetched.
	if (params.data.logSub) {
		intent.logSub = params.data.logSub
		if (params.baseLogTitle) { intent.baseLogTitle = params.baseLogTitle }
		if (params.logReasonText) { intent.logReasonText = params.logReasonText }
	}

	// Flair: only when something is set.
	if (params.flairText || params.flairCSS || params.flairTemplateID) {
		intent.flair = {}
		if (params.flairText) { intent.flair.text = params.flairText }
		if (params.flairCSS) { intent.flair.cssClass = params.flairCSS }
		if (params.flairTemplateID) { intent.flair.templateId = params.flairTemplateID }
	}

	// Boolean delivery/lock flags: store only the `true` ones.
	if (params.reasonSticky) { intent.reasonSticky = true }
	if (params.reasonAsSub) { intent.reasonAsSub = true }
	if (params.reasonAutoArchive) { intent.reasonAutoArchive = true }
	if (params.reasonCommentAsSubreddit) { intent.reasonCommentAsSubreddit = true }
	if (params.actionLockThread) { intent.actionLockThread = true }
	if (params.actionLockComment) { intent.actionLockComment = true }
	if (params.spam) { intent.spam = true }

	// Usernote: only when leaving one with text.
	if (params.leaveUsernote && params.usernoteText.trim()) {
		intent.usernote = {text: params.usernoteText,}
		if (params.usernoteType !== undefined) { intent.usernote.type = params.usernoteType }
		if (params.usernoteIncludeLink) { intent.usernote.includeLink = true }
		if (params.usernoteIncludeMessage) { intent.usernote.includeMessage = true }
	}

	// Ban: only when banning.
	if (params.issueBan) {
		intent.ban = {permanent: !!params.banPermanent, days: params.banDays, note: params.banNote,}
	}

	return intent
}

/**
 * Reconstructs the full `SubmitRemovalParams` from a curated frozen intent. Re-fetches
 * the item's metadata (author, permalink, kind, ...) from `proposal.itemId` - the item
 * still exists until accepted - attributes the note to the original `proposedBy`, and
 * re-fetches the subreddit usernote colors. Fills defaults for omitted fields.
 * @param subreddit The subreddit the proposal belongs to.
 * @param proposal The proposal being replayed (source of itemId and proposer).
 * @param intent The curated frozen removal intent.
 */
async function thawRemovalIntent (
	subreddit: string,
	proposal: Proposal,
	intent: FrozenRemovalIntent,
): Promise<SubmitRemovalParams> {
	const info = await getApiThingInfo(subreddit, proposal.itemId, false,)
	return {
		data: {
			fullname: proposal.itemId,
			kind: info.kind,
			subreddit,
			author: info.user,
			url: info.permalink,
			link: info.postlink,
			// Attribute the note/action to the moderator who proposed it, not the reviewer.
			mod: proposal.proposedBy,
			logSub: intent.logSub ?? '',
		},
		reasonText: intent.reasonText,
		flairText: intent.flair?.text ?? '',
		flairCSS: intent.flair?.cssClass ?? '',
		flairTemplateID: intent.flair?.templateId ?? '',
		subject: intent.subject,
		baseLogTitle: intent.baseLogTitle ?? '',
		logReasonText: intent.logReasonText ?? '',
		reasonType: intent.reasonType,
		reasonSticky: !!intent.reasonSticky,
		reasonAsSub: !!intent.reasonAsSub,
		reasonAutoArchive: !!intent.reasonAutoArchive,
		reasonCommentAsSubreddit: !!intent.reasonCommentAsSubreddit,
		actionLockThread: !!intent.actionLockThread,
		actionLockComment: !!intent.actionLockComment,
		spam: !!intent.spam,
		leaveUsernote: !!intent.usernote,
		usernoteText: intent.usernote?.text ?? '',
		usernoteType: intent.usernote?.type,
		usernoteIncludeLink: !!intent.usernote?.includeLink,
		usernoteIncludeMessage: !!intent.usernote?.includeMessage,
		subredditColors: await getSubredditColors(subreddit,).catch(() => null),
		issueBan: !!intent.ban,
		banPermanent: !!intent.ban?.permanent,
		banDays: intent.ban?.days ?? 0,
		banNote: intent.ban?.note ?? '',
	}
}

/**
 * Replays a frozen removal-reason intent by reconstructing the params (re-fetching
 * item metadata) and running the real submission pipeline inside an authorized
 * replay context. Throws on a pipeline failure so the caller (the gateway) records
 * `needs_attention` rather than marking the proposal accepted.
 * @param subreddit The subreddit the proposal belongs to.
 * @param proposal The proposal being replayed.
 * @param intent The frozen removal intent captured at propose time.
 * @param overrides Reviewer edits applied at accept time (accept-with-edit); currently
 *   the composed reason text only. Omit to replay the captured intent verbatim.
 */
export async function replayRemovalProposal (
	subreddit: string,
	proposal: Proposal,
	intent: FrozenRemovalIntent,
	overrides?: {reasonText?: string},
): Promise<void> {
	const params = await thawRemovalIntent(subreddit, proposal, intent,)
	// Accept-with-edit: a reviewer may revise the message before it is sent.
	if (overrides?.reasonText !== undefined) { params.reasonText = overrides.reasonText }
	const result = await runInReplay(() =>
		// onWarning is UI-only feedback; on replay there is no overlay, so swallow
		// non-fatal warnings (flair/distinguish). Fatal failures reject below.
		submitRemoval(params, () => {},)
	)
	if (!result.ok) {
		throw new Error(result.error,)
	}
}
