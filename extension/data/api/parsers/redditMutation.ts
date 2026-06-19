/** Helpers for sending Reddit mutation (write) API requests and interpreting the standard `{json:{errors,data}}` envelope. */

import {apiOauthPOST,} from '../transport/http'
import type {RequestBody,} from '../transport/http'

/**
 * A Reddit API error tuple: `[error_code, human_readable_message, optional_field]`.
 * Errors are returned as arrays inside the `json.errors` field of mutation responses.
 */
export type RedditApiErrorTuple = [string, string, string?,]

/** The standard envelope Reddit wraps mutation responses in. */
interface RedditApiPayload<T,> {
	json?: {
		/** Non-empty when Reddit reports one or more validation or API errors. */
		errors?: RedditApiErrorTuple[]
		/** The actual payload data when the request succeeded. */
		data?: T
	}
	/** Present on `/api/distinguish/yes` instead of `json`. */
	success?: boolean
}

/** Thrown when a Reddit mutation response contains API-level errors. */
export class RedditApiError extends Error {
	/** The raw error tuples returned by Reddit. */
	errors: RedditApiErrorTuple[]
	/** The full parsed response body, useful for debugging. */
	rawResponse?: unknown

	constructor (errors: RedditApiErrorTuple[], rawResponse?: unknown,) {
		const message = errors.map((error,) => error[1] || error[0]).join('; ',) || 'Reddit API returned an error'
		super(message,)
		this.name = 'RedditApiError'
		this.errors = errors
		this.rawResponse = rawResponse
	}
}

/**
 * Parses a Reddit mutation response, throwing `RedditApiError` on API-level errors.
 * When a `validator` is provided the return type is narrowed to `R`; otherwise
 * the raw `data` field (which may be `undefined`) is returned.
 * @param response The raw fetch `Response` to parse.
 * @param options.requireSuccess If `true`, throws when `response.success === false`.
 * @param options.validator Transforms and validates the `data` field; narrows the return type.
 */
export async function parseRedditApiResponse<T, R,> (
	response: Response,
	options: {requireSuccess?: boolean; validator: (data: T | undefined,) => R},
): Promise<R>
export async function parseRedditApiResponse<T,> (
	response: Response,
	options?: {requireSuccess?: boolean},
): Promise<T | undefined>
export async function parseRedditApiResponse<T, R,> (
	response: Response,
	options: {requireSuccess?: boolean; validator?: (data: T | undefined,) => R} = {},
): Promise<T | undefined | R> {
	const rawResponse = await response.json() as RedditApiPayload<T>
	const errors = rawResponse.json?.errors ?? []
	if (errors.length > 0) {
		throw new RedditApiError(errors, rawResponse,)
	}
	if (options.requireSuccess && rawResponse.success === false) {
		throw new RedditApiError([['OPERATION_FAILED', 'Reddit API did not confirm success',],], rawResponse,)
	}
	const data = rawResponse.json?.data
	return options.validator ? options.validator(data,) : data
}

/**
 * POSTs to a Reddit API endpoint and parses the standard `{json:{errors,data}}` response.
 * When a `validator` is provided the return type is narrowed to `R`.
 * @param endpoint The OAuth API endpoint path.
 * @param body Form-encoded body fields.
 * @param validator Transforms and validates the response `data` field.
 */
export async function postRedditApi<T, R,> (
	endpoint: string,
	body: RequestBody | undefined,
	validator: (data: T | undefined,) => R,
): Promise<R>
export async function postRedditApi<T,> (
	endpoint: string,
	body?: RequestBody,
): Promise<T | undefined>
export async function postRedditApi<T, R,> (
	endpoint: string,
	body?: RequestBody,
	validator?: (data: T | undefined,) => R,
): Promise<T | undefined | R> {
	const response = await apiOauthPOST(endpoint, body,)
	if (validator) {
		return parseRedditApiResponse<T, R>(response, {validator,},)
	}
	return parseRedditApiResponse<T>(response,)
}

/** POSTs to a Reddit API endpoint and discards the response body. */
export async function postRedditApiVoid (endpoint: string, body?: RequestBody,): Promise<void> {
	await postRedditApi(endpoint, body,)
}
