/**
 * Tests for the proposals gateway: the capture decision (`maybePropose`) and accept
 * replay (`performProposal`). The wiki transport is faked in-memory (real storage
 * ops run on top) and the moderation primitives are mocked to assert replay calls.
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

const approveThing = vi.hoisted(() => vi.fn(async () => {},))
const removeThing = vi.hoisted(() => vi.fn(async () => {},))
const lock = vi.hoisted(() => vi.fn(async () => {},))
const unlock = vi.hoisted(() => vi.fn(async () => {},))
const distinguishThing = vi.hoisted(() => vi.fn(async () => {},))
const markOver18 = vi.hoisted(() => vi.fn(async () => {},))
const unMarkOver18 = vi.hoisted(() => vi.fn(async () => {},))
const stickyThread = vi.hoisted(() => vi.fn(async () => {},))
const unstickyThread = vi.hoisted(() => vi.fn(async () => {},))
vi.mock('../../../api/resources/things', () => ({
	approveThing,
	removeThing,
	lock,
	unlock,
	distinguishThing,
	markOver18,
	unMarkOver18,
	stickyThread,
	unstickyThread,
}),)

const banUser = vi.hoisted(() => vi.fn(async () => {},))
const unbanUser = vi.hoisted(() => vi.fn(async () => {},))
const muteUser = vi.hoisted(() => vi.fn(async () => {},))
const unmuteUser = vi.hoisted(() => vi.fn(async () => {},))
vi.mock('../../../api/resources/relationships', () => ({banUser, unbanUser, muteUser, unmuteUser,}),)

const flairUser = vi.hoisted(() => vi.fn(async () => {},))
vi.mock('../../../api/resources/flair', () => ({flairUser,}),)

import {isInReplay, setCaptureActivePredicate,} from '../../../util/infra/captureGuard'
import type {Proposal, ProposalsData, ProposedAction,} from '../../../util/wiki/schemas/proposals/schema'
import {invalidateProposalsCache,} from './events'
import {
	isTrainingCaptureActive,
	maybePropose,
	performProposal,
	performRemoval,
	proposeOrApprove,
	proposeOrBan,
	proposeOrLock,
	proposeOrMarkNsfw,
	proposeOrSticky,
	proposeOrUnsticky,
	proposeOrUserFlair,
	registerReplayHandler,
	setActionGuardDecider,
	setCurrentUserProvider,
} from './gateway'
import {loadProposals,} from './moduleapi'
import {setReviewMode,} from './reviewMode'

const SUB = 'testsub'
const clone = <T,>(v: T,): T => JSON.parse(JSON.stringify(v,),) as T

/** In-memory proposals page with `previous`-based conflict semantics. */
function fakeWiki () {
	let data: ProposalsData = {ver: 1, proposals: {},}
	let rev: string | undefined
	let n = 0
	readProposalsPage.mockImplementation(async () => ({data: clone(data,), rev,}))
	writeProposalsPage.mockImplementation(
		async (_s: string, _p: string, next: ProposalsData, _r: string, prev: string | undefined,) => {
			if (prev !== rev) { return {ok: false, conflict: true, data: clone(data,), rev: rev!,} }
			data = clone(next,)
			rev = `rev${++n}`
			return {ok: true,}
		},
	)
	return {
		get: () => data,
		seed (p: Record<string, Proposal>,) {
			data = {ver: 1, proposals: clone(p,),}
			rev = `rev${++n}`
		},
	}
}

let wiki: ReturnType<typeof fakeWiki>

beforeEach(() => {
	vi.clearAllMocks()
	invalidateProposalsCache()
	wiki = fakeWiki()
	setCurrentUserProvider(() => 'trainee')
	setCaptureActivePredicate(() => false)
	setActionGuardDecider(() => true)
},)

afterEach(() => {
	invalidateProposalsCache()
	setCaptureActivePredicate(() => false)
	setActionGuardDecider(() => true)
	setReviewMode('t3_abc', false,)
},)

