/**
 * Tests for the proposals storage operations and the conflict-safe mutation core.
 * The wiki transport is replaced with an in-memory fake that enforces the same
 * optimistic-concurrency contract as Reddit (a write with a stale `previous`
 * returns a conflict carrying the current state), so concurrency, conflict-retry,
 * and terminal-transition guards are exercised for real against `mutateProposals`.
 */

// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

// Pulled in transitively via the proposals event bus' cross-tab broadcast.
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage: vi.fn().mockResolvedValue(undefined,),},},}),)

const readProposalsPage = vi.hoisted(() => vi.fn())
const writeProposalsPage = vi.hoisted(() => vi.fn())
vi.mock('../../../api/resources/wikiVersioned', () => ({
	readWikiPageVersioned: readProposalsPage,
	writeWikiPageConditional: writeProposalsPage,
}),)

import {nowInSeconds,} from '../../../util/data/time'
import type {Proposal, ProposalsData,} from '../../../util/wiki/schemas/proposals/schema'
import {invalidateProposalsCache, onProposalsChanged,} from './events'
import {
	appendProposal,
	claimProposalForReplay,
	createProposalId,
	dismissProposal,
	loadProposals,
	loadProposalsForSubs,
	markProposalObsolete,
	pruneResolvedProposals,
	rejectProposal,
	releaseProposalClaim,
	transitionProposal,
} from './moduleapi'

const SUB = 'testsub'

/** Deep clone so the fake's stored state can't be mutated by reference. */
const clone = <T,>(v: T,): T => JSON.parse(JSON.stringify(v,),) as T

/**
 * Wires the transport mocks to an in-memory page with `previous`-based conflict
 * detection. Returns helpers to seed and inspect the stored state, plus a hook to
 * simulate a concurrent external write landing between a read and the next write.
 */
function fakeWiki () {
	let data: ProposalsData = {ver: 1, proposals: {},}
	let rev: string | undefined = undefined
	let revCounter = 0
	/** Runs once before the next write resolves, simulating a concurrent writer. */
	let beforeNextWrite: (() => void) | null = null

	readProposalsPage.mockImplementation(async () => ({data: clone(data,), rev,}))
	writeProposalsPage.mockImplementation(
		async (_sub: string, _page: string, next: ProposalsData, _reason: string, previous: string | undefined,) => {
			if (beforeNextWrite) {
				const fn = beforeNextWrite
				beforeNextWrite = null
				fn()
			}
			if (previous !== rev) {
				return {ok: false, conflict: true, data: clone(data,), rev: rev!,}
			}
			data = clone(next,)
			rev = `rev${++revCounter}`
			return {ok: true,}
		},
	)

	return {
		seed (proposals: Record<string, Proposal>,) {
			data = {ver: 1, proposals: clone(proposals,),}
			rev = `rev${++revCounter}`
		},
		get () {
			return data
		},
		/** Schedule a mutation to the stored page just before the next write commits. */
		injectConcurrentWrite (fn: (current: ProposalsData,) => void,) {
			beforeNextWrite = () => {
				fn(data,)
				rev = `rev${++revCounter}`
			}
		},
	}
}

/** Builds a pending proposal. */
function makeProposal (overrides: Partial<Proposal> = {},): Proposal {
	const id = overrides.id ?? createProposalId()
	return {
		itemId: 't3_abc',
		itemKind: 'post',
		action: {type: 'remove', spam: false,},
		proposedBy: 'trainee',
		proposedAt: nowInSeconds(),
		source: 'training',
		status: 'pending',
		updatedAt: nowInSeconds(),
		...overrides,
		id,
	}
}

let wiki: ReturnType<typeof fakeWiki>

beforeEach(() => {
	vi.clearAllMocks()
	invalidateProposalsCache()
	wiki = fakeWiki()
},)

afterEach(() => {
	invalidateProposalsCache()
},)

