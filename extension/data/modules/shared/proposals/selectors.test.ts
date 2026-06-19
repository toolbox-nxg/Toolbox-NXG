/** Tests for the proposals read-side selectors. */

// @vitest-environment node
import {describe, expect, it,} from 'vitest'

import type {Proposal, ProposalsData, ProposalStatus,} from '../../../util/wiki/schemas/proposals/schema'
import {
	myProposals,
	myProposalsAcross,
	myUnacknowledgedResolved,
	myUnacknowledgedResolvedAcross,
	openProposalCount,
	openProposalCountAcross,
	openProposals,
	openProposalsAcross,
	openProposalsForItem,
	type SubredditProposals,
} from './selectors'

/** Builds a proposal with sensible defaults. */
function p (overrides: Partial<Proposal> & {id: string},): Proposal {
	return {
		itemId: 't3_a',
		itemKind: 'post',
		action: {type: 'approve',},
		proposedBy: 'trainee',
		proposedAt: 100,
		updatedAt: 100,
		source: 'training',
		status: 'pending',
		...overrides,
	}
}

/** Wraps proposals into a ProposalsData. */
function data (...proposals: Proposal[]): ProposalsData {
	return {ver: 1, proposals: Object.fromEntries(proposals.map((x,) => [x.id, x,]),),}
}

const STATUSES: ProposalStatus[] = ['pending', 'accepted', 'rejected', 'obsolete', 'needs_attention',]

describe('openProposals / openProposalCount', () => {
	it('includes only pending and needs_attention, newest first', () => {
		const d = data(
			p({id: 'pending1', proposedAt: 1,},),
			p({id: 'pending2', proposedAt: 3,},),
			p({id: 'attention', status: 'needs_attention', proposedAt: 2,},),
			p({id: 'accepted', status: 'accepted',},),
			p({id: 'rejected', status: 'rejected',},),
			p({id: 'obsolete', status: 'obsolete',},),
		)
		expect(openProposals(d,).map((x,) => x.id),).toEqual(['pending2', 'attention', 'pending1',],)
		expect(openProposalCount(d,),).toBe(3,)
	})

	it('treats only pending+needs_attention as open across all statuses', () => {
		const d = data(...STATUSES.map((status, i,) => p({id: status, status, proposedAt: i,},)),)
		expect(openProposals(d,).map((x,) => x.id).sort(),).toEqual(['needs_attention', 'pending',],)
	})
})

describe('openProposalsForItem', () => {
	it('filters to open proposals for the given item', () => {
		const d = data(
			p({id: 'a1', itemId: 't3_a', proposedAt: 1,},),
			p({id: 'a2', itemId: 't3_a', proposedAt: 2,},),
			p({id: 'aDone', itemId: 't3_a', status: 'accepted',},),
			p({id: 'b1', itemId: 't3_b',},),
		)
		expect(openProposalsForItem(d, 't3_a',).map((x,) => x.id),).toEqual(['a2', 'a1',],)
	})
})

describe('myProposals / myUnacknowledgedResolved', () => {
	it('matches the author case-insensitively', () => {
		const d = data(
			p({id: 'mine', proposedBy: 'Trainee',},),
			p({id: 'theirs', proposedBy: 'someoneelse',},),
		)
		expect(myProposals(d, 'trainee',).map((x,) => x.id),).toEqual(['mine',],)
	})

	it('returns [] for an empty username', () => {
		const d = data(p({id: 'mine', proposedBy: 'trainee',},),)
		expect(myProposals(d, '',),).toEqual([],)
		expect(myUnacknowledgedResolved(d, '',),).toEqual([],)
	})

	it('counts only resolved-and-unacknowledged for the badge', () => {
		const d = data(
			p({id: 'pending', proposedBy: 'me', status: 'pending',},),
			p({id: 'resolvedUnacked', proposedBy: 'me', status: 'rejected',},),
			p({id: 'resolvedAcked', proposedBy: 'me', status: 'accepted', ackedByProposer: true,},),
			p({id: 'othersResolved', proposedBy: 'other', status: 'rejected',},),
		)
		expect(myUnacknowledgedResolved(d, 'me',).map((x,) => x.id),).toEqual(['resolvedUnacked',],)
	})
})

/** Wraps proposals into a per-subreddit entry for the cross-sub selectors. */
function sub (subreddit: string, ...proposals: Proposal[]): SubredditProposals {
	return {subreddit, data: data(...proposals,),}
}

describe('cross-subreddit selectors', () => {
	it('openProposalsAcross tags each proposal with its sub, newest first across subs', () => {
		const entries = [
			sub('aaa', p({id: 'a-old', proposedAt: 1,},), p({id: 'a-done', status: 'accepted', proposedAt: 9,},),),
			sub(
				'bbb',
				p({id: 'b-new', proposedAt: 5,},),
				p({id: 'b-att', status: 'needs_attention', proposedAt: 3,},),
			),
		]
		expect(openProposalsAcross(entries,).map((x,) => [x.subreddit, x.proposal.id,]),).toEqual([
			['bbb', 'b-new',],
			['bbb', 'b-att',],
			['aaa', 'a-old',],
		],)
		expect(openProposalCountAcross(entries,),).toBe(3,)
	})

	it('myProposalsAcross / myUnacknowledgedResolvedAcross filter by author across subs', () => {
		const entries = [
			sub('aaa', p({id: 'a-mine', proposedBy: 'Me', status: 'rejected', proposedAt: 2,},),),
			sub(
				'bbb',
				p({id: 'b-mine-open', proposedBy: 'me', status: 'pending', proposedAt: 4,},),
				p({id: 'b-mine-acked', proposedBy: 'me', status: 'accepted', ackedByProposer: true, proposedAt: 1,},),
				p({id: 'b-theirs', proposedBy: 'other', status: 'rejected', proposedAt: 3,},),
			),
		]
		expect(myProposalsAcross(entries, 'me',).map((x,) => x.proposal.id),).toEqual(
			['b-mine-open', 'a-mine', 'b-mine-acked',],
		)
		// Only resolved-and-unacknowledged, across subs.
		expect(myUnacknowledgedResolvedAcross(entries, 'me',).map((x,) => [x.subreddit, x.proposal.id,]),).toEqual(
			[['aaa', 'a-mine',],],
		)
	})

	it('returns empty for no entries or an empty username', () => {
		expect(openProposalsAcross([],),).toEqual([],)
		expect(openProposalCountAcross([],),).toBe(0,)
		expect(myProposalsAcross([sub('aaa', p({id: 'x',},),),], '',),).toEqual([],)
		expect(myUnacknowledgedResolvedAcross([sub('aaa', p({id: 'x', status: 'rejected',},),),], '',),).toEqual([],)
	})
})
