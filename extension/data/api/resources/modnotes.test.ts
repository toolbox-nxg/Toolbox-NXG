/** Tests for modnotes API. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const apiOauthGetJSON = vi.hoisted(() => vi.fn())
const apiOauthPOST = vi.hoisted(() => vi.fn())
const apiOauthDELETE = vi.hoisted(() => vi.fn())

vi.mock('../transport/http', () => ({apiOauthGetJSON, apiOauthPOST, apiOauthDELETE,}),)

import {createModNote, deleteModNote, getAllModNotes, getModNotes, getRecentModNotes,} from './modnotes'

beforeEach(() => {
	apiOauthGetJSON.mockReset()
	apiOauthPOST.mockReset().mockResolvedValue(new Response('',),)
	apiOauthDELETE.mockReset().mockResolvedValue(new Response('',),)
},)

describe('modnotes API', () => {
	it('fetches a page of mod notes and maps cursor metadata', async () => {
		apiOauthGetJSON.mockResolvedValue({
			mod_notes: [{id: 'note1',},],
			start_cursor: 'start',
			end_cursor: 'end',
			has_next_page: true,
		},)

		await expect(getModNotes({subreddit: 'testsub', user: 'alice', filter: 'NOTE', before: 'cursor',},),)
			.resolves.toEqual({
				notes: [{id: 'note1',},],
				startCursor: 'start',
				endCursor: 'end',
				hasNextPage: true,
			},)
		expect(apiOauthGetJSON,).toHaveBeenCalledWith('/api/mod/notes', {
			subreddit: 'testsub',
			user: 'alice',
			filter: 'NOTE',
			before: 'cursor',
			limit: '100',
		},)
	})

	it('fetches recent mod notes for paired subreddit/user lists', async () => {
		apiOauthGetJSON.mockResolvedValue({mod_notes: [{id: 'a',}, null,],},)

		await expect(getRecentModNotes(['sub1', 'sub2',], ['alice', 'bob',],),).resolves.toEqual([{id: 'a',}, null,],)
		expect(apiOauthGetJSON,).toHaveBeenCalledWith('/api/mod/notes/recent', {
			subreddits: 'sub1,sub2',
			users: 'alice,bob',
		},)
	})

	it('creates and deletes mod notes with expected payloads', async () => {
		await createModNote({
			subreddit: 'testsub',
			user: 'alice',
			note: 'note',
			label: 'SPAM_WARNING',
			redditID: 't3_post',
		},)
		await deleteModNote({subreddit: 'testsub', user: 'alice', id: 'note_id',},)

		expect(apiOauthPOST,).toHaveBeenCalledWith('/api/mod/notes', {
			subreddit: 'testsub',
			user: 'alice',
			note: 'note',
			label: 'SPAM_WARNING',
			reddit_id: 't3_post',
		},)
		expect(apiOauthDELETE,).toHaveBeenCalledWith('/api/mod/notes', {
			subreddit: 'testsub',
			user: 'alice',
			note_id: 'note_id',
		},)
	})

	it('iterates all mod note pages lazily', async () => {
		apiOauthGetJSON
			.mockResolvedValueOnce({
				mod_notes: [{id: 'first',},],
				end_cursor: 'cursor',
				has_next_page: true,
			},)
			.mockResolvedValueOnce({
				mod_notes: [{id: 'second',},],
				end_cursor: '',
				has_next_page: false,
			},)

		const notes = []
		for await (const note of getAllModNotes('testsub', 'alice', 'NOTE',)) {
			notes.push(note,)
		}

		expect(notes,).toEqual([{id: 'first',}, {id: 'second',},],)
		expect(apiOauthGetJSON.mock.calls[1]![1],).toMatchObject({before: 'cursor',},)
	})
})
