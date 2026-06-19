/** Tests for the runtime capture-suppression guard (training-mode fail-closed backstop). */

// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it,} from 'vitest'

import {
	assertActionAllowed,
	CaptureSuppressedError,
	isCaptureActiveFor,
	registerItemSubreddit,
	runInReplay,
	setCaptureActivePredicate,
	setCaptureAnywherePredicate,
	setCaptureExpected,
	setPageSubreddit,
	unregisterItemSubreddit,
} from './captureGuard'

/** Restores all guard state to its inert defaults. */
function resetGuard () {
	setCaptureActivePredicate(() => false)
	setCaptureAnywherePredicate(() => false)
	setCaptureExpected(false,)
	setPageSubreddit(undefined,)
	unregisterItemSubreddit('t3_x',)
}

beforeEach(resetGuard,)
afterEach(resetGuard,)

describe('assertActionAllowed', () => {
	it('does nothing when no capture context is active', () => {
		expect(() => assertActionAllowed('removeThing', {fullname: 't3_x',},)).not.toThrow()
	})

	it('blocks an action whose subreddit (via the item map) is capture-active', () => {
		setCaptureActivePredicate((sub,) => sub === 'sandboxed')
		registerItemSubreddit('sandboxed', 't3_x',)
		expect(() => assertActionAllowed('removeThing', {fullname: 't3_x',},)).toThrow(CaptureSuppressedError,)
	})

	it('resolves the subreddit from the page fallback when the item is unregistered', () => {
		setCaptureActivePredicate((sub,) => sub === 'sandboxed')
		setPageSubreddit('sandboxed',)
		expect(() => assertActionAllowed('removeThing', {fullname: 't3_unknown',},)).toThrow(CaptureSuppressedError,)
	})

	it('uses an explicit subreddit when provided', () => {
		setCaptureActivePredicate((sub,) => sub === 'sandboxed')
		expect(() => assertActionAllowed('banUser', {subreddit: 'sandboxed',},)).toThrow(CaptureSuppressedError,)
		expect(() => assertActionAllowed('banUser', {subreddit: 'other',},)).not.toThrow()
	})

	it('allows an unresolved-subreddit action for a user sandboxed nowhere', () => {
		setCaptureActivePredicate(() => true) // active for any *resolved* sub...
		// ...but the user is sandboxed nowhere, and the sub is unknown ⇒ never block.
		setCaptureAnywherePredicate(() => false)
		expect(() => assertActionAllowed('removeThing', {fullname: 't3_unknown',},)).not.toThrow()
	})

	it('fails closed on an unresolved subreddit when the user is sandboxed somewhere', () => {
		// No item mapping, no page subreddit ⇒ sub unknown; but the user is a trainee
		// somewhere, so we can't prove the action is outside their sandbox.
		setCaptureAnywherePredicate(() => true)
		expect(() => assertActionAllowed('removeThing', {fullname: 't3_unknown',},)).toThrow(CaptureSuppressedError,)
	})

	it('still uses the per-subreddit check when the subreddit resolves, ignoring the anywhere flag', () => {
		setCaptureActivePredicate((sub,) => sub === 'sandboxed')
		setCaptureAnywherePredicate(() => true)
		registerItemSubreddit('other', 't3_x',)
		// Resolves to a non-sandboxed sub, so it's allowed even though sandboxed elsewhere.
		expect(() => assertActionAllowed('removeThing', {fullname: 't3_x',},)).not.toThrow()
	})

	it('permits actions inside an authorized replay even when capture is active', async () => {
		setCaptureActivePredicate(() => true)
		setPageSubreddit('sandboxed',)
		let threw = false
		await runInReplay(async () => {
			try {
				assertActionAllowed('removeThing', {fullname: 't3_x',},)
			} catch {
				threw = true
			}
		},)
		expect(threw,).toBe(false,)
	})

	it('test tripwire: captureExpected blocks any action, replay still permits', async () => {
		setCaptureExpected(true,)
		expect(() => assertActionAllowed('removeThing', {fullname: 't3_x',},)).toThrow(CaptureSuppressedError,)
		await runInReplay(async () => {
			expect(() => assertActionAllowed('removeThing', {fullname: 't3_x',},)).not.toThrow()
		},)
	})
})

describe('isCaptureActiveFor', () => {
	it('reflects the installed predicate and fails open if it throws', () => {
		setCaptureActivePredicate((sub,) => sub === 'a')
		expect(isCaptureActiveFor('a',),).toBe(true,)
		expect(isCaptureActiveFor('b',),).toBe(false,)
		setCaptureActivePredicate(() => {
			throw new Error('boom',)
		},)
		expect(isCaptureActiveFor('a',),).toBe(false,)
	})
})

describe('runInReplay', () => {
	it('restores the replay flag even when the body throws', async () => {
		setCaptureExpected(true,)
		await expect(runInReplay(async () => {
			throw new Error('fail',)
		},),).rejects.toThrow('fail',)
		// After the failed replay, the tripwire is active again.
		expect(() => assertActionAllowed('removeThing', {fullname: 't3_x',},)).toThrow(CaptureSuppressedError,)
	})
})
