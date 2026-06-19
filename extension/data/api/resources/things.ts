/** API functions for moderation actions on Reddit posts and comments (things). */

import {createDeferredProcessQueue,} from '../../util/data/async'
import {assertActionAllowed,} from '../../util/infra/captureGuard'
import {parseRedditApiResponse, postRedditApiVoid,} from '../parsers/redditMutation'
import {apiOauthGetJSON, apiOauthPOST,} from '../transport/http'

/**
 * A Reddit API thing (post, comment, subreddit, etc.) as returned by listing endpoints.
 * The generic parameter `T` narrows the `data` shape when the caller knows the type;
 * it defaults to `Record<string, unknown>` for untyped contexts.
 */
export interface RedditThing<T extends Record<string, unknown> = Record<string, unknown>,> {
	kind: string
	data: T
}

/** Fetches information in bulk about API items. */
export const getInfoBulk = async <T extends Record<string, unknown> = Record<string, unknown>,>(
	fullnames: string[],
): Promise<RedditThing<T>[]> => {
	if (!fullnames.length) { return [] }
	const result = await apiOauthGetJSON('/api/info.json', {raw_json: '1', id: fullnames.join(',',),},)
	const children = result?.data?.children
	if (!Array.isArray(children,)) { return [] }
	return children as RedditThing<T>[]
}

const _getInfoQueue = createDeferredProcessQueue(
	// {name: string} generic ensures thing.data.name is type-safe without a cast.
	// /api/info.json always returns things with a fullname in data.name.
	(fullnames: string[],) => getInfoBulk<{name: string}>(fullnames,),
	100,
	Infinity,
	{
		getItemKey: (fullname,) => fullname,
		getResultKey: (thing,) => thing.data.name,
	},
)

/**
 * Fetches information about an API item.
 * The generic parameter `T` narrows the `data` shape when the caller knows the type.
 * Callers for deleted or inaccessible things receive a rejected promise.
 */
export const getInfo = <T extends Record<string, unknown> = Record<string, unknown>,>(
	fullname: string,
	// `as unknown as` is required: the queue is typed as Promise<RedditThing<{name:string}>> (the
	// internal batch key type), and TypeScript's invariant generics don't allow a direct cast to
	// Promise<RedditThing<T>>. The runtime value always matches whatever T the caller specifies.
): Promise<RedditThing<T>> => _getInfoQueue(fullname,) as unknown as Promise<RedditThing<T>>

/**
 * Adds a moderator distinguish to a post or comment.
 * @param id Fullname of the post or comment.
 * @param sticky When distinguishing a top-level comment, also sticky it.
 */
export const distinguishThing = async (id: string, sticky: boolean,) => {
	assertActionAllowed('distinguishThing', {fullname: id,},)
	const response = await apiOauthPOST('/api/distinguish/yes', {
		id,
		sticky: String(sticky,),
	},)
	await parseRedditApiResponse(response, {requireSuccess: true,},)
}

/**
 * Creates a single-`id` thing-action function that POSTs to a fixed endpoint.
 * Every thing-action is a real moderation action, so `guardName` is required: the
 * action is gated by the training-mode capture guard, which blocks it for a
 * sandboxed trainee. (Requiring it - rather than an optional opt-in - means a new
 * thing-action can't silently skip the guard and leak a real action.)
 */
const makeThingAction = (endpoint: string, guardName: string,) => (id: string,): Promise<void> => {
	assertActionAllowed(guardName, {fullname: id,},)
	return postRedditApiVoid(endpoint, {id,},)
}

// removeThing is not built with makeThingAction because it requires a dynamic `spam` parameter.

/** Approves a post or comment. */
export const approveThing = makeThingAction('/api/approve', 'approveThing',)

/** Removes a post or comment. */
export const removeThing = async (id: string, spam = false,) => {
	assertActionAllowed('removeThing', {fullname: id,},)
	return postRedditApiVoid('/api/remove', {id, spam: String(spam,),},)
}

/** Ignores reports on a post or comment. */
export const ignoreReports = makeThingAction('/api/ignore_reports', 'ignoreReports',)

/** Marks a post as NSFW. */
export const markOver18 = makeThingAction('/api/marknsfw', 'markOver18',)

/** Un-marks a post NSFW. */
export const unMarkOver18 = makeThingAction('/api/unmarknsfw', 'unMarkOver18',)

/** Locks a post or comment. */
export const lock = makeThingAction('/api/lock', 'lock',)

/** Unlocks a post or comment. */
export const unlock = makeThingAction('/api/unlock', 'unlock',)

/**
 * Pins (stickies) a submission within its subreddit.
 * @param id Fullname of the submission to sticky.
 * @param position Slot to pin into, either 1 or 2.
 * @param state Pass false to remove the sticky (internal only; prefer
 * {@link unstickyThread}).
 */
export const stickyThread = async (id: string, position: number | undefined, state = true,) => {
	// Guards both sticky and unsticky, since unstickyThread delegates here.
	assertActionAllowed('stickyThread', {fullname: id,},)
	return postRedditApiVoid('/api/set_subreddit_sticky', {
		id,
		num: position == null ? undefined : String(position,),
		state: String(state,),
	},)
}

/** Unstickies a submission. */
export const unstickyThread = (id: string,) => stickyThread(id, undefined, false,)

/**
 * Posts Reddit's official removal reason message for a post or comment, displayed
 * publicly as from the subreddit ModTeam. Selects the comment or link endpoint
 * based on the fullname prefix.
 */
export const sendOfficialRemovalMessage = ({
	fullname,
	message,
	title = 'removal reason through Toolbox-NXG',
	lockComment = false,
}: {
	fullname: string
	message: string
	title?: string
	lockComment?: boolean
},): Promise<void> => {
	assertActionAllowed('sendOfficialRemovalMessage', {fullname,},)
	const endpoint = fullname.startsWith('t1',)
		? '/api/v1/modactions/removal_comment_message'
		: '/api/v1/modactions/removal_link_message'
	return postRedditApiVoid(
		endpoint,
		{
			type: 'json',
			data: {item_id: [fullname,], message, title, type: 'public_as_subreddit', lock_comment: lockComment,},
		},
	)
}

/** Response shape of `/api/info.json` - a listing of things. */
interface ThingInfoResponse {
	data: {
		children: RedditThing[]
		after: string | null
	}
}

/** Fetches info about a Reddit thing by fullname within a subreddit context. */
export const getThingInfo = (subreddit: string, id: string,): Promise<ThingInfoResponse> =>
	apiOauthGetJSON<ThingInfoResponse>(`/r/${subreddit}/api/info.json`, {id,},)
