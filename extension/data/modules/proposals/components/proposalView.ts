/**
 * Pure view-model helpers for the proposals review drawer: human labels for an
 * action/status, a one-line excerpt of what a proposal would say, item-kind labels,
 * and the "is this proposal aging" predicate. Kept framework-free (no React) so the
 * list row, the detail pane, and tests can all share them.
 */

import {assertNever,} from '../../../util/data/assertNever'
import type {
	Proposal,
	ProposalItemKind,
	ProposedAction,
	ProposedActionType,
} from '../../../util/wiki/schemas/proposals/schema'

/** A pending proposal older than this (seconds) is considered "aging" and flagged. */
export const AGING_THRESHOLD_SECONDS = 24 * 60 * 60

/** Human-readable summary of a proposed action (the detail title and list heading). */
export function describeAction (action: ProposedAction,): string {
	switch (action.type) {
		case 'approve':
			return 'Approve'
		case 'remove':
			return action.spam ? 'Remove as spam' : 'Remove'
		case 'removal-reason':
			return 'Remove with reason'
		case 'lock':
			return 'Lock'
		case 'unlock':
			return 'Unlock'
		case 'distinguish':
			return action.sticky ? 'Distinguish & sticky' : 'Distinguish'
		case 'marknsfw':
			return action.nsfw ? 'Mark NSFW' : 'Unmark NSFW'
		case 'sticky':
			return action.state ? (action.num ? `Sticky (slot ${action.num})` : 'Sticky') : 'Unsticky'
		case 'ban':
			return action.permanent ? 'Ban (permanent)' : `Ban (${action.days}d)`
		case 'unban':
			return 'Unban'
		case 'mute':
			return 'Mute'
		case 'unmute':
			return 'Unmute'
		case 'userflair':
			return 'Set user flair'
		default:
			// Exhaustiveness: a new ProposedAction variant must add a label above.
			return assertNever(action, 'proposed-action',)
	}
}

/**
 * A short label for an action *type* alone (no captured fields), for filter dropdowns
 * where only the discriminant is known. Unlike {@link describeAction}, never references
 * fields like `days`/`spam`, so it is safe to call with just a type.
 */
export function actionTypeLabel (type: ProposedActionType,): string {
	switch (type) {
		case 'approve':
			return 'Approve'
		case 'remove':
			return 'Remove'
		case 'removal-reason':
			return 'Remove with reason'
		case 'lock':
			return 'Lock'
		case 'unlock':
			return 'Unlock'
		case 'distinguish':
			return 'Distinguish'
		case 'marknsfw':
			return 'Mark NSFW'
		case 'sticky':
			return 'Sticky'
		case 'ban':
			return 'Ban'
		case 'unban':
			return 'Unban'
		case 'mute':
			return 'Mute'
		case 'unmute':
			return 'Unmute'
		case 'userflair':
			return 'User flair'
		default:
			return assertNever(type, 'action-type',)
	}
}

/** A short, human label for a proposal's status. */
export function describeStatus (proposal: Proposal,): string {
	switch (proposal.status) {
		case 'pending':
			return 'Pending review'
		case 'accepted':
			return `Accepted${proposal.resolvedBy ? ` by u/${proposal.resolvedBy}` : ''}`
		case 'rejected':
			return `Rejected${proposal.resolvedBy ? ` by u/${proposal.resolvedBy}` : ''}`
		case 'obsolete':
			return proposal.obsoleteReason === 'deleted' ? 'Item was deleted' : 'Already actioned'
		case 'needs_attention':
			return 'Accept failed - needs attention'
	}
}

/** A short label for what a proposal targets, for the list-row chip. */
export function itemKindLabel (kind: ProposalItemKind,): string {
	switch (kind) {
		case 'post':
			return 'Post'
		case 'comment':
			return 'Comment'
		case 'user':
			return 'User'
		default:
			return assertNever(kind, 'item-kind',)
	}
}

/**
 * Strips the most common Markdown markup from a single line so a reason preview reads
 * as plain text in the list row. Intentionally lightweight - it is a one-line excerpt,
 * not a full render (the detail pane renders the real markdown).
 * @param line One line of markdown text.
 */
function stripMarkdown (line: string,): string {
	return line
		// images/links: keep the visible label, drop the target.
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1',)
		// leading block markers: headings, blockquotes, list bullets.
		.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/, '',)
		// inline emphasis/code markers.
		.replace(/[*_`~]/g, '',)
		.trim()
}

/**
 * A one-line excerpt of what a proposal is about, for the sidebar row: the first
 * non-empty line of a removal reason's composed text (markdown stripped), else the
 * proposer's free-text note, else an empty string.
 * @param proposal The proposal to summarize.
 */
export function proposalExcerpt (proposal: Proposal,): string {
	if (proposal.action.type === 'removal-reason') {
		for (const raw of proposal.action.intent.reasonText.split('\n',)) {
			const line = stripMarkdown(raw,)
			if (line) { return line }
		}
	}
	return proposal.note?.trim() ?? ''
}

/**
 * Whether a proposal is still open and has been waiting long enough to flag for
 * triage. Used to surface stale items in the queue.
 * @param proposal The proposal to test.
 * @param nowSeconds Current time in epoch seconds (injected for testability).
 */
export function isAging (proposal: Proposal, nowSeconds: number = Date.now() / 1000,): boolean {
	return proposal.status === 'pending' && nowSeconds - proposal.proposedAt > AGING_THRESHOLD_SECONDS
}
