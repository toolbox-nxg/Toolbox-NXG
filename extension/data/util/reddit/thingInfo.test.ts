/** Tests for getThingInfo. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const getCurrentUser = vi.hoisted(() => vi.fn())
const getApiThingInfoById = vi.hoisted(() => vi.fn())
const getModSubs = vi.hoisted(() => vi.fn())
const isModSub = vi.hoisted(() => vi.fn())

vi.mock('../../api/resources/me', () => ({getCurrentUser,}),)
vi.mock('../../api/resources/things', () => ({getThingInfo: getApiThingInfoById,}),)
vi.mock('../../api/resources/modSubs', () => ({getModSubs, isModSub,}),)
vi.mock('./pageContext', () => ({
	baseDomain: 'https://old.reddit.com',
	link: (path: string,) => path,
}),)

import {getApiThingInfo, getThingInfo,} from './thingInfo'

beforeEach(() => {
	document.body.innerHTML = ''
	getCurrentUser.mockReset().mockResolvedValue('current_mod',)
	getApiThingInfoById.mockReset()
	getModSubs.mockReset().mockResolvedValue(['testsub',],)
	isModSub.mockReset().mockResolvedValue(true,)
},)

describe('getThingInfo', () => {
	it('returns null for a missing sender', async () => {
		await expect(getThingInfo(null,),).resolves.toBeNull()
	})

	it('builds submission info from toolbox DOM attributes', async () => {
		document.body.innerHTML = `
            <div
                class="toolbox-thing"
                data-subreddit="/r/testsub/"
                data-fullname="t3_post"
                data-post-id="t3_post"
                data-submission-author="alice"
                data-thread-permalink="https://old.reddit.com/r/testsub/comments/post/title/"
            >
                <button class="target"></button>
            </div>
        `

		await expect(getThingInfo(document.querySelector('.target',),),).resolves.toMatchObject({
			subreddit: 'testsub',
			user: 'alice',
			author: 'alice',
			fullname: 't3_post',
			id: 'post',
			kind: 'submission',
			mod: 'current_mod',
			rules: '/r/testsub/about/rules',
			sidebar: '/r/testsub/about/sidebar',
			wiki: '/r/testsub/wiki/index',
		},)
	})

	it('builds comment info from the comment fullname', async () => {
		document.body.innerHTML = `
            <div
                class="toolbox-thing toolbox-comment"
                data-subreddit="testsub"
                data-fullname="t1_comment"
                data-comment-id="t1_comment"
                data-comment-author="bob"
                data-thread-permalink="https://old.reddit.com/r/testsub/comments/post/title/comment/"
            ></div>
        `

		await expect(getThingInfo(document.querySelector('.toolbox-comment',),),).resolves.toMatchObject({
			subreddit: 'testsub',
			user: 'bob',
			fullname: 't1_comment',
			id: 'comment',
			kind: 'comment',
		},)
	})

	it('returns null for mod-checked DOM things outside moderated subreddits', async () => {
		getModSubs.mockResolvedValue(['othersub',],)
		document.body.innerHTML = '<div class="toolbox-thing" data-subreddit="testsub" data-post-id="t3_post"></div>'

		await expect(getThingInfo(document.querySelector('.toolbox-thing',), true,),).resolves.toBeNull()
	})
})

describe('getApiThingInfo', () => {
	it('maps API submission data into toolbox thing info', async () => {
		getApiThingInfoById.mockResolvedValue({
			data: {
				children: [{
					kind: 't3',
					data: {
						author: 'alice',
						selftext: 'body text',
						permalink: '/r/testsub/comments/post/title/',
						title: 'Post title',
						url: 'https://example.com',
						domain: 'example.com',
						approved_by: 'mod',
						banned_by: '',
						spam: false,
						removed: false,
						user_reports: [['report', 1,],],
						mod_reports: [],
						ignore_reports: false,
					},
				},],
			},
		},)

		await expect(getApiThingInfo('/r/testsub/', 't3_post', true,),).resolves.toMatchObject({
			subreddit: 'testsub',
			user: 'alice',
			author: 'alice',
			permalink: 'https://old.reddit.com/r/testsub/comments/post/-/',
			domain: 'example.com',
			fullname: 't3_post',
			id: 'post',
			body: '> body text',
			raw_body: 'body text',
			title: 'Post title',
			kind: 'submission',
			postlink: 'https://example.com',
			mod: 'current_mod',
			userReports: [['report', 1,],],
		},)
		expect(getApiThingInfoById,).toHaveBeenCalledWith('/r/testsub/', 't3_post',)
	})

	it('normalizes deleted users and comment permalinks from API data', async () => {
		getApiThingInfoById.mockResolvedValue({
			data: {
				children: [{
					kind: 't1',
					data: {
						author: '[deleted]',
						body: 'comment body',
						permalink: '/r/testsub/comments/post/title/comment/',
						title: '',
						url: '',
					},
				},],
			},
		},)

		await expect(getApiThingInfo('testsub', 't1_comment',),).resolves.toMatchObject({
			user: '',
			permalink: 'https://old.reddit.com/r/testsub/comments/post/-/comment/',
			kind: 'comment',
			body: '> comment body',
		},)
	})

	it('hides subreddit links when modCheck fails', async () => {
		isModSub.mockResolvedValue(false,)
		getApiThingInfoById.mockResolvedValue({
			data: {
				children: [{
					kind: 't3',
					data: {
						author: 'alice',
						selftext: '',
						permalink: '/r/testsub/comments/post/title/',
						title: 'Title',
						url: '',
					},
				},],
			},
		},)

		await expect(getApiThingInfo('testsub', 't3_post', true,),).resolves.toMatchObject({
			subreddit: '',
			rules: '',
			sidebar: '',
			wiki: '',
		},)
	})
})