/** Builds a stored proposal. */
function makeProposal (action: ProposedAction, overrides: Partial<Proposal> = {},): Proposal {
	return {
		id: 'p1',
		itemId: 't3_abc',
		itemKind: 'post',
		action,
		proposedBy: 'trainee',
		proposedAt: 100,
		updatedAt: 100,
		source: 'training',
		status: 'pending',
		...overrides,
	}
}

describe('maybePropose', () => {
	it('returns false and writes nothing when not capture-active and not forced', async () => {
		const captured = await maybePropose({type: 'remove', spam: false,}, {
			subreddit: SUB,
			itemId: 't3_abc',
			itemKind: 'post',
		},)
		expect(captured,).toBe(false,)
		expect(writeProposalsPage,).not.toHaveBeenCalled()
	})

	it('captures as training when the subreddit is capture-active', async () => {
		setCaptureActivePredicate((s,) => s === SUB)
		const captured = await maybePropose({type: 'remove', spam: true,}, {
			subreddit: SUB,
			itemId: 't3_abc',
			itemKind: 'post',
			note: 'looks like spam',
		},)
		expect(captured,).toBe(true,)
		const stored = Object.values(wiki.get().proposals,)
		expect(stored,).toHaveLength(1,)
		expect(stored[0],).toMatchObject({
			source: 'training',
			proposedBy: 'trainee',
			status: 'pending',
			note: 'looks like spam',
			action: {type: 'remove', spam: true,},
		},)
	})

	it('captures as second-opinion when forced, even if not a trainee', async () => {
		const captured = await maybePropose({type: 'approve',}, {
			subreddit: SUB,
			itemId: 't3_abc',
			itemKind: 'post',
			force: true,
		},)
		expect(captured,).toBe(true,)
		expect(Object.values(wiki.get().proposals,)[0]!.source,).toBe('second-opinion',)
	})

	it('captures as second-opinion when the item is armed via the review-mode toggle', async () => {
		setReviewMode('t3_abc', true,)
		const captured = await maybePropose({type: 'remove', spam: false,}, {
			subreddit: SUB,
			itemId: 't3_abc',
			itemKind: 'post',
		},)
		expect(captured,).toBe(true,)
		expect(Object.values(wiki.get().proposals,)[0]!.source,).toBe('second-opinion',)
	})

	it('disarms the review-mode toggle after capturing the item once', async () => {
		setReviewMode('t3_abc', true,)
		await maybePropose({type: 'remove', spam: false,}, {subreddit: SUB, itemId: 't3_abc', itemKind: 'post',},)
		// A second action on the item, with no training capture, now performs (returns false).
		const second = await maybePropose({type: 'approve',}, {subreddit: SUB, itemId: 't3_abc', itemKind: 'post',},)
		expect(second,).toBe(false,)
	})

	it('throws and writes nothing when the current user cannot be resolved', async () => {
		// A forced second-opinion capture before the current-user cache warms: the provider
		// still returns ''. Fail visibly rather than append a proposal the codec will later
		// drop as malformed (proposedBy is required non-empty).
		setCurrentUserProvider(() => '')
		await expect(
			maybePropose({type: 'approve',}, {subreddit: SUB, itemId: 't3_abc', itemKind: 'post', force: true,},),
		).rejects.toThrow(/current user/,)
		expect(writeProposalsPage,).not.toHaveBeenCalled()
	})

	it('awaits an async provider so the proposer is recorded once it resolves', async () => {
		setCurrentUserProvider(() => Promise.resolve('latemod',))
		const captured = await maybePropose({type: 'approve',}, {
			subreddit: SUB,
			itemId: 't3_abc',
			itemKind: 'post',
			force: true,
		},)
		expect(captured,).toBe(true,)
		expect(Object.values(wiki.get().proposals,)[0]!.proposedBy,).toBe('latemod',)
	})
})

