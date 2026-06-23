/** HTTP transport layer: proxies all fetch requests through the background service worker. */

import browser from 'webextension-polyfill'

import type {TbRequestMessage, TbRequestResponse,} from '../../background/messages'
import {purifyObject,} from '../../util/data/purify'

/**
 * An error raised by a web request. Carries the originating response when the
 * failure stems from a non-OK status code.
 */
export interface RequestError extends Error {
	/** The request object. */
	response?: Response
}

/**
 * Map of query-string parameters appended to a request URL; entries whose value
 * is `undefined` are dropped.
 */
export type QueryParams = Record<string, string | undefined>

/**
 * A request body. If a plain object is provided, it is converted to a form
 * data body, where items with a value of `undefined` are excluded. To send a
 * JSON body, pass `{type: 'json', data: ...}` and the serialization and
 * `Content-Type` header are handled automatically.
 */
export type RequestBody = string | Record<string, string | undefined> | {type: 'json'; data: unknown}

/** Options for making a web request */
export interface RequestOptions {
	/** The endpoint to request */
	endpoint: string
	/** The HTTP method to use for the request */
	method?: string | undefined
	/** Body to send with a POST request, serialized */
	body?: RequestBody | undefined
	/** Query parameters as an object */
	query?: QueryParams | undefined
	/**
	 * If true, the request will be sent on oauth.reddit.com, and the
	 * `Authorization` header will be set with the OAuth access token for the
	 * logged-in user
	 */
	oauth?: boolean | undefined
	/**
	 * If true, non-2xx responses will result in an error being rejected. The
	 * error will have a `response` property containing the full `Response`
	 * object.
	 */
	okOnly?: boolean | undefined
	/**
	 * If true, the endpoint is treated as a fully-qualified URL rather than a
	 * path on reddit.com. Used by debug/devtools UIs where users paste full URLs.
	 */
	absolute?: boolean | undefined
}

/** The most recently observed ratelimit state, updated from every response. */
let cachedRatelimit: RatelimitDescriptor | null = null

/** Resets the cached ratelimit state. Intended for use in tests. */
export const clearRatelimitCache = () => {
	cachedRatelimit = null
}

function extractRatelimit (response: Response,) {
	const ratelimitRemaining = response.headers.get('x-ratelimit-remaining',)
	const ratelimitReset = response.headers.get('x-ratelimit-reset',)
	if (ratelimitRemaining !== null && ratelimitReset !== null) {
		cachedRatelimit = {ratelimitRemaining, ratelimitReset,}
	}
}

/**
 * Sends a generic HTTP request through the background page. See `RequestOptions`
 * for the shape of the destructured request options.
 * @returns Resolves with a `Response`, or rejects with an `Error`.
 */
export const sendRequest = async ({
	endpoint,
	method,
	body,
	query,
	oauth,
	okOnly,
	absolute,
}: RequestOptions,) => {
	const messageReply = await browser.runtime.sendMessage(
		{
			action: 'toolbox-request',
			method,
			endpoint,
			query,
			body,
			oauth,
			okOnly,
			absolute,
		} satisfies TbRequestMessage,
	) as TbRequestResponse

	if (messageReply.error) {
		const error: RequestError = new Error(messageReply.message,)
		if (messageReply.response) {
			error.response = new Response(...messageReply.response,)
			extractRatelimit(error.response,)
		}
		throw error
	} else {
		const response = new Response(...messageReply.response!,)
		extractRatelimit(response,)
		return response
	}
}

/**
 * Issues a GET request and resolves the parsed JSON body (or the response
 * object on failure).
 * @param endpoint Path to request.
 * @param query Query parameters to append.
 * @param options Extra options forwarded to sendRequest().
 */
export const getJSON = (
	endpoint: string,
	query?: QueryParams,
	options: Partial<RequestOptions> = {},
) => sendRequest({
	okOnly: true,
	method: 'GET',
	endpoint,
	query,
	...options,
},).then((response,) => response.json())

