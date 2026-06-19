/**
 * Convenience wrappers for fetching raw Reddit listing JSON with `raw_json=1`.
 * These three functions are the single consolidation point for that parameter -
 * all Reddit page/endpoint/absolute fetches go through one of them.
 */

import {apiOauthGetJSON,} from '../transport/http'
import type {QueryParams,} from '../transport/http'

/** Fetches a Reddit API endpoint as JSON with `raw_json=1` applied. */
export function getRedditEndpointJson<T = any,> (endpoint: string,): Promise<T> {
	return apiOauthGetJSON<T>(endpoint, {raw_json: '1',},)
}

/**
 * Fetches the `.json` equivalent of a Reddit page.
 * @param pathname The page's URL pathname (e.g. `/r/sub/hot`).
 * @param query Optional query parameters to append.
 */
export function getRedditPageJson<T = any,> (pathname: string, query: QueryParams = {},): Promise<T> {
	return apiOauthGetJSON<T>(`${pathname}.json`, {...query, raw_json: '1',},)
}

/**
 * Fetches a fully-qualified Reddit URL as JSON with `raw_json=1` applied.
 * @param url A complete `https://` URL on a reddit.com origin.
 */
export function getAbsoluteRedditJson<T = any,> (url: string,): Promise<T> {
	return apiOauthGetJSON<T>(url, {raw_json: '1',}, {absolute: true,},)
}
