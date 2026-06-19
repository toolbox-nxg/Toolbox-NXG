/** Tests for the removal submission pipeline's usernote write path. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

import type {UserNotesData,} from '../../../util/wiki/schemas/usernotes/schema'
import type {SubmitRemovalParams,} from './submitRemoval'

const postComment = vi.hoisted(() => vi.fn())
const sendModmail = vi.hoisted(() => vi.fn())
const archiveModmail = vi.hoisted(() => vi.fn())
const banUser = vi.hoisted(() => vi.fn())
const flairPost = vi.hoisted(() => vi.fn())
const postLink = vi.hoisted(() => vi.fn())
const removeThing = vi.hoisted(() => vi.fn())
const approveThing = vi.hoisted(() => vi.fn())
const distinguishThing = vi.hoisted(() => vi.fn())
const lock = vi.hoisted(() => vi.fn())
const sendOfficialRemovalMessage = vi.hoisted(() => vi.fn())
const getUserNotes = vi.hoisted(() => vi.fn())
const saveUserNotes = vi.hoisted(() => vi.fn())
const publishSubredditNotes = vi.hoisted(() => vi.fn())

vi.mock('webextension-polyfill', () => ({
	default: {runtime: {getURL: (path: string,) => `chrome-extension://fake/${path}`,},},
}),)

vi.mock('../../../api/resources/comments', () => ({postComment,}),)

vi.mock('../../../api/resources/flair', () => ({flairPost,}),)

vi.mock('../../../api/resources/modmail', () => ({archiveModmail, sendModmail,}),)

vi.mock('../../../api/resources/relationships', () => ({banUser,}),)

vi.mock('../../../api/resources/submissions', () => ({postLink,}),)

vi.mock('../../../api/resources/things', () => ({
	approveThing,
	distinguishThing,
	lock,
	removeThing,
	sendOfficialRemovalMessage,
}),)

vi.mock('../../shared/usernotes/moduleapi', () => ({getUserNotes, saveUserNotes,}),)

vi.mock('../../shared/usernotes/store', () => ({publishSubredditNotes,}),)

import {clearMessageLinks,} from '../../shared/usernotes/messageLinkCache'
import {submitRemoval,} from './submitRemoval'

/** A removed comment: `url` is its permalink, `link` the parent post's external URL shape. */
const commentData = {
	subreddit: 'testsub',
	fullname: 't1_comment',
	id: 'comment',
	author: 'testuser',
	title: '',
	kind: 'comment',
	mod: 'testmod',
	url: 'https://www.reddit.com/r/testsub/comments/post/-/comment/',
	// Comments have no `url` field on the API thing, so postlink/link is empty.
	link: '',
	domain: '',
	body: '> body',
	raw_body: 'body',
	uri_body: 'body',
	uri_title: '',
	subject: 'Removal',
	logReason: '',
	header: '',
	footer: '',
	logSub: '',
	logTitle: '',
	reasons: [],
}

/** Pipeline params for a comment removal leaving a usernote with "include link" checked. */
function makeParams (overrides: Partial<SubmitRemovalParams> = {},): SubmitRemovalParams {
	return {
		data: commentData,
		reasonText: 'You broke rule 1.',
		flairText: '',
		flairCSS: '',
		flairTemplateID: '',
		subject: 'Removal',
		baseLogTitle: '',
		logReasonText: '',
		tokenSource: {},
		reasonType: 'reply',
		reasonSticky: false,
		reasonAsSub: false,
		reasonAutoArchive: false,
		reasonCommentAsSubreddit: false,
		actionLockThread: false,
		actionLockComment: false,
		leaveUsernote: true,
		usernoteText: 'rule 1',
		usernoteType: undefined,
		usernoteIncludeLink: true,
		usernoteIncludeMessage: true,
		subredditColors: [],
		issueBan: false,
		banPermanent: false,
		banDays: 0,
		banNote: '',
		...overrides,
	}
}

/** Returns the single note saved for the removed user, failing the test when absent. */
function savedNote () {
	expect(saveUserNotes,).toHaveBeenCalledOnce()
	const notes = saveUserNotes.mock.calls[0]![1] as UserNotesData
	const note = notes.users[commentData.author]?.notes[0]
	expect(note,).toBeDefined()
	return note!
}

beforeEach(() => {
	vi.clearAllMocks()
	clearMessageLinks()
	removeThing.mockResolvedValue({},)
	postComment.mockResolvedValue({fullname: 't1_reply',},)
	distinguishThing.mockResolvedValue({},)
	sendModmail.mockResolvedValue({conversation: {id: 'convo123', isInternal: false,},},)
	// No existing usernotes page; the pipeline starts from a fresh skeleton.
	getUserNotes.mockRejectedValue(new Error('no_page',),)
	saveUserNotes.mockResolvedValue({},)
},)

describe('submitRemoval usernote write', () => {
	it('links the removed comment\'s own permalink when the reason is sent as a comment reply', async () => {
		const result = await submitRemoval(makeParams(), () => {},)

		expect(result,).toEqual({ok: true,},)
		// Comment removals link the comment's own permalink (`data.url`);
		// `data.link` is empty for comments, so the note must not use it.
		expect(savedNote(),).toMatchObject({note: 'rule 1', link: commentData.url,},)
		expect(savedNote().messageLink,).toBeUndefined()
	})

	it('links the removed item and the modmail conversation when the reason is sent as modmail', async () => {
		const result = await submitRemoval(makeParams({reasonType: 'pm', reasonAsSub: true,},), () => {},)

		expect(result,).toEqual({ok: true,},)
		expect(savedNote(),).toMatchObject({
			link: commentData.url,
			messageLink: 'https://www.reddit.com/mail/perma/convo123',
		},)
	})

	it('omits the link when "include link" is unchecked', async () => {
		const result = await submitRemoval(makeParams({usernoteIncludeLink: false,},), () => {},)

		expect(result,).toEqual({ok: true,},)
		expect(savedNote().link,).toBeUndefined()
	})
})
