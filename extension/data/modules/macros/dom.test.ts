/** Tests for the Mod Macros training-mode refusal (mod-action macros are blocked for trainees). */

import type {ReactElement,} from 'react'
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
vi.mock(
	'../../dom/uiLocations',
	() => ({provideLocation: vi.fn(() => vi.fn()), renderAtLocation: vi.fn(() => vi.fn()),}),
)
vi.mock('../../util/reddit/thingInfo', () => ({getApiThingInfo: vi.fn(), getThingInfo: vi.fn(),}),)
vi.mock('../../util/reddit/pageContext', () => ({postSite: '', pageDetails: {},}),)

import {getThingFullname,} from '../../dom/oldReddit/things'
import {renderAtLocation, type UILocationRenderArgs,} from '../../dom/uiLocations'
import {RedditPlatform,} from '../../util/infra/platform'
import {getThingInfo,} from '../../util/reddit/thingInfo'
import {MacroSelect,} from './components/MacroSelect'
import {createMacrosHandlers, editMacro,} from './dom'
import type {MacrosSettings,} from './settings'

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

describe('handleReplyClick on old Reddit (clone cleanup)', () => {
	/**
	 * Builds a comment `.thing` whose reply box already holds a `.toolbox-usertext-buttons`
	 * wrapper containing a stale macro host - the copy Reddit makes when it clones the
	 * top-level reply box for a nested reply. That cloned host was never tracked, so it
	 * must be removed rather than left to accumulate one-per-nesting-level.
	 */
	function buildThing () {
		const thing = document.createElement('div',)
		thing.className = 'thing'
		thing.innerHTML = `
			<div class="entry"><ul class="buttons"><li><a>reply</a></li></ul></div>
			<div class="child">
				<div class="usertext cloneable">
					<div class="usertext-buttons">
						<span class="toolbox-usertext-buttons"><span class="toolbox-top-macro-select">CLONED</span></span>
						<span class="status"></span>
					</div>
				</div>
			</div>
		`
		document.body.appendChild(thing,)
		return thing
	}

	beforeEach(() => {
		document.body.innerHTML = ''
		vi.mocked(getThingInfo,).mockResolvedValue({subreddit: 'sandboxed',} as unknown as ThingInfo,)
		vi.mocked(getThingFullname,).mockReturnValue('t1_comment',)
	},)

	it('removes the cloned untracked host and leaves exactly one macro button', async () => {
		const thing = buildThing()
		const replyLink = thing.querySelector('a',)!
		const handlers = createMacrosHandlers({showMacroPreview: false,} as MacrosSettings,)

		await handlers.handleReplyClick(replyLink,)

		// The cloned host is gone; a single fresh host remains.
		expect(thing.querySelector('.toolbox-top-macro-select',),).toBeNull()
		expect(thing.querySelectorAll('.toolbox-macro-select',),).toHaveLength(1,)
	})

	it('renders only into the host it owns, not other injected hosts', async () => {
		const thing = buildThing()
		const handlers = createMacrosHandlers({showMacroPreview: false,} as MacrosSettings,)

		await handlers.handleReplyClick(thing.querySelector('a',)!,)

		const host = thing.querySelector('.toolbox-macro-select',)!
		const renderFn = vi.mocked(renderAtLocation,).mock.calls.at(-1,)![2]
		const ctx = {
			platform: RedditPlatform.Old,
			kind: 'commentComposer',
			subreddit: 'sandboxed',
			thingId: 't1_comment',
			rawDetail: {type: 'comment', topLevel: false,},
		} as UILocationRenderArgs['context']

		// Renders into its own host, but returns null for any other provider's host -
		// otherwise every live host would show one button per injected host on the page.
		expect(renderFn({context: ctx, target: host,},),).not.toBeNull()
		expect(renderFn({context: ctx, target: document.createElement('span',),},),).toBeNull()
	})
})

describe('Shreddit shared-slot macro renderer', () => {
	/** Grabs the renderer function passed to the (mocked) renderAtLocation when mounting. */
	function getRenderer () {
		const handlers = createMacrosHandlers({showMacroPreview: false,} as MacrosSettings,)
		handlers.mountShredditMacroRenderer()
		const call = vi.mocked(renderAtLocation,).mock.calls.at(-1,)!
		expect(call[0],).toBe('commentComposerControls',)
		return call[2]
	}

	/** Builds a `comment-composer-host` (optionally a reply) wrapping a slot span used as `target`. */
	function composerTarget (attrs: {postId: string; parentId?: string},) {
		const host = document.createElement('comment-composer-host',)
		host.setAttribute('post-id', attrs.postId,)
		if (attrs.parentId) { host.setAttribute('parent-id', attrs.parentId,) }
		const slot = document.createElement('span',)
		host.appendChild(slot,)
		return slot
	}

	const context = (overrides: Partial<UILocationRenderArgs['context']>,): UILocationRenderArgs['context'] => ({
		platform: RedditPlatform.Shreddit,
		kind: 'commentComposer',
		subreddit: 'sandboxed',
		postId: 't3_post',
		...overrides,
	})

	it('renders a comment macro picker targeting the parent comment on a reply composer', () => {
		const render = getRenderer()
		const target = composerTarget({postId: 't3_post', parentId: 't1_parent',},)

		const node = render({context: context({},), target,},) as ReactElement<{type: string; subreddit: string}>

		expect(node,).not.toBeNull()
		expect(node.type,).toBe(MacroSelect,)
		expect(node.props.type,).toBe('comment',)
		expect(node.props.subreddit,).toBe('sandboxed',)
	})

	it('renders a post macro picker on the top-level composer (no parent-id)', () => {
		const render = getRenderer()
		const target = composerTarget({postId: 't3_post',},)

		const node = render({context: context({},), target,},) as ReactElement<{type: string}>

		expect(node.type,).toBe(MacroSelect,)
		expect(node.props.type,).toBe('post',)
	})

	it('renders nothing for a non-Shreddit composer slot', () => {
		const render = getRenderer()
		const target = composerTarget({postId: 't3_post',},)

		expect(render({context: context({platform: RedditPlatform.Old,},), target,},),).toBeNull()
	})
})