describe('appendProposal', () => {
	it('writes a new proposal and reports ok', async () => {
		const p = makeProposal({id: 'p1',},)
		const result = await appendProposal(SUB, p,)
		expect(result,).toEqual({ok: true, proposal: p,},)
		expect(wiki.get().proposals.p1,).toEqual(p,)
	})

	it('is idempotent on id (no second write)', async () => {
		const p = makeProposal({id: 'p1',},)
		await appendProposal(SUB, p,)
		const writesAfterFirst = writeProposalsPage.mock.calls.length
		const again = await appendProposal(SUB, {...p, note: 'changed',},)
		expect(again.ok,).toBe(true,)
		// No additional write for a duplicate id.
		expect(writeProposalsPage.mock.calls.length,).toBe(writesAfterFirst,)
		expect(wiki.get().proposals.p1!.note,).toBeUndefined()
	})

	it('serializes concurrent appends for the same sub (both land)', async () => {
		const [a, b,] = [makeProposal({id: 'a',},), makeProposal({id: 'b',},),]
		await Promise.all([appendProposal(SUB, a,), appendProposal(SUB, b,),],)
		expect(Object.keys(wiki.get().proposals,).sort(),).toEqual(['a', 'b',],)
	})

	it('retries against fresh state when a concurrent writer wins', async () => {
		// A different proposal is added externally between our read and our write;
		// the first write conflicts, we re-apply against fresh data, and both survive.
		wiki.injectConcurrentWrite((current,) => {
			current.proposals.other = makeProposal({id: 'other', proposedBy: 'someoneelse',},)
		},)
		const mine = makeProposal({id: 'mine',},)
		const result = await appendProposal(SUB, mine,)
		expect(result.ok,).toBe(true,)
		expect(Object.keys(wiki.get().proposals,).sort(),).toEqual(['mine', 'other',],)
	})

	it('emits a change event on a successful write', async () => {
		const seen: string[] = []
		const off = onProposalsChanged((sub,) => seen.push(sub,))
		await appendProposal(SUB, makeProposal({id: 'p1',},),)
		off()
		expect(seen,).toEqual([SUB,],)
	})
})

describe('transition guards', () => {
	it('rejects a pending proposal with feedback', async () => {
		wiki.seed({p1: makeProposal({id: 'p1',},),},)
		const result = await rejectProposal(SUB, 'p1', 'snr', 'not spam',)
		expect(result.ok,).toBe(true,)
		const stored = wiki.get().proposals.p1!
		expect(stored.status,).toBe('rejected',)
		expect(stored.resolvedBy,).toBe('snr',)
		expect(stored.feedback,).toBe('not spam',)
	})

	it('fails with already-resolved against a terminal proposal', async () => {
		wiki.seed({p1: makeProposal({id: 'p1', status: 'accepted', resolvedBy: 'a',},),},)
		const result = await rejectProposal(SUB, 'p1', 'b',)
		expect(result,).toEqual({ok: false, reason: 'already-resolved', current: wiki.get().proposals.p1,},)
		// Verdict untouched.
		expect(wiki.get().proposals.p1!.status,).toBe('accepted',)
	})

	it('returns not-found for an unknown id', async () => {
		const result = await transitionProposal(SUB, 'ghost', 'rejected', {}, 'x',)
		expect(result,).toEqual({ok: false, reason: 'not-found',},)
	})

	it('refreshes the needs_attention diagnostic on a repeated failure (same-status refresh)', async () => {
		wiki.seed({
			p1: makeProposal({
				id: 'p1',
				status: 'needs_attention',
				needsAttention: {
					attemptedBy: 'rev',
					attemptedAt: 1,
					failedStep: 'old failure',
					irreversibleSideEffect: false,
					error: 'old failure',
				},
			},),
		},)
		const result = await transitionProposal(SUB, 'p1', 'needs_attention', {
			needsAttention: {
				attemptedBy: 'rev',
				attemptedAt: 2,
				failedStep: 'new failure',
				irreversibleSideEffect: false,
				error: 'new failure',
			},
		}, 'retry failed',)
		expect(result.ok,).toBe(true,)
		const stored = wiki.get().proposals.p1!
		expect(stored.status,).toBe('needs_attention',)
		expect(stored.needsAttention?.failedStep,).toBe('new failure',)
		expect(stored.needsAttention?.error,).toBe('new failure',)
	})

	it('a stale reject loses to a concurrent accept (re-applied against fresh)', async () => {
		wiki.seed({p1: makeProposal({id: 'p1',},),},)
		// Between our read and write, someone accepts p1.
		wiki.injectConcurrentWrite((current,) => {
			current.proposals.p1 = {...current.proposals.p1!, status: 'accepted', resolvedBy: 'fast',}
		},)
		const result = await rejectProposal(SUB, 'p1', 'slow',)
		expect(result.ok,).toBe(false,)
		expect(result,).toMatchObject({reason: 'already-resolved',},)
		expect(wiki.get().proposals.p1!.status,).toBe('accepted',)
		expect(wiki.get().proposals.p1!.resolvedBy,).toBe('fast',)
	})
})