/**
 * Issues a POST request and resolves the parsed JSON body (or the response
 * object on failure); mirrors the shape of `$.post`.
 * @param endpoint Path to request.
 * @param body Body parameters to send.
 * @param options Extra options forwarded to sendRequest().
 * @returns Resolves with the response data, or rejects with an error.
 */
export const post = (endpoint: string, body?: RequestBody, options = {},) =>
	sendRequest({
		okOnly: true,
		method: 'POST',
		endpoint,
		body,
		...options,
	},).then((response,) => response.json())

/**
 * Issues an authenticated POST against the OAuth API.
 * @param endpoint Path to request.
 * @param body Body parameters to send.
 * @param options Extra options forwarded to sendRequest().
 */
export const apiOauthPOST = (endpoint: string, body?: RequestBody, options = {},) =>
	sendRequest({
		method: 'POST',
		oauth: true,
		endpoint,
		body,
		okOnly: true,
		...options,
	},)

/**
 * Issues an authenticated GET against the OAuth API.
 * @param endpoint Path to request.
 * @param query Query parameters to append.
 */
export const apiOauthGET = (endpoint: string, query?: QueryParams,) =>
	sendRequest({
		method: 'GET',
		oauth: true,
		endpoint,
		query,
		okOnly: true,
	},)

/** Parses a response as JSON and sanitizes the result with `purifyObject`. */
const parseAndPurifyJSON = <T,>(response: Response,): Promise<T> =>
	response.json().then((data,) => {
		purifyObject(data,)
		return data as T
	},)

/**
 * Sends an authenticated GET request against the OAuth API, parses the
 * response body as JSON, and sanitizes it with `purifyObject`.
 * @param endpoint Path to request.
 * @param query Query parameters to append.
 * @param options Additional request options (e.g. `absolute: true`)
 */
export const apiOauthGetJSON = <T = unknown,>(
	endpoint: string,
	query?: QueryParams,
	options?: Partial<RequestOptions>,
): Promise<T> =>
	sendRequest({okOnly: true, method: 'GET', oauth: true, endpoint, query, ...options,},)
		.then(parseAndPurifyJSON<T>,)

/**
 * Sends an authenticated POST request against the OAuth API, parses the
 * response body as JSON, and sanitizes it with `purifyObject`.
 * Use for POST endpoints that return raw JSON (not the `{json:{errors,data}}` mutation envelope).
 * @param endpoint Path to request.
 * @param body Body parameters to send.
 * @param options Additional request options
 */
export const apiOauthPostJSON = <T = unknown,>(
	endpoint: string,
	body?: RequestBody,
	options?: Partial<RequestOptions>,
): Promise<T> =>
	sendRequest({okOnly: true, method: 'POST', oauth: true, endpoint, body, ...options,},)
		.then(parseAndPurifyJSON<T>,)

/**
 * Issues an authenticated DELETE against the OAuth API.
 * @param endpoint Path to request.
 * @param query Query parameters to append.
 */
export const apiOauthDELETE = (endpoint: string, query: QueryParams,) =>
	sendRequest({
		method: 'DELETE',
		oauth: true,
		endpoint,
		query,
		okOnly: true,
	},)

/** The current rate limit state returned by Reddit's response headers. */
export interface RatelimitDescriptor {
	/** The number of API calls remaining in this ratelimit period */
	ratelimitRemaining: string
	/** The number of seconds until this ratelimit period resets */
	ratelimitReset: string
}

/**
 * Gets the most recently observed ratelimit state. If no request has been made
 * yet, makes a cheap HEAD request to prime the cache.
 */
export const getRatelimit = (): Promise<RatelimitDescriptor> => {
	if (cachedRatelimit) {
		return Promise.resolve(cachedRatelimit,)
	}
	return sendRequest({method: 'HEAD', endpoint: '/api/v1/me',},)
		// Deliberate conservative fallback: if the HEAD response carries no ratelimit headers
		// (shouldn't happen in practice), report 0 remaining rather than no data at all.
		.then(() => cachedRatelimit ?? {ratelimitRemaining: '0', ratelimitReset: '0',})
}
