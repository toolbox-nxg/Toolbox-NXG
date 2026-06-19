/** Tests for the review-queue filter/sort helpers. */

// @vitest-environment node
import {describe, expect, it,} from 'vitest'

import type {Proposal,} from '../../../util/wiki/schemas/proposals/schema'
import type {ProposalAt,} from '../../shared/proposals/selectors'
import {defaultFilters, filterOptions, filterSortProposals,} from './proposalFilter'

/** Builds a ProposalAt with sensible defaults. */
function at (subreddit: string, overrides: Partial<Proposal> & {id: string},): ProposalAt {
	return {
		subreddit,
		proposal: {
			itemId: 't3_a',
			itemKind: 'post',
			action: {type: 'approve',},
			proposedBy: 'trainee',
			proposedAt: 100,
			updatedAt: 100,
			source: 'training',
			status: 'pending',
			...overrides,
		},
	}
}

const items: ProposalAt[] = [
	at('aaa', {id: '1', proposedAt: 10, action: {type: 'approve',}, source: 'training',},),
	at('bbb', {id: '2', proposedAt: 30, action: {type: 'remove', spam: false,}, source: 'second-opinion',},),
	at('aaa', {id: '3', proposedAt: 20, action: {type: 'approve',}, source: 'training',},),
]

describe('filterOptions', () => {
	it('lists the distinct subreddits, action types, and sources present', () => {
		const opts = filterOptions(items,)
		expect(opts.subreddits,).toEqual(['aaa', 'bbb',],)
		expect(opts.actionTypes.map((a,) => a.value).sort(),).toEqual(['approve', 'remove',],)
		expect(opts.sources,).toEqual(['second-opinion', 'training',],)
	})
})

describe('filterSortProposals', () => {
	it('sorts newest-first by default and oldest-first when asked', () => {
		const newest = filterSortProposals(items, defaultFilters,).map((x,) => x.proposal.id)
		expect(newest,).toEqual(['2', '3', '1',],)
		const oldest = filterSortProposals(items, {...defaultFilters, sort: 'oldest',},).map((x,) => x.proposal.id)
		expect(oldest,).toEqual(['1', '3', '2',],)
	})

	it('filters by subreddit (case-insensitive), action type, and source', () => {
		expect(filterSortProposals(items, {...defaultFilters, subreddit: 'AAA',},).map((x,) => x.proposal.id),)
			.toEqual(['3', '1',],)
		expect(filterSortProposals(items, {...defaultFilters, actionType: 'remove',},).map((x,) => x.proposal.id),)
			.toEqual(['2',],)
		expect(filterSortProposals(items, {...defaultFilters, source: 'second-opinion',},).map((x,) => x.proposal.id),)
			.toEqual(['2',],)
	})

	it('does not mutate the input list', () => {
		const before = items.map((x,) => x.proposal.id)
		filterSortProposals(items, {...defaultFilters, sort: 'oldest',},)
		expect(items.map((x,) => x.proposal.id),).toEqual(before,)
	})
})
