/** Tests for modnotes helpers. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const getInfo = vi.hoisted(() => vi.fn())

vi.mock('../../../api/resources/things', () => ({getInfo,}),)
vi.mock('../../../util/reddit/pageContext', () => ({link: (path: string,) => `/linked${path}`,}),)

import {getContextURL, getSubmissionFullname,} from './helpers'
import type {ModNote,} from './schema'

beforeEach(() => {
	getInfo.mockReset().mockResolvedValue({data: {link_id: 't3_post',},},)
},)

describe('modnotes helpers', () => {
	it('fetches and caches the submission fullname for a comment', async () => {
		await expect(getSubmissionFullname('t1_comment',),).resolves.toBe('t3_post',)
		await expect(getSubmissionFullname('t1_comment',),).resolves.toBe('t3_post',)

		expect(getInfo,).toHaveBeenCalledOnce()
		expect(getInfo,).toHaveBeenCalledWith('t1_comment',)
	})

	it('returns context URLs for submission notes', async () => {
		const note = {
			user_note_data: {reddit_id: 't3_post',},
		} as ModNote

		await expect(getContextURL(note,),).resolves.toBe('/linked/comments/post',)
	})

	it('returns context URLs for comment notes using the parent submission', async () => {
		const note = {
			user_note_data: {reddit_id: 't1_comment',},
		} as ModNote

		await expect(getContextURL(note,),).resolves.toBe('/linked/comments/post/_/comment',)
	})

	it('falls back to mod action reddit ids', async () => {
		const note = {
			mod_action_data: {reddit_id: 't3_post',},
		} as ModNote

		await expect(getContextURL(note,),).resolves.toBe('/linked/comments/post',)
	})

	it('returns null when no supported reddit id is present', async () => {
		await expect(getContextURL({} as ModNote,),).resolves.toBeNull()
		await expect(getContextURL({user_note_data: {reddit_id: 't5_subreddit',},} as ModNote,),).resolves.toBeNull()
	})
})
