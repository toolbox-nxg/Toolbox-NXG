/** Tests for the proposals runtime wiring (setup.ts). */

// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

// Pulled in transitively via the proposals event bus' cross-tab broadcast.
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage: vi.fn().mockResolvedValue(undefined,),},},}),)

const setCaptureActivePredicate = vi.hoisted(() => vi.fn(() => vi.fn()))
const setCaptureAnywherePredicate = vi.hoisted(() => vi.fn(() => vi.fn()))
const setPageSubreddit = vi.hoisted(() => vi.fn())
const setCaptureDecider = vi.hoisted(() => vi.fn())
const setActionGuardDecider = vi.hoisted(() => vi.fn())
const setCurrentUserProvider = vi.hoisted(() => vi.fn())
const loadCurrentUser = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const ensureTraineeStateLoaded = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const warmAllTraineeStates = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const setTraineeStateWarm = vi.hoisted(() => vi.fn())
const installApproveCapture = vi.hoisted(() => vi.fn())

vi.mock('../../../util/infra/captureGuard', () => ({
	setCaptureActivePredicate,
	setCaptureAnywherePredicate,
	setPageSubreddit,
}),)
vi.mock('./gateway', () => ({setActionGuardDecider, setCaptureDecider, setCurrentUserProvider,}),)
vi.mock('./approveCapture', () => ({installApproveCapture,}),)
vi.mock('./traineeState', () => ({
	ensureTraineeStateLoaded,
	getProposerName: vi.fn(() => ''),
	isActionGuardedFor: vi.fn(),
	isTraineeAnywhereSync: vi.fn(),
	isTraineeFor: vi.fn(),
	isTraineeForSync: vi.fn(),
	loadCurrentUser,
	resolveProposerName: vi.fn(() => Promise.resolve('',)),
	setTraineeStateWarm,
	warmAllTraineeStates,
}),)
// postSite seeds the guard's page fallback.
vi.mock('../../../util/reddit/pageContext', () => ({postSite: 'seedsub',}),)

import {initProposalsRuntime,} from './setup'

describe('initProposalsRuntime page-subreddit wiring', () => {
	beforeEach(() => {
		setPageSubreddit.mockClear()
	},)
	afterEach(() => {
		vi.clearAllMocks()
	},)

	it('does not let a stale page warm re-enable the fast path for a newer page', async () => {
		// Overlapping SPA navigation: page A's warm is still in flight when page B navigates.
		// A's (slower) warm completing must NOT mark the trainee state ready, because B's sets
		// aren't loaded yet — otherwise the native-approve fast path re-opens for page B.
		// This runs first, so no TBNewPage listeners from other tests have accumulated and the
		// single dispatch fires exactly one syncPageSubreddit.
		const pending: Array<{resolve: () => void}> = []
		ensureTraineeStateLoaded.mockImplementation(() => {
			let resolve!: () => void
			const promise = new Promise<void>((r,) => {
				resolve = () => r()
			},)
			pending.push({resolve,},)
			return promise
		},)
		const flush = () => new Promise((r,) => setTimeout(r, 0,))

		initProposalsRuntime() // page A = seedsub → pending[0]
		window.dispatchEvent(new CustomEvent('TBNewPage', {detail: {pageDetails: {subreddit: 'subB',},},},),)
		// pending[0] = seedsub (older), pending[1] = subB (current).
		pending[0]!.resolve() // the stale page-A warm resolves first
		await flush()
		expect(setTraineeStateWarm,).not.toHaveBeenCalledWith(true,)

		pending[1]!.resolve() // page B's own warm completes
		await flush()
		expect(setTraineeStateWarm,).toHaveBeenCalledWith(true,)

		// Restore the default so the deferred impl doesn't leak into later tests.
		ensureTraineeStateLoaded.mockImplementation(() => Promise.resolve())
	})

	it('seeds the guard page subreddit from postSite at startup', () => {
		initProposalsRuntime()
		expect(setPageSubreddit,).toHaveBeenCalledWith('seedsub',)
	})

	it('warms the page subreddit\'s trainee set, installs approve capture, wires the anywhere guard', () => {
		initProposalsRuntime()
		expect(ensureTraineeStateLoaded,).toHaveBeenCalledWith('seedsub',)
		expect(installApproveCapture,).toHaveBeenCalledOnce()
		expect(setCaptureAnywherePredicate,).toHaveBeenCalledOnce()
	})

	it('refreshes the guard page subreddit on each TBNewPage navigation', () => {
		initProposalsRuntime()
		setPageSubreddit.mockClear()

		window.dispatchEvent(new CustomEvent('TBNewPage', {detail: {pageDetails: {subreddit: 'othersub',},},},),)
		expect(setPageSubreddit,).toHaveBeenLastCalledWith('othersub',)
	})

	it('clears the page subreddit (undefined) when navigating to a page with no subreddit', () => {
		initProposalsRuntime()
		setPageSubreddit.mockClear()

		// A multi-sub/unknown page carries no subreddit; the guard must not resolve a stale one.
		window.dispatchEvent(new CustomEvent('TBNewPage', {detail: {pageDetails: {},},},),)
		expect(setPageSubreddit,).toHaveBeenLastCalledWith(undefined,)
	})

	it('blocks the interceptor fast path until the page warm settles, then re-enables it', async () => {
		initProposalsRuntime()
		// Synchronously on (re)entry: not warm, so the native-approve interceptor can't trust
		// a sync "not a trainee" and falls back to the async decision.
		expect(setTraineeStateWarm,).toHaveBeenCalledWith(false,)
		// Once the current user + the page's sets resolve, warm flips true.
		await Promise.resolve()
		await Promise.resolve()
		expect(setTraineeStateWarm,).toHaveBeenCalledWith(true,)
	})

	it('warms every moderated sub on a multi-sub page (no single subreddit)', () => {
		initProposalsRuntime()
		warmAllTraineeStates.mockClear()

		// No subreddit ⇒ fan out to warm all moderated subs so the guard's "sandboxed
		// anywhere?" check is reliable. (Each test's initProposalsRuntime leaves a
		// TBNewPage listener, so a single dispatch can fire several; we only need to
		// confirm the multi-sub path triggers the warm.)
		window.dispatchEvent(new CustomEvent('TBNewPage', {detail: {pageDetails: {},},},),)
		expect(warmAllTraineeStates,).toHaveBeenCalled()
	})
})
