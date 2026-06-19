/** Tests for proposals wiki-page validation/normalization. */

// @vitest-environment node
import {describe, expect, it,} from 'vitest'

import {INVALID_PROPOSALS_JSON_REASON, normalizeProposalsData, proposalsCodec,} from './codec'
import type {Proposal,} from './schema'
import {proposalsSchema,} from './schema'

/** Builds a minimal valid pending proposal for tests. */
function makeProposal (overrides: Partial<Proposal> = {},): Proposal {
	return {
		id: 'p1',
		itemId: 't3_abc',
		itemKind: 'post',
		action: {type: 'remove', spam: false,},
		proposedBy: 'trainee',
		proposedAt: 1000,
		source: 'training',
		status: 'pending',
		updatedAt: 1000,
		...overrides,
	}
}

describe('normalizeProposalsData', () => {
	it('returns empty data for non-object / missing proposals', () => {
		expect(normalizeProposalsData(null,),).toEqual({ver: proposalsSchema, seq: 0, proposals: {},},)
		expect(normalizeProposalsData('nope',),).toEqual({ver: proposalsSchema, seq: 0, proposals: {},},)
		expect(normalizeProposalsData({ver: 1,},),).toEqual({ver: 1, seq: 0, proposals: {},},)
	})

	it('defaults seq to 0 on a legacy page and preserves a present seq', () => {
		// Pages written before the monotonic page version have no seq; treat as 0.
		expect(normalizeProposalsData({ver: 1, proposals: {},},).seq,).toBe(0,)
		// A present numeric seq round-trips unchanged.
		expect(normalizeProposalsData({ver: 1, seq: 42, proposals: {},},).seq,).toBe(42,)
		// A non-numeric seq is rejected back to 0.
		expect(normalizeProposalsData({ver: 1, seq: 'x', proposals: {},},).seq,).toBe(0,)
	})

	it('keeps a well-formed proposal and preserves ver', () => {
		const p = makeProposal()
		const result = normalizeProposalsData({ver: 1, proposals: {p1: p,},},)
		expect(result.ver,).toBe(1,)
		expect(result.proposals.p1,).toEqual(p,)
	})

	it('drops proposals whose record key does not match their id', () => {
		const p = makeProposal({id: 'real',},)
		const result = normalizeProposalsData({proposals: {wrongKey: p,},},)
		expect(result.proposals,).toEqual({},)
	})

	it('drops proposals missing required fields', () => {
		const result = normalizeProposalsData({
			proposals: {
				bad1: {id: 'bad1', itemId: 't3_x', itemKind: 'post',}, // missing proposedBy etc.
				bad2: makeProposal({id: 'bad2', status: 'weird' as never,},),
				bad3: makeProposal({id: 'bad3', itemKind: 'banana' as never,},),
				good: makeProposal({id: 'good',},),
			},
		},)
		expect(Object.keys(result.proposals,),).toEqual(['good',],)
	})

	it('accepts the known action variants and rejects unknown ones', () => {
		const result = normalizeProposalsData({
			proposals: {
				a: makeProposal({id: 'a', action: {type: 'approve',},},),
				r: makeProposal({id: 'r', action: {type: 'remove', spam: true,},},),
				rr: makeProposal({id: 'rr', action: {type: 'removal-reason', intent: {spam: true,},},},),
				lk: makeProposal({id: 'lk', action: {type: 'lock',},},),
				bn: makeProposal({id: 'bn', itemKind: 'user', action: {type: 'ban', days: 3,} as never,},),
				unknown: makeProposal({id: 'unknown', action: {type: 'frobnicate',} as never,},),
				noIntent: makeProposal({id: 'noIntent', action: {type: 'removal-reason',} as never,},),
			},
		},)
		expect(Object.keys(result.proposals,).sort(),).toEqual(['a', 'bn', 'lk', 'r', 'rr',],)
		expect(result.proposals.r!.action,).toEqual({type: 'remove', spam: true,},)
		// ban fills its defaults.
		expect(result.proposals.bn!.action,).toEqual({type: 'ban', permanent: false, days: 3, note: '', message: '',},)
	})

	it('coerces a missing spam flag to false on remove', () => {
		const result = normalizeProposalsData({
			proposals: {x: makeProposal({id: 'x', action: {type: 'remove',} as never,},),},
		},)
		expect(result.proposals.x!.action,).toEqual({type: 'remove', spam: false,},)
	})

	it('preserves resolution + needs_attention detail', () => {
		const p = makeProposal({
			id: 'done',
			status: 'needs_attention',
			resolvedBy: 'snr',
			resolvedAt: 2000,
			feedback: 'try again',
			ackedByProposer: true,
			needsAttention: {
				attemptedBy: 'snr',
				attemptedAt: 1999,
				failedStep: 'removeThing',
				irreversibleSideEffect: false,
				error: 'boom',
			},
		},)
		const result = normalizeProposalsData({proposals: {done: p,},},)
		expect(result.proposals.done,).toEqual(p,)
	})

	it('defaults updatedAt to proposedAt when absent', () => {
		const p = makeProposal({id: 'noupd',},)
		delete (p as Partial<Proposal>).updatedAt
		const result = normalizeProposalsData({proposals: {noupd: p,},},)
		expect(result.proposals.noupd!.updatedAt,).toBe(p.proposedAt,)
	})

	it('normalizes the new atomic action types (marknsfw, sticky, userflair)', () => {
		const nsfw = makeProposal({id: 'nsfw', action: {type: 'marknsfw', nsfw: true,},},)
		const sticky = makeProposal({id: 'sticky', action: {type: 'sticky', state: true, num: 2,},},)
		const flair = makeProposal({
			id: 'flair',
			itemKind: 'user',
			action: {type: 'userflair', text: 'VIP', cssClass: 'v', templateID: 't',},
		},)
		const result = normalizeProposalsData({proposals: {nsfw, sticky, flair,},},)
		expect(result.proposals.nsfw!.action,).toEqual({type: 'marknsfw', nsfw: true,},)
		expect(result.proposals.sticky!.action,).toEqual({type: 'sticky', state: true, num: 2,},)
		expect(result.proposals.flair!.action,).toEqual({
			type: 'userflair',
			text: 'VIP',
			cssClass: 'v',
			templateID: 't',
		},)
	})
})

describe('proposalsCodec.parse', () => {
	it('refuses content that is not valid JSON instead of coercing to empty', () => {
		// A corrupt page must surface as unparseable so the mutate loop refuses to
		// overwrite it, rather than silently coercing to empty and wiping real proposals.
		const result = proposalsCodec.parse('}{ not json',)
		expect(result.ok,).toBe(false,)
		if (!result.ok) {
			expect(result.reason,).toBe(INVALID_PROPOSALS_JSON_REASON,)
		}
	})

	it('parses valid proposals JSON', () => {
		const result = proposalsCodec.parse('{"ver":1,"seq":3,"proposals":{}}',)
		expect(result.ok,).toBe(true,)
		if (result.ok) {
			expect(result.data,).toEqual({ver: 1, seq: 3, proposals: {},},)
		}
	})
})
