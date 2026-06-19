/** Tests for the Mod Macros training-mode refusal (mod-action macros are blocked for trainees). */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

import type {MacroConfig, ThingInfo,} from './schema'

// editMacro defers its real work to the popup's onPost callback; capture it so the test can
// invoke "submit" directly without driving the popup UI.
let capturedOnPost: ((comment: string,) => Promise<boolean>) | undefined
const showMacroEditPopup = vi.hoisted(() => vi.fn())

const isTrainingCaptureActive = vi.hoisted(() => vi.fn(() => Promise.resolve(false,)))
const removeThing = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const approveThing = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const distinguishThing = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const lock = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const banUser = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const postComment = vi.hoisted(() => vi.fn(() => Promise.resolve({fullname: 't1_reply',},)))
const negativeTextFeedback = vi.hoisted(() => vi.fn())
const positiveTextFeedback = vi.hoisted(() => vi.fn())

vi.mock('./components/MacroEditPopup', () => ({showMacroEditPopup,}),)
vi.mock('./components/MacroSelect', () => ({MacroSelect: () => null,}),)
vi.mock('../shared/proposals/gateway', () => ({isTrainingCaptureActive,}),)
vi.mock('../../api/resources/things', () => ({
	approveThing,
	distinguishThing,
	lock,
	removeThing,
	sendOfficialRemovalMessage: vi.fn(() => Promise.resolve()),
}),)
vi.mock('../../api/resources/relationships', () => ({
	banUser,
	muteUser: vi.fn(() => Promise.resolve()),
	unbanUser: vi.fn(() => Promise.resolve()),
}),)
vi.mock('../../api/resources/flair', () => ({flairUser: vi.fn(() => Promise.resolve()),}),)
vi.mock('../../api/resources/comments', () => ({postComment,}),)
vi.mock('../../api/resources/modSubs', () => ({getModSubs: vi.fn(), isModSub: vi.fn(),}),)
vi.mock('../../store/feedback', () => ({negativeTextFeedback, positiveTextFeedback,}),)
vi.mock('../notifier/store', () => ({requestCounterRefresh: vi.fn(),}),)
vi.mock('../../dom/oldReddit/page', () => ({getSiteTable: vi.fn(),}),)
vi.mock('../../dom/oldReddit/things', () => ({getThingFullname: vi.fn(), getThings: vi.fn(),}),)
vi.mock('../../dom/shreddit/commentThread', () => ({
	findInlineReplyComposerTargets: vi.fn(() => []),
	findTopLevelComposerHosts: vi.fn(() => []),
}),)
vi.mock(
	'../../dom/uiLocations',
	() => ({provideLocation: vi.fn(() => vi.fn()), renderAtLocation: vi.fn(() => vi.fn()),}),
)
vi.mock('../../util/reddit/thingInfo', () => ({getApiThingInfo: vi.fn(), getThingInfo: vi.fn(),}),)
vi.mock('../../util/reddit/pageContext', () => ({postSite: '', pageDetails: {},}),)

import {editMacro,} from './dom'

/** Builds a minimal ThingInfo for a target post in `subreddit`. */
function thingInfo (subreddit: string,): ThingInfo {
	return {
		subreddit,
		author: 'targetuser',
		fullname: 't3_target',
		permalink: `/r/${subreddit}/comments/target/`,
		kind: 'submission',
	} as unknown as ThingInfo
}

/** Drives editMacro and returns the onPost the popup was opened with. */
async function openMacro (macro: Partial<MacroConfig>, subreddit = 'sandboxed',) {
	capturedOnPost = undefined
	showMacroEditPopup.mockImplementation((args: {onPost: (c: string,) => Promise<boolean>},) => {
		capturedOnPost = args.onPost
	},)
	await editMacro(
		document.createElement('div',),
		thingInfo(subreddit,),
		{text: 'hi', ...macro,} as MacroConfig,
		true,
		false,
		vi.fn(),
	)
	return capturedOnPost!
}

beforeEach(() => {
	vi.clearAllMocks()
	isTrainingCaptureActive.mockResolvedValue(false,)
},)

describe('macro training-mode refusal', () => {
	it('refuses a mod-action macro for a trainee and performs no actions', async () => {
		isTrainingCaptureActive.mockResolvedValue(true,)
		const onPost = await openMacro({remove: true, distinguish: false,},)

		const shouldClose = await onPost('reply text',)

		expect(shouldClose,).toBe(false,)
		expect(isTrainingCaptureActive,).toHaveBeenCalledWith('sandboxed',)
		expect(negativeTextFeedback,).toHaveBeenCalled()
		// Neither the reply nor the moderation action may fire.
		expect(postComment,).not.toHaveBeenCalled()
		expect(removeThing,).not.toHaveBeenCalled()
	})

	it('refuses a ban macro for a trainee instead of silently swallowing the ban', async () => {
		isTrainingCaptureActive.mockResolvedValue(true,)
		const onPost = await openMacro({ban: true, distinguish: false,},)

		await onPost('reply text',)

		expect(banUser,).not.toHaveBeenCalled()
		expect(negativeTextFeedback,).toHaveBeenCalled()
	})

	it('allows a reply-only macro in training mode (the trainee\'s own voice)', async () => {
		isTrainingCaptureActive.mockResolvedValue(true,)
		const onPost = await openMacro({distinguish: false,},)

		const shouldClose = await onPost('reply text',)

		expect(shouldClose,).toBe(true,)
		expect(postComment,).toHaveBeenCalled()
		expect(isTrainingCaptureActive,).not.toHaveBeenCalled()
	})

	it('still locks and distinguishes the trainee\'s own reply in training mode', async () => {
		isTrainingCaptureActive.mockResolvedValue(true,)
		// distinguish/lockreply only style/close the trainee's own just-posted reply, so they
		// stay allowed in training mode (run through the guard's authorized window) rather than
		// being refused like mod actions against the target.
		const onPost = await openMacro({distinguish: true, lockreply: true,},)

		const shouldClose = await onPost('reply text',)

		expect(shouldClose,).toBe(true,)
		expect(postComment,).toHaveBeenCalled()
		expect(distinguishThing,).toHaveBeenCalledWith('t1_reply', false,)
		expect(lock,).toHaveBeenCalledWith('t1_reply',)
		expect(negativeTextFeedback,).not.toHaveBeenCalled()
		// A reply-only macro never consults the refusal check.
		expect(isTrainingCaptureActive,).not.toHaveBeenCalled()
	})

	it('performs the mod action normally when capture is not active', async () => {
		const onPost = await openMacro({remove: true, distinguish: false,},)

		await onPost('reply text',)

		expect(postComment,).toHaveBeenCalled()
		expect(removeThing,).toHaveBeenCalledWith('t3_target',)
		expect(negativeTextFeedback,).not.toHaveBeenCalled()
	})
})
