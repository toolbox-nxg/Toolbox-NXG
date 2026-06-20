/**
 * Headless removal composition + submission for the one-click "apply suggested removal"
 * action (and any other non-overlay caller). Mirrors the overlay's `composeParams` plus
 * its non-accept perform path: it builds the same {@link SubmitRemovalParams} from a fixed
 * reason selection (no interactive fill-in fields, no usernote/ban) and routes the result
 * through the proposals gateway, so training-mode and second-opinion capture still apply.
 */

import {replaceTokens,} from '../../../util/data/string'
import {runInReplay,} from '../../../util/infra/captureGuard'
import type {FrozenRemovalSelection,} from '../../../util/wiki/schemas/proposals/schema'
import {decodeHtmlAngleBrackets, htmlFieldsToTokens,} from '../../../util/wiki/schemas/shared/tokens'
import {maybePropose, type ProposalContext,} from '../../shared/proposals/gateway'
import {
	composeReasonText,
	type ReasonType,
	type RenderedReason,
	settingToReasonType,
} from '../components/RemovalReasonsOverlay.helpers'
import {freezeRemovalParams,} from '../proposalAdapter'
import type {RemovalReason, RemovalReasonsData, RemovalReasonsOverlaySettings,} from '../schema'
import {submitRemoval, type SubmitRemovalParams, type SubmitRemovalResult,} from './submitRemoval'

/** Resolved delivery flags for a headless removal, matching the overlay's initial state. */
interface ResolvedDelivery {
	reasonType: ReasonType
	reasonSticky: boolean
	reasonAsSub: boolean
	reasonAutoArchive: boolean
	reasonCommentAsSubreddit: boolean
	actionLockThread: boolean
	actionLockComment: boolean
}

/**
 * Resolves delivery flags exactly as the overlay's initial state does: a subreddit that
 * leaves options up to mods uses the moderator's personal defaults, otherwise the
 * subreddit-configured `type*` values win.
 */
function resolveDelivery (data: RemovalReasonsData, settings: RemovalReasonsOverlaySettings,): ResolvedDelivery {
	const leaveUpToMods = data.removalOption === undefined || data.removalOption === 'leave'
	return {
		reasonType: leaveUpToMods
			? settingToReasonType(settings.reasonTypeSetting,)
			: ((data.typeReply as ReasonType) || 'reply'),
		reasonSticky: leaveUpToMods ? settings.reasonStickySetting : !!data.typeStickied,
		reasonAsSub: leaveUpToMods ? settings.reasonAsSubSetting : !!data.typeAsSub,
		reasonAutoArchive: leaveUpToMods ? settings.reasonAutoArchiveSetting : !!data.autoArchive,
		reasonCommentAsSubreddit: leaveUpToMods
			? settings.reasonCommentAsSubredditSetting
			: !!data.typeCommentAsSubreddit,
		actionLockThread: leaveUpToMods ? settings.actionLockSetting : !!data.typeLockThread,
		actionLockComment: leaveUpToMods ? settings.actionLockCommentSetting : !!data.typeLockComment,
	}
}

/** Builds the token substitution source from the thing's overlay data. */
function buildTokenSource (data: RemovalReasonsData,): Record<string, string> {
	return {
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
	}
}

/**
 * Composes the removal params and captured selection for a fixed set of reasons, with no
 * interactive fill-in values and no usernote/ban. Returns `null` when none of the requested
 * reasons are present in `data.reasons`.
 * @param data The thing + subreddit removal config.
 * @param reasons The reasons to apply, already selected (in display order).
 * @param settings The moderator's personal delivery defaults.
 */
export function composeHeadlessRemoval (
	data: RemovalReasonsData,
	reasons: RemovalReason[],
	settings: RemovalReasonsOverlaySettings,
): {params: SubmitRemovalParams; selection: FrozenRemovalSelection} | null {
	if (!reasons.length) { return null }
	const tokenSource = buildTokenSource(data,)

	// Build the same rendered-reason shape the overlay composes from; the one-click path has
	// no interactive inputs, so every `{input}`/`{select}` token resolves to its default.
	const rendered: RenderedReason[] = reasons.map((reason, index,) => {
		const {text: markdown, selects: extracted,} = htmlFieldsToTokens(
			decodeHtmlAngleBrackets(`${reason.text}\n\n`,),
			reason.selects ?? [],
		)
		return {id: `reason-${index}`, reason, markdown, selects: [...reason.selects ?? [], ...extracted,], html: '',}
	},)

	const composed = composeReasonText(rendered, () => undefined, () => [],)
	let reasonText = composed.reason
	if (data.header) { reasonText = `${data.header}\n\n${reasonText}` }
	if (data.footer) { reasonText += `\n\n${data.footer}` }
	reasonText = replaceTokens(tokenSource, reasonText,).trim()

	const reasonTitle = reasons.map((reason,) => reason.title).filter(Boolean,).join(', ',)
	const delivery = resolveDelivery(data, settings,)

	const selection: FrozenRemovalSelection = {reasons: composed.pieces,}
	if (data.header) { selection.includeHeader = true }
	if (data.footer) { selection.includeFooter = true }

	const params: SubmitRemovalParams = {
		data,
		reasonText,
		...(reasonTitle ? {reasonTitle,} : {}),
		flairText: composed.flairText.trim(),
		flairCSS: composed.flairCSS.trim(),
		flairTemplateID: composed.flairTemplateID,
		subject: replaceTokens(tokenSource, data.subject,),
		baseLogTitle: replaceTokens(tokenSource, data.logTitle,),
		logReasonText: data.logReason || '',
		...delivery,
		leaveUsernote: false,
		usernoteText: '',
		usernoteType: undefined,
		usernoteIncludeLink: false,
		usernoteIncludeMessage: false,
		subredditColors: null,
		issueBan: false,
		banPermanent: false,
		banDays: 0,
		banNote: '',
	}
	return {params, selection,}
}

/** Outcome of {@link submitOrProposeRemoval}: captured for review, or performed for real. */
export type HeadlessRemovalOutcome =
	| {status: 'captured'}
	| {status: 'performed'; result: SubmitRemovalResult}

/**
 * Routes a composed removal through the proposals gateway: captured as a proposal when the
 * acting mod is a guarded trainee here (or review is forced/armed), otherwise performed for
 * real inside an authorized replay window. Mirrors the overlay's non-accept perform path.
 * @param params The composed removal params.
 * @param selection The captured reason selection (recorded on a proposal for Edit & Accept).
 * @param ctx Where/what the removal targets and whether review is forced.
 */
export async function submitOrProposeRemoval (
	params: SubmitRemovalParams,
	selection: FrozenRemovalSelection,
	ctx: ProposalContext,
): Promise<HeadlessRemovalOutcome> {
	const captured = await maybePropose(
		{type: 'removal-reason', intent: freezeRemovalParams(params, selection,),},
		ctx,
	)
	if (captured) { return {status: 'captured',} }
	const result = await runInReplay(() => submitRemoval(params, () => {},))
	return {status: 'performed', result,}
}
