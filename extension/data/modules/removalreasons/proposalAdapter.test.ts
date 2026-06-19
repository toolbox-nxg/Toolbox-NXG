/** Tests for the removal-reason capture/replay adapter (curated freeze + thaw). */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage: vi.fn(),},},}),)

const submitRemoval = vi.hoisted(() => vi.fn())
vi.mock('./features/submitRemoval', () => ({submitRemoval,}),)

const getSubredditColors = vi.hoisted(() => vi.fn())
vi.mock('../shared/usernotes/moduleapi', () => ({getSubredditColors,}),)

const getApiThingInfo = vi.hoisted(() => vi.fn())
vi.mock('../../util/reddit/thingInfo', () => ({getApiThingInfo,}),)

import {isInReplay,} from '../../util/infra/captureGuard'
import type {FrozenRemovalIntent, Proposal,} from '../../util/wiki/schemas/proposals/schema'
import type {SubmitRemovalParams,} from './features/submitRemoval'
import {freezeRemovalParams, replayRemovalProposal,} from './proposalAdapter'

/** A full SubmitRemovalParams with everything at its inert default. */
function makeParams (overrides: Partial<SubmitRemovalParams> = {},): SubmitRemovalParams {
	return {
		data: {
			fullname: 't3_abc',
			kind: 'submission',
			subreddit: 'sub',
			author: 'user',
			url: 'https://r/sub/abc',
			link: 'https://r/sub/abc',
			mod: 'mod',
			logSub: '',
		},
		reasonText: 'Removed: rule 1',
		flairText: '',
		flairCSS: '',
		flairTemplateID: '',
		subject: 'subj',
		baseLogTitle: '',
		logReasonText: '',
		reasonType: 'pm',
		reasonSticky: false,
		reasonAsSub: false,
		reasonAutoArchive: false,
		reasonCommentAsSubreddit: false,
		actionLockThread: false,
		actionLockComment: false,
		leaveUsernote: false,
		usernoteText: '',
		usernoteType: undefined,
		usernoteIncludeLink: false,
		usernoteIncludeMessage: false,
		subredditColors: null,
		issueBan: false,
		banPermanent: false,
		banDays: 0,
		banNote: '',
		...overrides,
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	getSubredditColors.mockResolvedValue([],)
	submitRemoval.mockResolvedValue({ok: true,},)
	getApiThingInfo.mockResolvedValue({
		kind: 'submission',
		user: 'targetuser',
		permalink: 'https://reddit.com/r/sub/comments/abc/-/',
		postlink: 'https://reddit.com/r/sub/comments/abc/title/',
	},)
},)

describe('freezeRemovalParams', () => {
	it('omits item metadata and every empty/default field for a bare removal', () => {
		const intent = freezeRemovalParams(makeParams(),)
		// No `data`, no logSub (none configured), no empty flair/usernote/ban/flags.
		expect(Object.keys(intent,).sort(),).toEqual(['reasonText', 'reasonType', 'subject',],)
	})

	it('nests flair / usernote / ban and keeps only true flags when set', () => {
		const intent = freezeRemovalParams(makeParams({
			flairText: 'Removed',
			flairTemplateID: 'tmpl',
			reasonAsSub: true,
			actionLockThread: true,
			leaveUsernote: true,
			usernoteText: '(R8) RP',
			usernoteType: 'warning',
			usernoteIncludeLink: true,
			issueBan: true,
			banDays: 7,
			banNote: 'note',
		},),)
		expect(intent.flair,).toEqual({text: 'Removed', templateId: 'tmpl',},)
		expect(intent.usernote,).toEqual({text: '(R8) RP', type: 'warning', includeLink: true,},)
		expect(intent.ban,).toEqual({permanent: false, days: 7, note: 'note',},)
		expect(intent.reasonAsSub,).toBe(true,)
		expect(intent.actionLockThread,).toBe(true,)
		expect('reasonSticky' in intent,).toBe(false,)
		expect('actionLockComment' in intent,).toBe(false,)
	})

	it('stores log subreddit + title only when a log subreddit is configured', () => {
		const withoutLog = freezeRemovalParams(makeParams({baseLogTitle: 'Removed: x', logReasonText: 'spam',},),)
		expect('logSub' in withoutLog,).toBe(false,)
		expect('baseLogTitle' in withoutLog,).toBe(false,)

		const withLog = freezeRemovalParams(makeParams({
			data: {...makeParams().data, logSub: 'modlog',},
			baseLogTitle: 'Removed: x',
			logReasonText: 'spam',
		},),)
		expect(withLog.logSub,).toBe('modlog',)
		expect(withLog.baseLogTitle,).toBe('Removed: x',)
		expect(withLog.logReasonText,).toBe('spam',)
	})

	it('drops usernote when leaveUsernote is on but the text is blank', () => {
		const intent = freezeRemovalParams(makeParams({leaveUsernote: true, usernoteText: '   ',},),)
		expect('usernote' in intent,).toBe(false,)
	})

	it('keeps the reason title when present and omits it otherwise', () => {
		expect('reasonTitle' in freezeRemovalParams(makeParams(),),).toBe(false,)
		expect(freezeRemovalParams(makeParams({reasonTitle: 'Rule 1',},),).reasonTitle,).toBe('Rule 1',)
	})

	it('records the structured selection when given, and omits it when empty', () => {
		const selection = {reasons: [{id: 'r1', text: 'body', title: 'Rule 1',},], includeHeader: true,}
		expect(freezeRemovalParams(makeParams(), selection,).selection,).toEqual(selection,)
		expect('selection' in freezeRemovalParams(makeParams(), {reasons: [],},),).toBe(false,)
		expect('selection' in freezeRemovalParams(makeParams(),),).toBe(false,)
	})
})