describe('markProposalObsolete', () => {
	it('moves a pending proposal to obsolete with a system resolver', async () => {
		wiki.seed({p1: makeProposal({id: 'p1',},),},)
		const result = await markProposalObsolete(SUB, 'p1', 'deleted',)
		expect(result.ok,).toBe(true,)
		const stored = wiki.get().proposals.p1!
		expect(stored.status,).toBe('obsolete',)
		expect(stored.obsoleteReason,).toBe('deleted',)
		expect(stored.resolvedBy,).toBe('[system]',)
	})
})

describe('dismissProposal', () => {
	it('acks a resolved proposal and is idempotent', async () => {
		wiki.seed({p1: makeProposal({id: 'p1', status: 'rejected', resolvedBy: 'snr',},),},)
		const first = await dismissProposal(SUB, 'p1',)
		expect(first.ok,).toBe(true,)
		expect(wiki.get().proposals.p1!.ackedByProposer,).toBe(true,)
		const writesAfterFirst = writeProposalsPage.mock.calls.length
		await dismissProposal(SUB, 'p1',)
		expect(writeProposalsPage.mock.calls.length,).toBe(writesAfterFirst,)
	})
})

describe('pruneResolvedProposals', () => {
	it('prunes acked and aged-out resolved proposals, keeps the rest', async () => {
		const now = 1_000_000
		const day = 24 * 60 * 60
		wiki.seed({
			pending: makeProposal({id: 'pending', status: 'pending',},),
			acked: makeProposal({id: 'acked', status: 'rejected', resolvedAt: now, ackedByProposer: true,},),
			old: makeProposal({id: 'old', status: 'accepted', resolvedAt: now - 20 * day,},),
			recent: makeProposal({id: 'recent', status: 'rejected', resolvedAt: now - 2 * day,},),
			attention: makeProposal({id: 'attention', status: 'needs_attention', resolvedAt: now - 20 * day,},),
		},)
		const pruned = await pruneResolvedProposals(SUB, 14, now,)
		expect(pruned,).toBe(2,)
		expect(Object.keys(wiki.get().proposals,).sort(),).toEqual(['attention', 'pending', 'recent',],)
	})

	it('does not write when nothing is prunable', async () => {
		wiki.seed({pending: makeProposal({id: 'pending',},),},)
		const pruned = await pruneResolvedProposals(SUB, 14, 1_000_000,)
		expect(pruned,).toBe(0,)
		expect(writeProposalsPage,).not.toHaveBeenCalled()
	})

	it('keeps a terminal proposal with no resolvedAt out of age-pruning, but prunes it once acked', async () => {
		const now = 1_000_000
		const day = 24 * 60 * 60
		wiki.seed({
			// Terminal but missing resolvedAt (legacy/tampered), with a stale updatedAt: its true
			// resolution time is unknown, so it must NOT be age-pruned via the updatedAt fallback.
			noResolved: makeProposal({id: 'noResolved', status: 'accepted', updatedAt: now - 50 * day,},),
			// Same, but acked → always prune-eligible regardless of resolvedAt.
			ackedNoResolved: makeProposal({
				id: 'ackedNoResolved',
				status: 'accepted',
				updatedAt: now - 50 * day,
				ackedByProposer: true,
			},),
		},)
		const pruned = await pruneResolvedProposals(SUB, 14, now,)
		expect(pruned,).toBe(1,)
		expect(Object.keys(wiki.get().proposals,),).toEqual(['noResolved',],)
	})
})

describe('opportunistic pruning on resolve', () => {
	it('rejectProposal prunes aged-out resolved proposals in the same write, keeping the just-rejected one', async () => {
		wiki.seed({
			target: makeProposal({id: 'target', status: 'pending',},),
			// Ancient resolution (resolvedAt far below any realistic retention cutoff) → prunable.
			old: makeProposal({id: 'old', status: 'accepted', resolvedAt: 1000,},),
		},)
		const result = await rejectProposal(SUB, 'target', 'snr', undefined, 14,)
		expect(result.ok,).toBe(true,)
		// `old` pruned in the same write; `target` kept (its fresh resolvedAt is inside the window).
		expect(Object.keys(wiki.get().proposals,),).toEqual(['target',],)
		expect(wiki.get().proposals.target!.status,).toBe('rejected',)
	})

	it('rejectProposal does not prune when no retention window is supplied', async () => {
		wiki.seed({
			target: makeProposal({id: 'target', status: 'pending',},),
			old: makeProposal({id: 'old', status: 'accepted', resolvedAt: 1000,},),
		},)
		await rejectProposal(SUB, 'target', 'snr',)
		expect(Object.keys(wiki.get().proposals,).sort(),).toEqual(['old', 'target',],)
	})

	it('dismissProposal removes the just-acked resolved proposal in the same write', async () => {
		wiki.seed({p1: makeProposal({id: 'p1', status: 'rejected', resolvedBy: 'snr', resolvedAt: nowInSeconds(),},),},)
		const result = await dismissProposal(SUB, 'p1', 14,)
		expect(result.ok,).toBe(true,)
		// Acked + terminal is always prune-eligible, so it is gone immediately.
		expect(wiki.get().proposals.p1,).toBeUndefined()
	})
})

