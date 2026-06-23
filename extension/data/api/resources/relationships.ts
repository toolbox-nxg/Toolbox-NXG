/** API functions for managing subreddit relationships: bans, mutes, contributors, and moderators. */

import {assertActionAllowed,} from '../../util/infra/captureGuard'
import {postRedditApiVoid,} from '../parsers/redditMutation'
import {apiOauthGetJSON,} from '../transport/http'
import {getSubredditListing,} from './subreddits'

/** Reddit API character limit for ban/mute notes. */
const MAX_NOTE_LENGTH = 300
/** Reddit API character limit for ban messages. */
const MAX_BAN_MESSAGE_LENGTH = 999
/** Reddit API maximum ban duration in days. */
const MAX_BAN_DURATION = 999

/** Finds an entry in a list by case-insensitive name match. */
function findByName<T extends {name: string},> (list: T[], user: string,): T | undefined {
	const lower = user.toLowerCase()
	return list.find((item,) => item.name.toLowerCase() === lower)
}

/** Details of a single subreddit ban. */
export interface BanState {
	/** The banned user's name */
	name: string
	/** The banned user's ID fullname */
	id: string
	/** The mod-visible ban note */
	note: string
	/** The date the ban was issued, in unix epoch seconds */
	date: number
	/**
	 * If the ban is temporary, the number of days until it expires, otherwise
	 * `null`
	 */
	days_left: number | null
}

/**
 * Looks up whether and how a user is banned from a subreddit.
 * @param subreddit Subreddit to check.
 * @param user User to check.
 * @returns Resolves with a ban-description object, or `undefined` when the user
 * isn't banned.
 */
export const getBanState = async (subreddit: string, user: string,) => {
	const data = await apiOauthGetJSON<{data?: {children?: BanState[]}}>(`/r/${subreddit}/about/banned/.json`, {user,},)
	const children = data?.data?.children
	if (!Array.isArray(children,)) { return undefined }
	const bans = children.filter((c,): c is BanState => typeof c?.name === 'string')
	return findByName(bans, user,)
}

/**
 * Bans a user from a subreddit.
 * Rejects with `RedditApiError` if Reddit returns API-level errors.
 */
export const banUser = async ({
	user,
	subreddit,
	note = '',
	banMessage = '',
	banDuration = 0,
	banContext = '',
}: {
	user: string
	subreddit: string
	note?: string
	banMessage?: string
	banDuration?: number
	banContext?: string
},) => {
	assertActionAllowed('banUser', {subreddit,},)
	return postRedditApiVoid('/api/friend', {
		api_type: 'json',
		type: 'banned',
		name: user,
		r: subreddit,
		note: note.substring(0, MAX_NOTE_LENGTH,),
		ban_message: banMessage.substring(0, MAX_BAN_MESSAGE_LENGTH,),
		duration: banDuration ? String(Math.max(0, Math.min(banDuration, MAX_BAN_DURATION,),),) : undefined,
		ban_context: banContext || undefined,
	},)
}

/**
 * Creates a simple (subreddit, user) -> void relationship action that POSTs to
 * `/api/friend` or `/api/unfriend` with a fixed `type`. Every relationship action is
 * a real moderation action, so `guardName` is required: the action is gated by the
 * training-mode capture guard, which blocks it for a sandboxed trainee. (Requiring
 * it - rather than an optional opt-in - means a new relationship action can't
 * silently skip the guard and leak a real action.)
 */
const makeRelationshipAction =
	(endpoint: '/api/friend' | '/api/unfriend', type: string, guardName: string,) =>
	(subreddit: string, user: string,) => {
		assertActionAllowed(guardName, {subreddit,},)
		return postRedditApiVoid(endpoint, {api_type: 'json', type, name: user, r: subreddit,},)
	}

/** Unbans a user from a subreddit. */
export const unbanUser = makeRelationshipAction('/api/unfriend', 'banned', 'unbanUser',)

/** Adds a user as an approved contributor to a subreddit. */
export const addContributor = makeRelationshipAction('/api/friend', 'contributor', 'addContributor',)

/** Removes a user as an approved contributor from a subreddit. */
export const removeContributor = makeRelationshipAction('/api/unfriend', 'contributor', 'removeContributor',)

/** Invites a user to become a moderator of a subreddit. */
export const addModerator = makeRelationshipAction('/api/friend', 'moderator', 'addModerator',)

/** Removes a user's moderator status from a subreddit. */
export const removeModerator = makeRelationshipAction('/api/unfriend', 'moderator', 'removeModerator',)

/**
 * Mutes a user from a subreddit's modmail.
 * @param duration Mute duration in days (3, 7, or 28)
 */
export const muteUser = async ({
	user,
	subreddit,
	note = '',
	duration,
}: {
	user: string
	subreddit: string
	note?: string
	duration?: number
},) => {
	assertActionAllowed('muteUser', {subreddit,},)
	return postRedditApiVoid('/api/friend', {
		api_type: 'json',
		type: 'muted',
		name: user,
		r: subreddit,
		note: note.substring(0, MAX_NOTE_LENGTH,),
		duration: duration ? String(duration,) : undefined,
	},)
}

/** Unmutes a user from a subreddit's modmail. */
export const unmuteUser = makeRelationshipAction('/api/unfriend', 'muted', 'unmuteUser',)

/**
 * Fetches a subreddit about-listing page and returns the entry whose `name` matches
 * `user` (case-insensitive), or `undefined` if the user is not in the listing.
 */
async function findUserInSubredditListing<T extends {name: string},> (
	subreddit: string,
	page: string,
	user: string,
): Promise<T | undefined> {
	const data = await getSubredditListing(subreddit, page, {user,},)
	const children = data?.data?.children
	if (!Array.isArray(children,)) { return undefined }
	return findByName(children as T[], user,)
}

/**
 * Gets the contributor (approved submitter) state of a user in a subreddit.
 * @returns The contributor entry if the user is a contributor, or `undefined` if not
 */
export const getContributorState = (subreddit: string, user: string,) =>
	findUserInSubredditListing<{name: string}>(subreddit, 'contributors', user,)

/** Result of querying the moderator list for a subreddit. */
export interface ModeratorListResult {
	/** Whether the target user is a moderator of the subreddit */
	targetIsMod: boolean
	/**
	 * The current user's mod permissions on the subreddit.
	 * May be `['all']` for full permissions, or a subset of
	 * `['access', 'chat_config', 'chat_operator', 'config', 'flair', 'mail', 'posts', 'wiki']`.
	 * Empty if the current user is not a moderator.
	 */
	currentUserPermissions: string[]
}

/**
 * Fetches the moderator list for a subreddit and returns:
 * - whether `targetUser` is a moderator
 * - the `currentUser`'s mod permissions (for action-gating in the UI)
 */
export const getModeratorListResult = async (
	subreddit: string,
	targetUser: string,
	currentUser: string,
): Promise<ModeratorListResult> => {
	const data = await getSubredditListing<{name: string; mod_permissions: string[]}>(subreddit, 'moderators',)
	const children = data?.data?.children
	const mods = Array.isArray(children,) ? children : []
	const targetIsMod = findByName(mods, targetUser,) !== undefined
	const currentEntry = findByName(mods, currentUser,)
	const currentUserPermissions = currentEntry?.mod_permissions ?? []
	return {targetIsMod, currentUserPermissions,}
}

/**
 * Gets the mute state of a user in a subreddit's modmail.
 * @returns The mute entry if the user is muted, or `undefined` if not
 */
export const getMuteState = (subreddit: string, user: string,) =>
	findUserInSubredditListing<{name: string}>(subreddit, 'muted', user,)