describe('performProposal', () => {
	it('replays an approve and marks it accepted', async () => {
		wiki.seed({p1: makeProposal({type: 'approve',},),},)
		const result = await performProposal(SUB, makeProposal({type: 'approve',},), 'senior',)
		expect(result.ok,).toBe(true,)
		expect(approveThing,).toHaveBeenCalledWith('t3_abc',)
		const data = await loadProposals(SUB, {force: true,},)
		expect(data.proposals.p1!.status,).toBe('accepted',)
		expect(data.proposals.p1!.resolvedBy,).toBe('senior',)
	})

	it('replays a remove (spam) with the captured flag', async () => {
		const action: ProposedAction = {type: 'remove', spam: true,}
		wiki.seed({p1: makeProposal(action,),},)
		await performProposal(SUB, makeProposal(action,), 'senior',)
		expect(removeThing,).toHaveBeenCalledWith('t3_abc', true,)
	})

	it('replays marknsfw, sticky, and userflair to their primitives', async () => {
		wiki.seed({p1: makeProposal({type: 'marknsfw', nsfw: true,},),},)
		await performProposal(SUB, makeProposal({type: 'marknsfw', nsfw: true,},), 'senior',)
		expect(markOver18,).toHaveBeenCalledWith('t3_abc',)

		wiki.seed({p1: makeProposal({type: 'sticky', state: true, num: 1,},),},)
		await performProposal(SUB, makeProposal({type: 'sticky', state: true, num: 1,},), 'senior',)
		expect(stickyThread,).toHaveBeenCalledWith('t3_abc', 1, true,)

		const flair = makeProposal({type: 'userflair', text: 'VIP',}, {itemId: 'someuser', itemKind: 'user',},)
		wiki.seed({p1: flair,},)
		await performProposal(SUB, flair, 'senior',)
		expect(flairUser,).toHaveBeenCalledWith({user: 'someuser', subreddit: SUB, text: 'VIP',},)
	})

	it('dispatches a composite action to its registered replay handler', async () => {
		const handler = vi.fn(async () => {},)
		registerReplayHandler('removal-reason', handler,)
		const action = {type: 'removal-reason', intent: {data: {fullname: 't3_abc',},},} as unknown as ProposedAction
		wiki.seed({p1: makeProposal(action,),},)
		const result = await performProposal(SUB, makeProposal(action,), 'senior',)
		expect(result.ok,).toBe(true,)
		expect(handler,).toHaveBeenCalledOnce()
	})

	it('records needs_attention when replay throws', async () => {
		registerReplayHandler(
			'removal-reason',
			vi.fn(async () => {
				throw new Error('removal message failed',)
			},),
		)
		const action = {type: 'removal-reason', intent: {data: {},},} as unknown as ProposedAction
		wiki.seed({p1: makeProposal(action,),},)
		const result = await performProposal(SUB, makeProposal(action,), 'senior',)
		expect(result,).toMatchObject({ok: false, reason: 'replay-failed',},)
		const data = await loadProposals(SUB, {force: true,},)
		const stored = data.proposals.p1!
		expect(stored.status,).toBe('needs_attention',)
		expect(stored.needsAttention,).toMatchObject({
			attemptedBy: 'senior',
			failedStep: 'removal message failed',
			irreversibleSideEffect: true,
		},)
	})

	it('refuses a self-accept of a second-opinion request (no replay)', async () => {
		const action: ProposedAction = {type: 'approve',}
		const proposal = makeProposal(action, {source: 'second-opinion', proposedBy: 'me',},)
		wiki.seed({p1: proposal,},)
		const result = await performProposal(SUB, proposal, 'me',)
		expect(result,).toMatchObject({ok: false, reason: 'self-accept',},)
		expect(approveThing,).not.toHaveBeenCalled()
	})

	it('refuses a self-accept even when the reviewer name differs only in case', async () => {
		// Reddit usernames are case-insensitive; the proposer must not bypass the guard
		// just because the stored proposer and the reviewer string disagree on casing.
		const action: ProposedAction = {type: 'approve',}
		const proposal = makeProposal(action, {source: 'second-opinion', proposedBy: 'Me',},)
		wiki.seed({p1: proposal,},)
		const result = await performProposal(SUB, proposal, 'me',)
		expect(result,).toMatchObject({ok: false, reason: 'self-accept',},)
		expect(approveThing,).not.toHaveBeenCalled()
	})

	it('refuses to retry a needs_attention proposal that already applied an irreversible side effect', async () => {
		const proposal = makeProposal({type: 'approve',}, {
			status: 'needs_attention',
			needsAttention: {
				attemptedBy: 'senior',
				attemptedAt: 1,
				failedStep: 'sendRemovalMessage',
				irreversibleSideEffect: true,
				error: 'message send failed',
			},
		},)
		wiki.seed({p1: proposal,},)
		const result = await performProposal(SUB, proposal, 'senior',)
		expect(result,).toMatchObject({ok: false, reason: 'irreversible-retry',},)
		expect(approveThing,).not.toHaveBeenCalled()
	})

	it('still retries a needs_attention proposal whose failure left no irreversible side effect', async () => {
		const proposal = makeProposal({type: 'approve',}, {
			status: 'needs_attention',
			needsAttention: {
				attemptedBy: 'senior',
				attemptedAt: 1,
				failedStep: 'approveThing',
				irreversibleSideEffect: false,
				error: 'transient network error',
			},
		},)
		wiki.seed({p1: proposal,},)
		const result = await performProposal(SUB, proposal, 'senior',)
		expect(result.ok,).toBe(true,)
		expect(approveThing,).toHaveBeenCalledWith('t3_abc',)
	})

	it('serializes two concurrent accepts so the action replays only once', async () => {
		// Both reviewers start from the same pending snapshot (the real-world race: two open
		// review drawers). The atomic claim must let only one replay; the other sees the
		// proposal already resolved, never performing the side effect a second time.
		const proposal = makeProposal({type: 'approve',},)
		wiki.seed({p1: proposal,},)
		const [a, b,] = await Promise.all([
			performProposal(SUB, proposal, 'senior',),
			performProposal(SUB, proposal, 'other',),
		],)
		const oks = [a, b,].filter((r,) => r.ok)
		expect(oks,).toHaveLength(1,)
		expect(approveThing,).toHaveBeenCalledTimes(1,)
		const loser = [a, b,].find((r,) => !r.ok)!
		expect(loser.ok,).toBe(false,)
		// The loser is blocked at the claim (in-progress) or after it resolved (already-resolved).
		if (!loser.ok) {
			expect(['in-progress', 'already-resolved',],).toContain(loser.reason,)
		}
	})

	it('serializes two concurrent accepts from the SAME account (double-click / two tabs)', async () => {
		// The worst case: one moderator triggering Accept twice (double-click, two drawers,
		// Accept + Edit & Accept). A same-account claim must still block, or the side effect
		// replays twice before either path marks the proposal accepted.
		const proposal = makeProposal({type: 'approve',},)
		wiki.seed({p1: proposal,},)
		const [a, b,] = await Promise.all([
			performProposal(SUB, proposal, 'senior',),
			performProposal(SUB, proposal, 'senior',),
		],)
		expect([a, b,].filter((r,) => r.ok),).toHaveLength(1,)
		expect(approveThing,).toHaveBeenCalledTimes(1,)
	})

	it('clears the replay claim from the accepted record', async () => {
		wiki.seed({p1: makeProposal({type: 'approve',},),},)
		await performProposal(SUB, makeProposal({type: 'approve',},), 'senior',)
		expect(wiki.get().proposals.p1!.replayClaim,).toBeUndefined()
	})

	it('refuses to replay an already-terminal proposal', async () => {
		const proposal = makeProposal({type: 'approve',}, {status: 'rejected', resolvedBy: 'x',},)
		const result = await performProposal(SUB, proposal, 'senior',)
		expect(result,).toMatchObject({ok: false, reason: 'already-resolved',},)
		expect(approveThing,).not.toHaveBeenCalled()
	})

	it('prunes aged-out resolved proposals in the same write when accepting with a retention window', async () => {
		wiki.seed({
			p1: makeProposal({type: 'approve',},),
			// Ancient resolution → prunable once we accept p1 and pass a retention window.
			old: makeProposal({type: 'approve',}, {id: 'old', status: 'rejected', resolvedAt: 1000,},),
		},)
		const result = await performProposal(SUB, makeProposal({type: 'approve',},), 'senior', 14,)
		expect(result.ok,).toBe(true,)
		// p1 is now accepted (fresh resolvedAt, kept); the ancient `old` was pruned.
		expect(Object.keys(wiki.get().proposals,),).toEqual(['p1',],)
		expect(wiki.get().proposals.p1!.status,).toBe('accepted',)
	})

	it('runs atomic replays inside an authorized replay context', async () => {
		let sawReplay = false
		approveThing.mockImplementationOnce(async () => {
			sawReplay = isInReplay()
		},)
		wiki.seed({p1: makeProposal({type: 'approve',},),},)
		await performProposal(SUB, makeProposal({type: 'approve',},), 'senior',)
		expect(sawReplay,).toBe(true,)
	})

	it('replays a lock via the lock primitive', async () => {
		const action: ProposedAction = {type: 'lock',}
		wiki.seed({p1: makeProposal(action,),},)
		await performProposal(SUB, makeProposal(action,), 'senior',)
		expect(lock,).toHaveBeenCalledWith('t3_abc',)
	})

	it('replays a ban, mapping permanent → duration 0', async () => {
		const action: ProposedAction = {
			type: 'ban',
			permanent: true,
			days: 0,
			note: 'n',
			message: 'msg',
			context: 't3_abc',
		}
		// itemId is the username for user actions.
		wiki.seed({p1: makeProposal(action, {itemId: 'baduser', itemKind: 'user',},),},)
		await performProposal(SUB, makeProposal(action, {itemId: 'baduser', itemKind: 'user',},), 'senior',)
		expect(banUser,).toHaveBeenCalledWith(expect.objectContaining({
			user: 'baduser',
			subreddit: SUB,
			banDuration: 0,
			banMessage: 'msg',
			banContext: 't3_abc',
		},),)
	})
})

