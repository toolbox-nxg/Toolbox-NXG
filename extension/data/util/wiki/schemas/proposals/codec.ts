/**
 * Encode/decode and validation for the proposals wiki page.
 *
 * v1 stores the {@link ProposalsData} object as plain JSON - a review queue is
 * low-volume, so the usernotes-style zlib+base64 compression is not needed yet
 * (it can be layered in later behind the same encode/decode seam if a page ever
 * approaches the wiki size limit). The single job here is to turn an untrusted
 * parsed blob from the wiki into a well-formed {@link ProposalsData}, dropping
 * anything malformed rather than throwing.
 */

import type {WikiPageCodec,} from '../../../../api/resources/wikiVersioned'
import {assertNever,} from '../../../data/assertNever'
import {unescapeJSON,} from '../../../data/encoding'
import {
	defaultProposalsData,
	type FrozenRemovalIntent,
	type ObsoleteReason,
	type Proposal,
	type ProposalItemKind,
	type ProposalsData,
	type ProposalSource,
	proposalsSchema,
	type ProposalStatus,
	PROPOSED_ACTION_KINDS,
	type ProposedActionType,
} from './schema'

/** The status strings a stored proposal is allowed to have. */
const VALID_STATUSES: readonly ProposalStatus[] = [
	'pending',
	'accepted',
	'rejected',
	'obsolete',
	'needs_attention',
]
/** The source strings a stored proposal is allowed to have. */
const VALID_SOURCES: readonly ProposalSource[] = ['training', 'second-opinion',]
/** The item-kind strings a stored proposal is allowed to have. */
const VALID_KINDS: readonly ProposalItemKind[] = ['post', 'comment', 'user',]
/** The obsolete-reason strings a stored proposal is allowed to have. */
const VALID_OBSOLETE_REASONS: readonly ObsoleteReason[] = ['deleted', 'already-actioned',]

/** Narrows an unknown value to a non-null object. */
function isObject (value: unknown,): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

/**
 * Validates the `action` field of a raw proposal. Returns the action when it is a
 * recognized {@link ProposedAction} shape, or `null` to reject the proposal.
 *
 * The untrusted `raw.type` is first checked against {@link PROPOSED_ACTION_KINDS} so
 * it narrows soundly to a {@link ProposedActionType}; the switch is then exhaustive
 * (the `assertNever` default is a compile error if the union gains a variant this
 * function forgets to validate).
 */
function normalizeAction (raw: unknown,): Proposal['action'] | null {
	if (!isObject(raw,)) { return null }
	if (typeof raw.type !== 'string' || !(raw.type in PROPOSED_ACTION_KINDS)) { return null }
	const type = raw.type as ProposedActionType
	switch (type) {
		case 'approve':
			return {type: 'approve',}
		case 'remove':
			return {type: 'remove', spam: raw.spam === true,}
		case 'removal-reason':
			// The frozen intent is trusted as-stored: it was rendered at capture time.
			// We only confirm it is an object so replay has something to consume.
			return isObject(raw.intent,)
				? {type: 'removal-reason', intent: {...raw.intent,} as unknown as FrozenRemovalIntent,}
				: null
		case 'lock':
			return {type: 'lock',}
		case 'unlock':
			return {type: 'unlock',}
		case 'distinguish':
			return {type: 'distinguish', sticky: raw.sticky === true,}
		case 'marknsfw':
			return {type: 'marknsfw', nsfw: raw.nsfw === true,}
		case 'sticky':
			return {
				type: 'sticky',
				state: raw.state === true,
				...(typeof raw.num === 'number' ? {num: raw.num,} : {}),
			}
		case 'ban':
			return {
				type: 'ban',
				permanent: raw.permanent === true,
				days: typeof raw.days === 'number' ? raw.days : 0,
				note: typeof raw.note === 'string' ? raw.note : '',
				message: typeof raw.message === 'string' ? raw.message : '',
				...(typeof raw.context === 'string' ? {context: raw.context,} : {}),
			}
		case 'unban':
			return {type: 'unban',}
		case 'mute':
			return {
				type: 'mute',
				...(typeof raw.duration === 'number' ? {duration: raw.duration,} : {}),
				...(typeof raw.note === 'string' ? {note: raw.note,} : {}),
			}
		case 'unmute':
			return {type: 'unmute',}
		case 'userflair':
			return {
				type: 'userflair',
				...(typeof raw.text === 'string' ? {text: raw.text,} : {}),
				...(typeof raw.cssClass === 'string' ? {cssClass: raw.cssClass,} : {}),
				...(typeof raw.templateID === 'string' ? {templateID: raw.templateID,} : {}),
			}
		default:
			return assertNever(type, 'proposed-action type',)
	}
}

/**
 * Validates a single raw proposal entry. Returns a well-formed {@link Proposal}
 * or `null` if required fields are missing/invalid (the caller drops nulls).
 * @param raw The untrusted parsed proposal.
 */