describe('replayRemovalProposal', () => {
	/** A curated intent with only the required fields. */
	function makeIntent (overrides: Partial<FrozenRemovalIntent> = {},): FrozenRemovalIntent {
		return {reasonText: 'Removed: rule 1', reasonType: 'pm', subject: 'subj', ...overrides,}
	}

	/** A removal-reason proposal envelope. */
	function makeProposal (intent: FrozenRemovalIntent,): Proposal {
		return {
			id: 'p1',
			itemId: 't3_abc',
			itemKind: 'post',
			action: {type: 'removal-reason', intent,},
			proposedBy: 'traineeMod',
			proposedAt: 100,
			updatedAt: 100,
			source: 'training',
			status: 'pending',
		}
	}

	it('re-fetches item metadata, attributes the note to the proposer, runs in replay', async () => {
		getSubredditColors.mockResolvedValue([{key: 'warning', color: '#fff', text: 'Warn', action: 'none',},],)
		let replayActive = false
		let received: SubmitRemovalParams | undefined
		submitRemoval.mockImplementation(async (params: SubmitRemovalParams,) => {
			replayActive = isInReplay()
			received = params
			return {ok: true,}
		},)

		const intent = makeIntent({ban: {permanent: false, days: 3, note: 'n',}, reasonAsSub: true,},)
		await replayRemovalProposal('sub', makeProposal(intent,), intent,)

		expect(replayActive,).toBe(true,)
		expect(getApiThingInfo,).toHaveBeenCalledWith('sub', 't3_abc', false,)
		// Item metadata re-fetched; note attributed to the proposer, not the reviewer.
		expect(received!.data,).toMatchObject({
			fullname: 't3_abc',
			subreddit: 'sub',
			author: 'targetuser',
			url: 'https://reddit.com/r/sub/comments/abc/-/',
			mod: 'traineeMod',
		},)
		expect(received!.flairText,).toBe('',) // defaulted
		expect(received!.leaveUsernote,).toBe(false,)
		expect(received!.reasonAsSub,).toBe(true,)
		expect(received!.issueBan,).toBe(true,)
		expect(received!.subredditColors,).toHaveLength(1,)
	})

	it('applies a reviewer reasonText override (accept-with-edit), keeping the rest of the intent', async () => {
		let received: SubmitRemovalParams | undefined
		submitRemoval.mockImplementation(async (params: SubmitRemovalParams,) => {
			received = params
			return {ok: true,}
		},)
		const intent = makeIntent({subject: 'keep me',},)
		await replayRemovalProposal('sub', makeProposal(intent,), intent, {reasonText: 'edited message',},)
		expect(received!.reasonText,).toBe('edited message',)
		// The override only touches the message; other fields still come from the intent.
		expect(received!.subject,).toBe('keep me',)
	})

	it('replays the captured reason text verbatim when no override is given', async () => {
		let received: SubmitRemovalParams | undefined
		submitRemoval.mockImplementation(async (params: SubmitRemovalParams,) => {
			received = params
			return {ok: true,}
		},)
		const intent = makeIntent()
		await replayRemovalProposal('sub', makeProposal(intent,), intent,)
		expect(received!.reasonText,).toBe('Removed: rule 1',)
	})

	it('throws the pipeline error when submitRemoval fails', async () => {
		submitRemoval.mockResolvedValue({ok: false, error: 'modmail failed',},)
		const intent = makeIntent()
		await expect(replayRemovalProposal('sub', makeProposal(intent,), intent,),).rejects.toThrow('modmail failed',)
	})

	it('leaves the replay flag clear after completion', async () => {
		const intent = makeIntent()
		await replayRemovalProposal('sub', makeProposal(intent,), intent,)
		expect(isInReplay(),).toBe(false,)
	})
})