describe('propose-or-perform verbs', () => {
	const ctx = {subreddit: SUB, itemId: 't3_abc', itemKind: 'post' as const,}

	it('proposeOrLock performs the lock when not sandboxed', async () => {
		const outcome = await proposeOrLock(ctx,)
		expect(outcome,).toBe('performed',)
		expect(lock,).toHaveBeenCalledWith('t3_abc',)
	})

	it('proposeOrLock captures (no real lock) when sandboxed', async () => {
		setCaptureActivePredicate((s,) => s === SUB)
		const outcome = await proposeOrLock(ctx,)
		expect(outcome,).toBe('captured',)
		expect(lock,).not.toHaveBeenCalled()
		expect(Object.values(wiki.get().proposals,)[0]!.action,).toEqual({type: 'lock',},)
	})

	it('proposeOrBan captures the resolved ban params when sandboxed', async () => {
		setCaptureActivePredicate(() => true)
		const userCtx = {subreddit: SUB, itemId: 'baduser', itemKind: 'user' as const,}
		const outcome = await proposeOrBan(userCtx, {permanent: false, days: 3, note: 'n', message: 'm',},)
		expect(outcome,).toBe('captured',)
		expect(banUser,).not.toHaveBeenCalled()
		expect(Object.values(wiki.get().proposals,)[0]!.action,).toMatchObject({type: 'ban', days: 3,},)
	})

	it('proposeOrMarkNsfw performs mark/unmark when not sandboxed', async () => {
		expect(await proposeOrMarkNsfw(ctx, true,),).toBe('performed',)
		expect(markOver18,).toHaveBeenCalledWith('t3_abc',)
		expect(await proposeOrMarkNsfw(ctx, false,),).toBe('performed',)
		expect(unMarkOver18,).toHaveBeenCalledWith('t3_abc',)
	})

	it('proposeOrSticky captures the slot when sandboxed (no real sticky)', async () => {
		setCaptureActivePredicate((s,) => s === SUB)
		expect(await proposeOrSticky(ctx, 2,),).toBe('captured',)
		expect(stickyThread,).not.toHaveBeenCalled()
		expect(Object.values(wiki.get().proposals,)[0]!.action,).toEqual({type: 'sticky', state: true, num: 2,},)
	})

	it('proposeOrSticky / proposeOrUnsticky perform when not sandboxed', async () => {
		expect(await proposeOrSticky(ctx, 1,),).toBe('performed',)
		expect(stickyThread,).toHaveBeenCalledWith('t3_abc', 1,)
		expect(await proposeOrUnsticky(ctx,),).toBe('performed',)
		expect(unstickyThread,).toHaveBeenCalledWith('t3_abc',)
	})

	it('proposeOrUserFlair captures the flair params when sandboxed', async () => {
		setCaptureActivePredicate(() => true)
		const userCtx = {subreddit: SUB, itemId: 'someuser', itemKind: 'user' as const,}
		expect(await proposeOrUserFlair(userCtx, {text: 'VIP', cssClass: 'vip', templateID: 'tid',},),).toBe(
			'captured',
		)
		expect(flairUser,).not.toHaveBeenCalled()
		expect(Object.values(wiki.get().proposals,)[0]!.action,).toEqual({
			type: 'userflair',
			text: 'VIP',
			cssClass: 'vip',
			templateID: 'tid',
		},)
	})

	it('proposeOrUserFlair performs the flair when not sandboxed', async () => {
		const userCtx = {subreddit: SUB, itemId: 'someuser', itemKind: 'user' as const,}
		expect(await proposeOrUserFlair(userCtx, {text: 'VIP',},),).toBe('performed',)
		expect(flairUser,).toHaveBeenCalledWith({user: 'someuser', subreddit: SUB, text: 'VIP',},)
	})

	it('performRemoval performs the removal in replay even when sandboxed, never capturing', async () => {
		// The accept surface uses this; it must perform (not capture) even if the reviewer
		// is a trainee in this sub, so it runs inside the authorized replay window.
		setCaptureActivePredicate((s,) => s === SUB)
		let sawReplay = false
		removeThing.mockImplementationOnce(async () => {
			sawReplay = isInReplay()
		},)
		await performRemoval(ctx, false,)
		expect(removeThing,).toHaveBeenCalledWith('t3_abc', false,)
		expect(sawReplay,).toBe(true,)
		expect(Object.values(wiki.get().proposals,),).toHaveLength(0,)
	})
})