function normalizeProposal (raw: unknown,): Proposal | null {
	if (!isObject(raw,)) { return null }
	const {
		id,
		itemId,
		itemKind,
		proposedBy,
		proposedAt,
		source,
		status,
	} = raw

	if (typeof id !== 'string' || !id) { return null }
	if (typeof itemId !== 'string' || !itemId) { return null }
	if (typeof proposedBy !== 'string' || !proposedBy) { return null }
	if (typeof proposedAt !== 'number') { return null }
	if (!VALID_KINDS.includes(itemKind as ProposalItemKind,)) { return null }
	if (!VALID_SOURCES.includes(source as ProposalSource,)) { return null }
	if (!VALID_STATUSES.includes(status as ProposalStatus,)) { return null }

	const action = normalizeAction(raw.action,)
	if (!action) { return null }

	const proposal: Proposal = {
		id,
		itemId,
		itemKind: itemKind as ProposalItemKind,
		action,
		proposedBy,
		proposedAt,
		source: source as ProposalSource,
		status: status as ProposalStatus,
		// updatedAt is required; default to proposedAt for legacy/partial entries.
		updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : proposedAt,
	}

	if (typeof raw.note === 'string') { proposal.note = raw.note }
	if (typeof raw.link === 'string') { proposal.link = raw.link }
	if (typeof raw.resolvedBy === 'string') { proposal.resolvedBy = raw.resolvedBy }
	if (typeof raw.resolvedAt === 'number') { proposal.resolvedAt = raw.resolvedAt }
	if (typeof raw.feedback === 'string') { proposal.feedback = raw.feedback }
	if (VALID_OBSOLETE_REASONS.includes(raw.obsoleteReason as ObsoleteReason,)) {
		proposal.obsoleteReason = raw.obsoleteReason as ObsoleteReason
	}
	if (raw.ackedByProposer === true) { proposal.ackedByProposer = true }
	if (isObject(raw.replayClaim,)) {
		const rc = raw.replayClaim
		if (typeof rc.by === 'string' && rc.by && typeof rc.at === 'number') {
			proposal.replayClaim = {by: rc.by, at: rc.at,}
		}
	}
	if (isObject(raw.needsAttention,)) {
		const na = raw.needsAttention
		if (
			typeof na.attemptedBy === 'string'
			&& typeof na.attemptedAt === 'number'
			&& typeof na.failedStep === 'string'
			&& typeof na.error === 'string'
		) {
			proposal.needsAttention = {
				attemptedBy: na.attemptedBy,
				attemptedAt: na.attemptedAt,
				failedStep: na.failedStep,
				irreversibleSideEffect: na.irreversibleSideEffect === true,
				error: na.error,
			}
		}
	}

	return proposal
}

/**
 * Coerces an untrusted parsed wiki blob into a valid {@link ProposalsData}.
 * Unrecognized or malformed proposals are dropped. Never throws.
 * @param raw The parsed JSON read from the proposals wiki page (or anything).
 */
export function normalizeProposalsData (raw: unknown,): ProposalsData {
	if (!isObject(raw,) || !isObject(raw.proposals,)) {
		return {ver: proposalsSchema, seq: 0, proposals: {},}
	}
	const proposals: Record<string, Proposal> = {}
	for (const [key, value,] of Object.entries(raw.proposals,)) {
		const normalized = normalizeProposal(value,)
		// Trust the record key only when it matches the proposal's own id, so a
		// tampered/duplicated key can't shadow a real proposal.
		if (normalized && normalized.id === key) {
			proposals[key] = normalized
		}
	}
	return {
		ver: typeof raw.ver === 'number' ? raw.ver : proposalsSchema,
		// Monotonic page version; legacy pages without it start at 0.
		seq: typeof raw.seq === 'number' ? raw.seq : 0,
		proposals,
	}
}

/**
 * Serializes {@link ProposalsData} for storage. Currently an identity pass (plain
 * JSON is stringified by the wiki write layer); exists as the encode seam paired
 * with {@link normalizeProposalsData} for a future compression upgrade.
 * @param data The proposals data to encode.
 */
export function encodeProposalsData (data: ProposalsData,): ProposalsData {
	return data
}

/** Returns a fresh empty {@link ProposalsData} (deep-cloned default). */
export function emptyProposalsData (): ProposalsData {
	return {ver: defaultProposalsData.ver, seq: 0, proposals: {},}
}

/**
 * Refusal message when the proposals page exists but isn't valid JSON. Surfaced as
 * `unparseable` so the mutate loop refuses to overwrite content it could not read.
 */
export const INVALID_PROPOSALS_JSON_REASON =
	'The proposals page contains invalid JSON. Fix it by hand before editing so existing proposals are not lost.'

/**
 * The {@link WikiPageCodec} for the proposals page, used by the versioned wiki
 * transport. `parse` REFUSES content it cannot read as JSON (`{ok: false}`), so a write
 * can never clobber a page whose real contents we did not understand. The display path
 * still degrades gracefully: it reads the codec's empty value and ignores `unparseable`,
 * so a corrupt page shows as empty rather than erroring. `normalizeProposalsData` keeps
 * field-level tolerance for valid-but-partial JSON (dropping malformed individual
 * proposals); a write against a *newer schema version* is refused separately by
 * `mutateProposals`'s `refuseWrite`. Content is HTML-entity-escaped on the wiki, so
 * `parse` must `unescapeJSON` before `JSON.parse` (matching `readFromWiki`).
 */
export const proposalsCodec: WikiPageCodec<ProposalsData> = {
	parse (raw,) {
		try {
			return {ok: true, data: normalizeProposalsData(JSON.parse(unescapeJSON(raw,),),),}
		} catch {
			return {ok: false, reason: INVALID_PROPOSALS_JSON_REASON,}
		}
	},
	serialize: (data,) => JSON.stringify(data,),
	empty: emptyProposalsData,
}
