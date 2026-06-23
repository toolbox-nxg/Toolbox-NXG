/** API function for fetching the names of items currently in a subreddit's modqueue. */

import {apiOauthGetJSON,} from '../transport/http'

/**
 * Fetches the fullnames of all items currently in a subreddit's modqueue.
 * @param subreddit The subreddit whose modqueue to fetch.
 * @param limit Maximum number of items to return per request.
 * @returns An array of fullnames (e.g. `t3_abc123`).
 */
export async function getModqueueThingNames (subreddit: string, limit = 100,): Promise<string[]> {
	const queue = await apiOauthGetJSON<{data: {children: Array<{data?: {name?: string}}>}}>(
		`/r/${subreddit}/about/modqueue.json`,
		{limit: String(limit,),},
	)
	return queue.data.children
		.map((thing,) => thing.data?.name)
		.filter((name,): name is string => name != null)
}
