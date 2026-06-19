/** Tests for warming every moderated sub's trainee set (warmAllTraineeStates). */

// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

const getModSubs = vi.hoisted(() => vi.fn())
const tryGetConfig = vi.hoisted(() => vi.fn())
const getCurrentUser = vi.hoisted(() => vi.fn(async () => 'aliceTrainee'))

vi.mock('../../../api/resources/modSubs', () => ({getModSubs,}),)
vi.mock('../../config/moduleapi', () => ({tryGetConfig,}),)
vi.mock('../../../api/resources/me', () => ({getCurrentUser,}),)

import {
	ensureTraineeStateLoaded,
	invalidateTraineeState,
	isActionGuardedFor,
	isTraineeAnywhereSync,
	isTraineeFor,
	isTraineeForSync,
	loadCurrentUser,
	resolveProposerName,
	warmAllTraineeStates,
} from './traineeState'

beforeEach(async () => {
	vi.clearAllMocks()
	invalidateTraineeState()
	getModSubs.mockResolvedValue(['sub1', 'sub2',],)
	tryGetConfig.mockImplementation(async (sub: string,) => ({
		status: 'ok',
		config: sub === 'sub1' ? {trainingMods: ['aliceTrainee',],} : {trainingMods: [],},
	}))
	await loadCurrentUser()
},)

afterEach(() => {
	invalidateTraineeState()
},)

describe('warmAllTraineeStates', () => {
	it('warms every moderated sub so the sync check answers for each', async () => {
		await warmAllTraineeStates()
		expect(getModSubs,).toHaveBeenCalledOnce()
		expect(isTraineeForSync('sub1',),).toBe(true,)
		expect(isTraineeForSync('sub2',),).toBe(false,)
	})

	it('coalesces concurrent and repeat calls into a single fan-out', async () => {
		await Promise.all([warmAllTraineeStates(), warmAllTraineeStates(),],)
		await warmAllTraineeStates()
		expect(getModSubs,).toHaveBeenCalledOnce()
	})

	it('re-runs after the trainee state is invalidated', async () => {
		await warmAllTraineeStates()
		invalidateTraineeState()
		await warmAllTraineeStates()
		expect(getModSubs,).toHaveBeenCalledTimes(2,)
	})

	it('skips the viewer\'s own profile pseudo-sub (no config read, no fail-safe trip)', async () => {
		// Reddit lists `u_<username>` (the viewer's own profile) among moderated subs, but it
		// has no toolbox config — warming must not read config for it, which would error and
		// falsely flip isTraineeAnywhereSync via the unreadable backstop.
		getModSubs.mockResolvedValue(['sub2', 'u_aliceTrainee',],)
		await warmAllTraineeStates()
		expect(tryGetConfig,).toHaveBeenCalledTimes(1,)
		expect(tryGetConfig,).toHaveBeenCalledWith('sub2',)
		expect(isTraineeAnywhereSync(),).toBe(false,)
	})
})

describe('resolveProposerName', () => {
	it('awaits the current-user load and returns the resolved name', async () => {
		// The proposals gateway records this as proposedBy; it must reflect the loaded
		// user (not the '' cold value) so a forced second-opinion capture isn't dropped.
		expect(await resolveProposerName(),).toBe('aliceTrainee',)
	})
})

describe('isTraineeAnywhereSync', () => {
	it('is false while cold and true once a sub where the user is a trainee is warm', async () => {
		expect(isTraineeAnywhereSync(),).toBe(false,)
		await ensureTraineeStateLoaded('sub2',) // user is NOT a trainee here
		expect(isTraineeAnywhereSync(),).toBe(false,)
		await ensureTraineeStateLoaded('sub1',) // user IS a trainee here
		expect(isTraineeAnywhereSync(),).toBe(true,)
	})

	it('goes back to false after invalidation clears the warm sets', async () => {
		await warmAllTraineeStates()
		expect(isTraineeAnywhereSync(),).toBe(true,)
		invalidateTraineeState()
		expect(isTraineeAnywhereSync(),).toBe(false,)
	})
})

describe('unreadable config fails safe (training state unknown ≠ no trainees)', () => {
	it('treats a read error as "capture", not "no trainees"', async () => {
		tryGetConfig.mockResolvedValue({status: 'error',},)
		// Even though membership is unknown, the sync/async checks must say "trainee" so the
		// action is captured for review rather than performed live.
		expect(await isTraineeFor('sub1',),).toBe(true,)
		expect(isTraineeForSync('sub1',),).toBe(true,)
		// And every action type is guarded under an unknown config.
		expect(await isActionGuardedFor('sub1', 'remove',),).toBe(true,)
	})

	it('still treats a sub with no config page as "no trainees" (perform live)', async () => {
		// `absent` is a definite answer — no config means no training — so it must NOT capture.
		tryGetConfig.mockResolvedValue({status: 'absent',},)
		expect(await isTraineeFor('sub1',),).toBe(false,)
		expect(isTraineeForSync('sub1',),).toBe(false,)
	})

	it('a non-moderated sub (config mod-gated to absent) is "no trainees", not unreadable', async () => {
		// The config layer default-denies subs the viewer doesn't moderate to `absent` (a
		// definite "no config") rather than `error`, so the training indicator stays hidden
		// instead of fail-safing to "trainee" via the unreadable backstop.
		tryGetConfig.mockResolvedValue({status: 'absent',},)
		await ensureTraineeStateLoaded('notmysub',)
		expect(isTraineeForSync('notmysub',),).toBe(false,)
		// Not added to the unreadable set, so the cross-sub fail-safe stays false too.
		expect(isTraineeAnywhereSync(),).toBe(false,)
	})

	it('re-attempts the read after a transient error rather than caching "unknown"', async () => {
		tryGetConfig.mockResolvedValueOnce({status: 'error',},)
		await ensureTraineeStateLoaded('sub1',)
		expect(isTraineeForSync('sub1',),).toBe(true,) // failed read → fail-safe capture
		// A later read succeeds (sub1 lists the user as a trainee) and supersedes the unknown.
		tryGetConfig.mockResolvedValue({status: 'ok', config: {trainingMods: ['aliceTrainee',],},},)
		await ensureTraineeStateLoaded('sub1',)
		expect(isTraineeForSync('sub1',),).toBe(true,)
		expect(isTraineeAnywhereSync(),).toBe(true,)
	})

	it('a recovered read clears the unreadable mark (anywhere goes back to false)', async () => {
		tryGetConfig.mockResolvedValueOnce({status: 'error',},)
		await ensureTraineeStateLoaded('sub2',)
		expect(isTraineeAnywhereSync(),).toBe(true,) // unknown sub ⇒ fail-safe yes
		tryGetConfig.mockResolvedValue({status: 'ok', config: {trainingMods: [],},},)
		await ensureTraineeStateLoaded('sub2',)
		// sub2 now known with no trainees and nothing else unreadable ⇒ back to false.
		expect(isTraineeAnywhereSync(),).toBe(false,)
	})
})
