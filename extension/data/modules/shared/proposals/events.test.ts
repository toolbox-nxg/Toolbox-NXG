/** Tests for the proposals event bus: local notification + cross-tab propagation. */

// happy-dom (the default env) supplies window/CustomEvent for the cross-tab receiver.
import {beforeEach, describe, expect, it, vi,} from 'vitest'

const sendMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined,))
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage,},},}),)

import {
	broadcastProposalsChanged,
	emitProposalsChanged,
	getCachedProposals,
	invalidateProposalsCache,
	onProposalsChanged,
	setCachedProposals,
	setupProposalsCrossTab,
} from './events'

/** A minimal valid proposals page payload. */
const sampleData = {ver: 1, seq: 1, proposals: {},}

/** Dispatches the cross-tab event the message bridge would deliver. */
function dispatchChange (detail: unknown,): void {
	window.dispatchEvent(new CustomEvent('TB_PROPOSALS_CHANGED', {detail,},),)
}

beforeEach(() => {
	vi.clearAllMocks()
	invalidateProposalsCache()
},)

describe('emitProposalsChanged', () => {
	it('notifies local listeners without broadcasting', () => {
		const listener = vi.fn()
		const off = onProposalsChanged(listener,)

		emitProposalsChanged('aww',)

		expect(listener,).toHaveBeenCalledWith('aww',)
		expect(sendMessage,).not.toHaveBeenCalled()
		off()
	})
})

describe('broadcastProposalsChanged', () => {
	it('sends a toolbox-global message carrying the post-write data', () => {
		broadcastProposalsChanged('aww', sampleData,)

		expect(sendMessage,).toHaveBeenCalledOnce()
		expect(sendMessage,).toHaveBeenCalledWith({
			action: 'toolbox-global',
			globalEvent: 'TB_PROPOSALS_CHANGED',
			excludeBackground: true,
			// The data's own seq is the ordering key; no separate timestamp is sent.
			payload: {subreddit: 'aww', data: sampleData,},
		},)
	})

	it('swallows a transport failure rather than rejecting', () => {
		sendMessage.mockRejectedValueOnce(new Error('no receiving end',),)
		expect(() => broadcastProposalsChanged('aww', sampleData,)).not.toThrow()
	})
})

describe('setupProposalsCrossTab', () => {
	// Installed once for the suite; the receiver is idempotent.
	beforeEach(() => setupProposalsCrossTab())

	it('caches the shipped data and fires local listeners, without re-broadcasting', () => {
		const listener = vi.fn()
		const off = onProposalsChanged(listener,)

		dispatchChange({subreddit: 'aww', data: sampleData,},)

		expect(getCachedProposals('aww',),).toEqual(sampleData,)
		expect(listener,).toHaveBeenCalledWith('aww',)
		// The receiver must never echo the change back out.
		expect(sendMessage,).not.toHaveBeenCalled()
		off()
	})

	it('ignores a delayed lower-seq payload (no rollback) and does not re-render', () => {
		const newer = {ver: 1, seq: 2, proposals: {b2: {} as never,},}
		const older = {ver: 1, seq: 1, proposals: {a1: {} as never,},}
		const listener = vi.fn()

		// A newer page version lands first and is cached.
		dispatchChange({subreddit: 'aww', data: newer,},)
		const off = onProposalsChanged(listener,)

		// A delayed broadcast of an older version must NOT overwrite it or re-render.
		dispatchChange({subreddit: 'aww', data: older,},)

		expect(getCachedProposals('aww',),).toEqual(newer,)
		expect(listener,).not.toHaveBeenCalled()
		off()
	})

	it('applies a higher-seq broadcast over a stale read entry (the residual case)', () => {
		// A force-read served pre-commit data (seq 6) due to wiki read-after-write lag.
		// Because the version travels with the data, the seq-7 broadcast still wins — the
		// rollback the old timestamp scheme could not prevent.
		const staleRead = {ver: 1, seq: 6, proposals: {old: {} as never,},}
		const fresh = {ver: 1, seq: 7, proposals: {fresh: {} as never,},}
		setCachedProposals('aww', staleRead,)
		const listener = vi.fn()
		const off = onProposalsChanged(listener,)

		dispatchChange({subreddit: 'aww', data: fresh,},)

		expect(getCachedProposals('aww',),).toEqual(fresh,)
		expect(listener,).toHaveBeenCalledWith('aww',)
		off()
	})

	it('does not roll a newer read back to an older broadcast', () => {
		// A read brought seq 7; a delayed broadcast for an older seq-6 commit must lose.
		setCachedProposals('aww', {ver: 1, seq: 7, proposals: {read: {} as never,},},)

		dispatchChange({subreddit: 'aww', data: {ver: 1, seq: 6, proposals: {old: {} as never,},},},)

		expect(getCachedProposals('aww',),).toMatchObject({seq: 7,},)
	})

	it('invalidates the cache when no usable data is shipped', () => {
		setCachedProposals('aww', {ver: 1, seq: 1, proposals: {stale: {} as never,},},)
		const listener = vi.fn()
		const off = onProposalsChanged(listener,)

		dispatchChange({subreddit: 'aww',},)

		expect(getCachedProposals('aww',),).toBeUndefined()
		expect(listener,).toHaveBeenCalledWith('aww',)
		off()
	})

	it('ignores events with a missing or empty subreddit', () => {
		const listener = vi.fn()
		const off = onProposalsChanged(listener,)

		dispatchChange({subreddit: '',},)
		dispatchChange({data: sampleData,},)
		dispatchChange(undefined,)

		expect(listener,).not.toHaveBeenCalled()
		off()
	})
})