describe('loadProposals', () => {
	it('reads fresh then serves from cache until forced', async () => {
		wiki.seed({p1: makeProposal({id: 'p1',},),},)
		await loadProposals(SUB,)
		expect(readProposalsPage,).toHaveBeenCalledTimes(1,)
		await loadProposals(SUB,)
		expect(readProposalsPage,).toHaveBeenCalledTimes(1,) // cache hit
		await loadProposals(SUB, {force: true,},)
		expect(readProposalsPage,).toHaveBeenCalledTimes(2,)
	})
})

describe('loadProposalsForSubs', () => {
	it('aggregates each sub and degrades a failing sub to empty data', async () => {
		readProposalsPage.mockImplementation(async (subreddit: string,) => {
			if (subreddit === 'bad') { throw new Error('no wiki access',) }
			return {data: {ver: 1, proposals: {[subreddit]: makeProposal({id: subreddit,},),},}, rev: 'r1',}
		},)
		const {entries, failedSubs,} = await loadProposalsForSubs(['good', 'bad', 'other',],)
		expect(entries.map((e,) => e.subreddit),).toEqual(['good', 'bad', 'other',],)
		expect(Object.keys(entries[0]!.data.proposals,),).toEqual(['good',],)
		expect(entries[1]!.data.proposals,).toEqual({},) // bad sub fell back to empty
		expect(Object.keys(entries[2]!.data.proposals,),).toEqual(['other',],)
		expect(failedSubs,).toEqual(['bad',],) // the failing sub is reported for retry
	})
})

describe('replay claim', () => {
	it('refuses a second claim while one is live, even for the same reviewer', async () => {
		wiki.seed({p1: makeProposal({id: 'p1',},),},)
		const first = await claimProposalForReplay(SUB, 'p1', 'mod',)
		expect(first.ok,).toBe(true,)
		const second = await claimProposalForReplay(SUB, 'p1', 'mod',)
		expect(second,).toMatchObject({ok: false, reason: 'in-progress',},)
	})

	it('refuses to reject/obsolete a proposal while an accept claim is live', async () => {
		wiki.seed({p1: makeProposal({id: 'p1',},),},)
		await claimProposalForReplay(SUB, 'p1', 'mod',)
		const rejected = await rejectProposal(SUB, 'p1', 'other',)
		expect(rejected,).toMatchObject({ok: false, reason: 'in-progress',},)
		const obsoleted = await markProposalObsolete(SUB, 'p1', 'deleted',)
		expect(obsoleted,).toMatchObject({ok: false, reason: 'in-progress',},)
		// The proposal is untouched — still pending, ready for the in-flight accept to resolve.
		expect(wiki.get().proposals.p1!.status,).toBe('pending',)
	})

	it('releasing the claim lets the proposal be rejected again', async () => {
		wiki.seed({p1: makeProposal({id: 'p1',},),},)
		await claimProposalForReplay(SUB, 'p1', 'mod',)
		await releaseProposalClaim(SUB, 'p1', 'mod',)
		const rejected = await rejectProposal(SUB, 'p1', 'mod',)
		expect(rejected.ok,).toBe(true,)
		expect(wiki.get().proposals.p1!.replayClaim,).toBeUndefined()
	})

	it('accepted/needs_attention transitions proceed despite a held claim (the accept owns it)', async () => {
		wiki.seed({p1: makeProposal({id: 'p1',},),},)
		await claimProposalForReplay(SUB, 'p1', 'mod',)
		const accepted = await transitionProposal(SUB, 'p1', 'accepted', {resolvedBy: 'mod',}, 'accept p1',)
		expect(accepted.ok,).toBe(true,)
		// The claim is cleared from the resolved record.
		expect(wiki.get().proposals.p1!.replayClaim,).toBeUndefined()
	})
})