describe('per-action guarding', () => {
	const ctx = {subreddit: SUB, itemId: 't3_abc', itemKind: 'post' as const,}

	it('captures only the action types the guard decider approves', async () => {
		// Trainee here, but the subreddit guards only `lock` — `approve` is un-guarded.
		setCaptureActivePredicate((s,) => s === SUB)
		setActionGuardDecider((_s, type,) => type === 'lock')

		// A guarded action is still captured for review.
		expect(await proposeOrLock(ctx,),).toBe('captured',)
		expect(lock,).not.toHaveBeenCalled()
		expect(Object.values(wiki.get().proposals,)[0]!.action,).toEqual({type: 'lock',},)
	})

	it('performs an un-guarded action for a trainee, authorized past the backstop', async () => {
		// A trainee performing an un-guarded action must slip past the fail-closed capture
		// backstop, so the perform runs inside the authorized replay window.
		setCaptureActivePredicate((s,) => s === SUB)
		setActionGuardDecider((_s, type,) => type === 'lock')
		let sawReplay = false
		approveThing.mockImplementationOnce(async () => {
			sawReplay = isInReplay()
		},)

		const outcome = await proposeOrApprove(ctx,)
		expect(outcome,).toBe('performed',)
		expect(approveThing,).toHaveBeenCalledWith('t3_abc',)
		expect(sawReplay,).toBe(true,)
		expect(Object.values(wiki.get().proposals,),).toHaveLength(0,)
	})

	it('still captures a forced second opinion for an un-guarded action type', async () => {
		// `force` is an explicit per-item request; the guarded-action set must not suppress it.
		setActionGuardDecider(() => false)
		const captured = await maybePropose({type: 'approve',}, {...ctx, force: true,},)
		expect(captured,).toBe(true,)
		expect(Object.values(wiki.get().proposals,)[0]!.source,).toBe('second-opinion',)
	})
})

describe('isTrainingCaptureActive', () => {
	it('reflects the capture decision for the subreddit', async () => {
		expect(await isTrainingCaptureActive(SUB,),).toBe(false,)
		setCaptureActivePredicate((s,) => s === SUB)
		expect(await isTrainingCaptureActive(SUB,),).toBe(true,)
		expect(await isTrainingCaptureActive('other',),).toBe(false,)
	})
})
