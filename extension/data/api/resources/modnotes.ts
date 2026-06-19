/** API functions for Reddit's native Mod Notes feature. */

import type {ModNote,} from '../../modules/shared/modnotes/schema'
import {apiOauthDELETE, apiOauthGetJSON, apiOauthPOST,} from '../transport/http'

/**
 * Retrieves one page of a user's mod notes within a subreddit.
 * @param options Query options.
 * @param subreddit Subreddit to query.
 * @param user User whose notes to fetch.
 * @param filter Optional note-type filter (commonly `NOTE` or `MOD_ACTION`).
 * @param before Cursor from a prior call, used to page further back in history.
 * @returns Resolves with the page of note objects, or rejects on error.
 */
export const getModNotes = ({subreddit, user, filter, before,}: {
	subreddit: string
	user: string
	filter?: string | undefined
	before?: string | undefined
},) =>
	apiOauthGetJSON('/api/mod/notes', {
		subreddit,
		user,
		filter,
		before,
		limit: '100',
	},).then((response,) => ({
		notes: (response.mod_notes ?? []) as ModNote[],
		startCursor: (response.start_cursor ?? '') as string,
		endCursor: (response.end_cursor ?? '') as string,
		hasNextPage: (response.has_next_page ?? false) as boolean,
	}))

/**
 * Looks up the single most recent mod note for each (user, subreddit) pairing.
 * @param subreddits Subreddit names, positionally paired with `users`.
 * @param users User names, positionally paired with `subreddits`.
 * @returns Resolves with one note per index, or `null` at that index where the
 * paired user has no note in the paired subreddit.
 */
export const getRecentModNotes = (subreddits: string[], users: string[],) =>
	apiOauthGetJSON('/api/mod/notes/recent', {
		subreddits: subreddits.join(',',),
		users: users.join(',',),
	},).then((response,) => response.mod_notes as (ModNote | null)[])

/**
 * Adds a new mod note to a user in a subreddit.
 * @param options Note details.
 * @param subreddit Subreddit the note belongs to.
 * @param user User the note is attached to.
 * @param note The text of the note to add
 * @param label One of Reddit's supported note labels
 * @param redditID Fullname of an associated post or comment
 */
export const createModNote = ({
	subreddit,
	user,
	note,
	label,
	redditID,
}: {
	subreddit: string
	user: string
	note: string
	label?: string | undefined
	redditID?: string | undefined
},) =>
	apiOauthPOST('/api/mod/notes', {
		subreddit,
		user,
		note,
		label,
		reddit_id: redditID,
	},)

/**
 * Removes an existing mod note from a user in a subreddit.
 * @param options Deletion options.
 * @param subreddit Subreddit the note belongs to.
 * @param user User the note is attached to.
 * @param id Identifier of the note to delete.
 */
export const deleteModNote = ({subreddit, user, id,}: {
	subreddit: string
	user: string
	id: string
},) =>
	apiOauthDELETE('/api/mod/notes', {
		subreddit,
		user,
		note_id: id,
	},)

/**
 * Returns an async generator that lazily walks every mod note matching a filter
 * for a user in a subreddit, paging through the history as it is consumed.
 * @param subreddit Subreddit to query.
 * @param user User whose notes to fetch.
 * @param filter Optional note-type filter (e.g. `NOTE`, `MOD_ACTION`).
 */
// Uses a manual cursor loop rather than fetchAllListingPages because mod notes
// use a `before` cursor (not `after`), paginate backwards, and are consumed
// lazily as a generator - a fundamentally different shape from listing endpoints.
export async function* getAllModNotes (subreddit: string, user: string, filter?: string,): AsyncGenerator<ModNote> {
	let before: string | undefined = undefined
	while (true) {
		const {notes, endCursor, hasNextPage,} = await getModNotes({
			subreddit,
			user,
			filter,
			before,
		},)
		for (const note of notes) {
			yield note
		}
		if (!hasNextPage) {
			return
		}
		before = endCursor
	}
}
