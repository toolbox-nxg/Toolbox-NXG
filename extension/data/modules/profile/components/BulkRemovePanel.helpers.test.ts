/** Tests for the profile bulk-remove scan/remove loop. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

import {
	setCaptureActivePredicate,
	setCaptureAnywherePredicate,
	setCaptureExpected,
	setPageSubreddit,
} from '../../../util/infra/captureGuard'
import {bulkRemoveUserContent,} from './BulkRemovePanel.helpers'

// removeThing is intentionally NOT mocked so the test exercises the real capture
// guard inside removeThing. Only the network listing fetch and the low-level HTTP
// transport are stubbed, so the real removeThing → assertActionAllowed →
// postRedditApiVoid chain runs.
const getUserListingPage = vi.fn()
vi.mock('../../../api/resources/users', () => ({
	getUserListingPage: (...args: unknown[]) => getUserListingPage(...args,),
}),)

const apiOauthPOST = vi.fn()
vi.mock('../../../api/transport/http', () => ({
	apiOauthPOST: (...args: unknown[]) => apiOauthPOST(...args,),
	apiOauthGetJSON: vi.fn(),
}),)

/** Builds one overview listing child. */
function child (name: string, subreddit: string, extra: Record<string, unknown> = {},) {
	return {kind: 't1', data: {name, subreddit, ...extra,},}
}

/** Returns a single listing page (no further pages). */
function page (children: unknown[],) {
	return {data: {children, after: null,},}
}

/** Restores all capture-guard state to its inert defaults. */
function resetGuard () {
	setCaptureActivePredicate(() => false)
	setCaptureAnywherePredicate(() => false)
	setCaptureExpected(false,)
	setPageSubreddit(undefined,)
}

beforeEach(() => {
	getUserListingPage.mockReset()
	apiOauthPOST.mockReset()
	// postRedditApiVoid runs `await response.json()`, so return a minimal Response-like.
	apiOauthPOST.mockResolvedValue({json: async () => ({}),},)
	resetGuard()
},)
afterEach(resetGuard,)

describe('bulkRemoveUserContent', () => {
	it('lets a trainee sandboxed in another subreddit bulk-remove from a non-sandboxed target', async () => {
		// The current user is a trainee in `othersub` but not in `targetsub`. The
		// fetched items aren't DOM-registered, so without the helper registering each
		// item against `targetsub`, the guard's "unresolved sub + sandboxed somewhere"
		// branch would throw on the first removal and abort the scan.
		setCaptureActivePredicate((sub,) => sub === 'othersub')
		setCaptureAnywherePredicate(() => true)

		getUserListingPage.mockResolvedValue(page([
			child('t1_keep1', 'targetsub',),
			child('t3_other', 'somewhereelse',), // different sub → filtered out
			child('t1_banned', 'targetsub', {banned_by: 'mod',},), // already removed → skipped
			child('t1_keep2', 'TargetSub',), // case-insensitive match
		],),)

		const progress: {scanned: number; removed: number}[] = []
		await expect(bulkRemoveUserContent('targetsub', 'someuser', {
			isCancelled: () => false,
			onProgress: (p,) => progress.push(p,),
		},),).resolves.toBeUndefined()

		// Exactly the two target-sub, non-banned items were removed. removeThing POSTs
		// to /api/remove with the fullname in the body's `id`.
		const removedIds = apiOauthPOST.mock.calls.map((c,) => (c[1] as {id: string}).id)
		expect(apiOauthPOST.mock.calls.every((c,) => c[0] === '/api/remove'),).toBe(true,)
		expect(removedIds,).toEqual(['t1_keep1', 't1_keep2',],)
		expect(apiOauthPOST,).toHaveBeenCalledTimes(2,)
		expect(progress.at(-1,),).toEqual({scanned: 4, removed: 2,},)
	})

	it('stops scanning when cancelled before the first page', async () => {
		getUserListingPage.mockResolvedValue(page([child('t1_a', 'targetsub',),],),)
		await bulkRemoveUserContent('targetsub', 'someuser', {
			isCancelled: () => true,
			onProgress: () => {},
		},)
		expect(getUserListingPage,).not.toHaveBeenCalled()
		expect(apiOauthPOST,).not.toHaveBeenCalled()
	})
})
