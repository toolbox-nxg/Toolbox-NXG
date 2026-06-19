/**
 * Client-side filter + sort for the review queue. The selectors already flatten and
 * order proposals across subreddits; this narrows that list to what the reviewer wants
 * to see (by subreddit, action type, or source) and orders it by age. Kept pure so the
 * sidebar bar and tests share it.
 */

import type {ProposalSource, ProposedActionType,} from '../../../util/wiki/schemas/proposals/schema'
import type {ProposalAt,} from '../../shared/proposals/selectors'
import {sameSub,} from '../../shared/proposals/subreddits'
import {actionTypeLabel,} from './proposalView'

/** Active filter/sort selection; empty string means "no filter on this field". */
export interface ProposalFilters {
	/** Restrict to one subreddit (case-insensitive), or '' for all. */
	subreddit: string
	/** Restrict to one action type, or '' for all. */
	actionType: ProposedActionType | ''
	/** Restrict to one source (training/second-opinion), or '' for all. */
	source: ProposalSource | ''
	/** Age ordering. */
	sort: 'newest' | 'oldest'
}

/** The default (no filters, newest first). */
export const defaultFilters: ProposalFilters = {subreddit: '', actionType: '', source: '', sort: 'newest',}

/** The set of selectable options derived from a list of proposals (for the dropdowns). */
export interface FilterOptions {
	subreddits: string[]
	actionTypes: {value: ProposedActionType; label: string}[]
	sources: ProposalSource[]
}

/**
 * Derives the distinct subreddits, action types, and sources present in a list, so the
 * filter dropdowns only offer values that would actually match something.
 * @param items The (unfiltered) proposals for the current view.
 */
export function filterOptions (items: ProposalAt[],): FilterOptions {
	const subreddits = new Set<string>()
	const actionTypes = new Set<ProposedActionType>()
	const sources = new Set<ProposalSource>()
	for (const {subreddit, proposal,} of items) {
		subreddits.add(subreddit,)
		actionTypes.add(proposal.action.type,)
		sources.add(proposal.source,)
	}
	return {
		subreddits: [...subreddits,].sort((a, b,) => a.localeCompare(b,)),
		actionTypes: [...actionTypes,]
			.map((value,) => ({value, label: actionTypeLabel(value,),}))
			.sort((a, b,) => a.label.localeCompare(b.label,)),
		sources: [...sources,].sort(),
	}
}

/**
 * Applies the active filters and sort to a list of proposals. Does not mutate the input.
 * @param items The proposals to narrow.
 * @param f The active filter/sort selection.
 */
export function filterSortProposals (items: ProposalAt[], f: ProposalFilters,): ProposalAt[] {
	const filtered = items.filter(({subreddit, proposal,},) => {
		if (f.subreddit && !sameSub(subreddit, f.subreddit,)) { return false }
		if (f.actionType && proposal.action.type !== f.actionType) { return false }
		if (f.source && proposal.source !== f.source) { return false }
		return true
	},)
	return filtered.sort((a, b,) =>
		f.sort === 'newest'
			? b.proposal.proposedAt - a.proposal.proposedAt
			: a.proposal.proposedAt - b.proposal.proposedAt
	)
}
