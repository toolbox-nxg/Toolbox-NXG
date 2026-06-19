/** Tests for usernotes store. */

import {afterEach, describe, expect, it, vi,} from 'vitest'

import {getSubredditNotes, publishSubredditNotes, subscribeSubredditNotes,} from './store'
import type {SubredditNoteState,} from './store'

function makeState (note = 'hello',): SubredditNoteState {
	return {
		notes: {
			ver: 6,
			users: {
				alice: {
					name: 'alice',
					notes: [{note, time: 1, mod: 'mod', type: 'spam', link: '',},],
				},
			},
		},
		colors: [{key: 'spam', color: 'red', text: 'Spam',},],
	}
}

afterEach(() => {
	publishSubredditNotes('testsub', makeState('reset',),)
	publishSubredditNotes('othersub', makeState('reset',),)
},)

describe('usernotes store', () => {
	it('returns undefined before notes have been published', () => {
		expect(getSubredditNotes('never-published',),).toBeUndefined()
	})

	it('stores notes per subreddit', () => {
		const testState = makeState('test',)
		const otherState = makeState('other',)

		publishSubredditNotes('testsub', testState,)
		publishSubredditNotes('othersub', otherState,)

		expect(getSubredditNotes('testsub',),).toBe(testState,)
		expect(getSubredditNotes('othersub',),).toBe(otherState,)
	})

	it('notifies only listeners for the published subreddit', () => {
		const testListener = vi.fn()
		const otherListener = vi.fn()
		subscribeSubredditNotes('testsub', testListener,)
		subscribeSubredditNotes('othersub', otherListener,)
		const state = makeState('published',)

		publishSubredditNotes('testsub', state,)

		expect(testListener,).toHaveBeenCalledWith(state,)
		expect(otherListener,).not.toHaveBeenCalled()
	})

	it('stops notifying after unsubscribe', () => {
		const listener = vi.fn()
		const unsubscribe = subscribeSubredditNotes('testsub', listener,)

		unsubscribe()
		publishSubredditNotes('testsub', makeState('published',),)

		expect(listener,).not.toHaveBeenCalled()
	})
})
