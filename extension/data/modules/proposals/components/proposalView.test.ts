/** Tests for the proposals review view-model helpers. */

// @vitest-environment node
import {describe, expect, it,} from 'vitest'

import type {FrozenRemovalIntent, Proposal,} from '../../../util/wiki/schemas/proposals/schema'
import {
	AGING_THRESHOLD_SECONDS,
	describeAction,
	describeStatus,
	isAging,
	itemKindLabel,
	proposalExcerpt,
} from './proposalView'

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

/** A minimal frozen removal intent with the given composed reason text. */
function intent (reasonText: string,): FrozenRemovalIntent {
	return {reasonText, reasonType: 'reply', subject: '',}
}

describe('describeAction', () => {
	it('labels removals and bans by their discriminating fields', () => {
		expect(describeAction({type: 'remove', spam: false,},),).toBe('Remove',)
		expect(describeAction({type: 'remove', spam: true,},),).toBe('Remove as spam',)
		expect(describeAction({type: 'removal-reason', intent: intent('x',),},),).toBe('Remove with reason',)
		expect(describeAction({type: 'ban', permanent: true, days: 0, note: '', message: '',},),).toBe(
			'Ban (permanent)',
		)
		expect(describeAction({type: 'ban', permanent: false, days: 7, note: '', message: '',},),).toBe('Ban (7d)',)
	})

	it('labels the curation + user-flair actions by their fields', () => {
		expect(describeAction({type: 'marknsfw', nsfw: true,},),).toBe('Mark NSFW',)
		expect(describeAction({type: 'marknsfw', nsfw: false,},),).toBe('Unmark NSFW',)
		expect(describeAction({type: 'sticky', state: true, num: 2,},),).toBe('Sticky (slot 2)',)
		expect(describeAction({type: 'sticky', state: false,},),).toBe('Unsticky',)
		expect(describeAction({type: 'userflair', text: 'VIP',},),).toBe('Set user flair',)
	})
})

describe('describeStatus', () => {
	it('distinguishes the two obsolete reasons', () => {
		expect(describeStatus(p({id: 'a', status: 'obsolete', obsoleteReason: 'deleted',},),),).toBe(
			'Item was deleted',
		)
		expect(describeStatus(p({id: 'b', status: 'obsolete', obsoleteReason: 'already-actioned',},),),)
			.toBe('Already actioned',)
	})

	it('attributes a resolver when present', () => {
		expect(describeStatus(p({id: 'c', status: 'accepted', resolvedBy: 'mod',},),),).toBe('Accepted by u/mod',)
	})
})

describe('itemKindLabel', () => {
	it('maps each kind to a chip label', () => {
		expect(itemKindLabel('post',),).toBe('Post',)
		expect(itemKindLabel('comment',),).toBe('Comment',)
		expect(itemKindLabel('user',),).toBe('User',)
	})
})

describe('proposalExcerpt', () => {
	it('uses the first non-empty markdown-stripped line of a removal reason', () => {
		const proposal = p({
			id: 'r',
			action: {type: 'removal-reason', intent: intent('## Rule 1\n\nThis is **not** allowed.',),},
		},)
		expect(proposalExcerpt(proposal,),).toBe('Rule 1',)
	})

	it('falls back to the proposer note when there is no reason text', () => {
		expect(proposalExcerpt(p({id: 'n', note: '  please review  ',},),),).toBe('please review',)
	})

	it('is empty when there is neither reason nor note', () => {
		expect(proposalExcerpt(p({id: 'e',},),),).toBe('',)
	})
})

describe('isAging', () => {
	const now = 1_000_000

	it('flags a pending proposal older than the threshold', () => {
		expect(isAging(p({id: 'old', proposedAt: now - AGING_THRESHOLD_SECONDS - 1,},), now,),).toBe(true,)
	})

	it('does not flag a recent pending proposal', () => {
		expect(isAging(p({id: 'new', proposedAt: now - 10,},), now,),).toBe(false,)
	})

	it('never flags a resolved proposal, however old', () => {
		expect(isAging(p({id: 'done', status: 'accepted', proposedAt: 0,},), now,),).toBe(false,)
	})
})
