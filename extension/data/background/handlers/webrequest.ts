/**
 * Background handler that performs actual HTTP requests on behalf of content
 * scripts. All Reddit API traffic is proxied through here so that OAuth tokens,
 * rate-limit tracking, and SSRF guards are centralized in the service worker.
 */

import browser from 'webextension-polyfill'

import createLogger from '../../util/infra/logging'
import {registerMessageHandler,} from '../messageHandling'
import {tmpStoreHeaders,} from './cookieStore'
import {getCookieWithFPIFallback, getRedditSessionJTI, isAllowedRedditHost,} from './tabUtils'

const log = createLogger('TBWebrequest',)

type QueryValue = string | number | boolean | undefined
type RequestBodyObject = Record<string, string | undefined>
type RequestMethod = 'GET' | 'POST' | 'DELETE' | 'HEAD'

const allowedRequestMethods = new Set<RequestMethod>(['GET', 'POST', 'DELETE', 'HEAD',],)

interface RateLimitState {
	remaining: number
	resetAt: number // absolute ms timestamp
}

let rateLimitState: RateLimitState = {remaining: Infinity, resetAt: 0,}
let budgetWaitPromise: Promise<void> | null = null

/**
 * Resets rate-limit tracking to the initial "unlimited" state.
 * @internal Exported for use in tests only.
 */
export function resetRateLimitState (): void {
	rateLimitState = {remaining: Infinity, resetAt: 0,}
	budgetWaitPromise = null
}

/** Updates the in-memory rate-limit state from Reddit's `x-ratelimit-*` response headers. */
function updateRateLimitState (response: Response,): void {
	const remaining = response.headers.get('x-ratelimit-remaining',)
	const reset = response.headers.get('x-ratelimit-reset',)
	if (remaining != null && reset != null) {
		rateLimitState = {
			remaining: parseFloat(remaining,),
			resetAt: Date.now() + parseFloat(reset,) * 1000,
		}
	}
}

/**
 * Atomically checks whether the rate-limit budget has a slot available and, if so,
 * decrements it. Returns `true` if a slot was consumed (caller may proceed), `false`
 * if the budget is exhausted.
 *
 * The read-modify-write is uninterruptible because it contains no `await` - JS's
 * single-threaded event loop guarantees no other handler runs between the check and
 * the decrement, closing the check-then-act race in `waitForBudget`.
 */
function consumeBudget (): boolean {
	if (rateLimitState.remaining < 1) { return false }
	rateLimitState = {...rateLimitState, remaining: rateLimitState.remaining - 1,}
	return true
}

/**
 * Waits until the Reddit API rate-limit budget has at least one call remaining, then
 * atomically consumes a slot via {@link consumeBudget}. All concurrent callers share
 * a single timer promise so only one reset delay is created.
 *
 * State mutations after the `await` happen in the same synchronous continuation so
 * that `rateLimitState` and `budgetWaitPromise` are always updated together - no
 * concurrent caller can observe one reset without the other.
 */
async function waitForBudget (): Promise<void> {
	if (consumeBudget()) { return }
	if (!budgetWaitPromise) {
		const ms = Math.max(0, rateLimitState.resetAt - Date.now(),)
		budgetWaitPromise = new Promise<void>((resolve,) => setTimeout(resolve, ms,))
	}
	await budgetWaitPromise
	// Both mutations happen in the same synchronous step; nothing else can
	// run between them, so no caller sees partial state.
	budgetWaitPromise = null
	if (!consumeBudget()) {
		// Timer expired but no response has updated remaining - optimistically reset,
		// then retry in case another concurrent waiter already consumed the fresh slot.
		rateLimitState = {remaining: Infinity, resetAt: 0,}
		return waitForBudget()
	}
}

/** Cached OAuth access token with its expiry timestamp. */
interface TokenData {
	/** The bearer token to include in `Authorization` headers. */
	accessToken: string
	/** Absolute millisecond timestamp after which the token should not be used. */
	expires: number
}

/**
 * Fetches an OAuth token from the /svc/shreddit/token endpoint.
 * @param cookieStoreId Cookie store of the originating tab, so the token is minted
 * from and cached against the correct Firefox container's session.
 * @param tries Number of tries to get the token (recursive)
 */
async function getOAuthTokens (cookieStoreId?: string, tries = 1,): Promise<TokenData> {
	// Attempt to use cached token if it hasn't expired

	// make currently-logged-in user part of the storage key so we don't
	// accidentally use the wrong access token after switching accounts (or
	// containers)
	const currentUserID = await getRedditSessionJTI(cookieStoreId,)
	const storageKey = `toolbox-accessToken-${currentUserID}`
	// browser.storage.local.get returns { [key]: value } rather than the value directly
	const cachedToken = (await browser.storage.local.get(storageKey,))[storageKey] as TokenData | undefined
	if (cachedToken && cachedToken.expires > Date.now()) {
		return cachedToken
	}

	// No luck, fetch new token

	// Grab the csrf_token cookie from the originating container
	const csrfToken = await getCookieWithFPIFallback({
		url: 'https://sh.reddit.com',
		name: 'csrf_token',
		...(cookieStoreId ? {storeId: cookieStoreId,} : {}),
	},)

	// If we have a valid cookie, exchange CSRF token for OAuth token and return
	if (csrfToken) {
		const response = await fetch('https://www.reddit.com/svc/shreddit/token', {
			headers: {'Content-Type': 'application/json', ...tmpStoreHeaders(cookieStoreId,),},
			method: 'POST',
			body: JSON.stringify({csrf_token: csrfToken.value,},),
		},)
		const contentType = response.headers.get('content-type',)
		if (response.ok && contentType?.startsWith('application/json',)) {
			const tokenData = await response.json() as {token: string; expires: number}
			const result: TokenData = {
				accessToken: tokenData.token,
				expires: tokenData.expires,
			}
			await browser.storage.local.set({[storageKey]: result,},)
			return result
		} else {
			throw new Error(
				`Error getting accessToken from /svc/shreddit/token. Response text: ${await response.text()}`,
			)
		}
	}

	// If there's no CSRF token cookie yet, make a request to any shreddit page
	// to set the cookie, then try again
	if (tries < 3) {
		await makeRequest({
			endpoint: 'https://sh.reddit.com/not_found',
			absolute: true,
			cookieStoreId,
		},)
		return getOAuthTokens(cookieStoreId, tries + 1,)
	} else {
		throw new Error('error getting CSRF token',)
	}
}

/**
 * Flattens a fetch `Response` into a plain JSON value from which an equivalent
 * `Response` can later be rebuilt.
 * @returns An array of arguments to the `Response` constructor, serializable
 * to plain JSON, which can be used to replicate the given response.
 */
async function serializeResponse (response: Response,): Promise<[string, ResponseInit,]> {
	const headers: Record<string, string> = {}
	for (const [header, value,] of response.headers) {
		headers[header] = value
	}
	return [await response.text(), {
		status: response.status,
		statusText: response.statusText,
		headers,
	},]
}

/**
 * Builds a `FormData` instance from a set of key-value pairs.
 */
function makeFormData (body: RequestBodyObject,): FormData {
	const formData = new FormData()
	for (const [key, value,] of Object.entries(body,)) {
		if (value != null) {
			formData.append(key, value,)
		}
	}
	return formData
}

/** Uppercases `method` and validates it against the allowed set; returns `undefined` when `method` is `undefined`. */
function normalizeMethod (method: string | undefined,): RequestMethod | undefined {
	if (method === undefined) {
		return undefined
	}
	const normalizedMethod = method.toUpperCase()
	if (!allowedRequestMethods.has(normalizedMethod as RequestMethod,)) {
		throw new Error(`toolbox-request: unsupported HTTP method: ${method}`,)
	}
	return normalizedMethod as RequestMethod
}

/** Throws if any query parameter value is not a string, number, boolean, or undefined. */
function validateQueryParams (query: Record<string, QueryValue> | undefined,): void {
	if (!query) {
		return
	}
	for (const [key, value,] of Object.entries(query,)) {
		if (
			value !== undefined
			&& typeof value !== 'string'
			&& typeof value !== 'number'
			&& typeof value !== 'boolean'
		) {
			throw new Error(`toolbox-request: query parameter ${key} must be a scalar value`,)
		}
	}
}

/** Throws if a form-encoded body object contains any non-string values. */
function validateRequestBody (body: RequestBodyObject | string | {type: 'json'; data: unknown} | undefined,): void {
	if (body === undefined || typeof body === 'string') {
		return
	}
	if (typeof body === 'object' && 'type' in body && body.type === 'json') {
		return
	}
	for (const [key, value,] of Object.entries(body as RequestBodyObject,)) {
		if (value !== undefined && typeof value !== 'string') {
			throw new Error(`toolbox-request: body parameter ${key} must be a string`,)
		}
	}
}

/** Appends `query` parameters to `endpoint` using the `URL` API, returning the final URL string. */
function appendQueryToAbsoluteUrl (endpoint: string, query: Record<string, QueryValue> | undefined,): string {
	const url = new URL(endpoint,)
	if (query) {
		for (const [key, value,] of Object.entries(query,)) {
			if (value !== undefined && value !== null) {
				url.searchParams.append(key, String(value,),)
			}
		}
	}
	return url.toString()
}

/** Returns `'omit'` for redd.it media hosts (no cookies needed) and `'include'` for all other Reddit origins. */
function credentialsForUrl (url: string,): RequestCredentials {
	const {hostname,} = new URL(url,)
	return hostname === 'redd.it' || hostname.endsWith('.redd.it',) ? 'omit' : 'include'
}

/** Options accepted by {@link makeRequest}. */
export interface MakeRequestOptions {
	/** HTTP method; defaults to `GET`. */
	method?: string | undefined
	/** API endpoint path, or a fully-qualified URL when `absolute` is `true`. */
	endpoint: string
	/** Query parameters to append to the URL. */
	query?: Record<string, QueryValue> | undefined
	/** Request body; objects are form-encoded, strings are sent as-is, `{type:'json'}` is JSON-encoded. */
	body?: RequestBodyObject | string | {type: 'json'; data: unknown} | undefined
	/** If `true`, attaches a Reddit OAuth bearer token and targets `oauth.reddit.com`. */
	oauth?: boolean | undefined
	/** If `true`, throws for non-2xx responses. */
	okOnly?: boolean | undefined
	/** If `true`, treats `endpoint` as a fully-qualified URL. Must target a reddit.com origin. */
	absolute?: boolean | undefined
	/**
	 * Cookie store of the tab that originated the request, used to send the right
	 * Firefox container's cookies. Derived from the trusted message `sender`, never
	 * from content-script-supplied payload data.
	 */
	cookieStoreId?: string | undefined
}

/** An `Error` that may carry the failed `Response` for `okOnly` errors. */
interface RequestError extends Error {
	response?: Response
}

/**
 * Performs an arbitrary HTTP request on behalf of the extension.
 */
export async function makeRequest ({
	method,
	endpoint,
	query,
	body,
	oauth,
	okOnly,
	absolute,
	cookieStoreId,
}: MakeRequestOptions,): Promise<Response> {
	// Construct the request URL
	const normalizedMethod = normalizeMethod(method,)
	validateQueryParams(query,)
	validateRequestBody(body,)
	const base = absolute ? endpoint : `https://${oauth ? 'oauth' : 'old'}.reddit.com${endpoint}`
	const url = appendQueryToAbsoluteUrl(base, query,)

	// Guard: absolute URLs must target a Reddit HTTPS origin to prevent SSRF-style misuse.
	if (absolute) {
		const targetUrl = new URL(url,)
		const targetHost = targetUrl.hostname
		if (targetUrl.protocol !== 'https:' || !isAllowedRedditHost(targetHost,)) {
			throw new Error(`toolbox-request: absolute URL must target a reddit.com origin, got: ${targetHost}`,)
		}
		if (oauth) {
			throw new Error('toolbox-request: absolute OAuth requests are not allowed',)
		}
	}

	if (body && normalizedMethod !== 'POST') {
		throw new Error('toolbox-request: request bodies are only allowed with POST requests',)
	}

	// Construct the options object passed to fetch()
	const fetchOptions: RequestInit = {
		credentials: credentialsForUrl(url,), // required for reddit.com cookies, omitted for redd.it media hosts
		redirect: 'error', // prevents strange reddit API shenanigans
		...(normalizedMethod !== undefined ? {method: normalizedMethod,} : {}),
		cache: 'no-store',
	}
	if (body) {
		if (typeof body === 'object' && 'type' in body && body.type === 'json') {
			fetchOptions.body = JSON.stringify(body.data,)
			fetchOptions.headers = {...fetchOptions.headers, 'Content-Type': 'application/json',}
		} else if (typeof body === 'object') {
			fetchOptions.body = makeFormData(body as RequestBodyObject,)
		} else {
			fetchOptions.body = body
		}
	}
	// If requested, fetch OAuth tokens and add `Authorization` header
	if (oauth) {
		try {
			const tokens = await getOAuthTokens(cookieStoreId,)
			fetchOptions.headers = {...fetchOptions.headers, Authorization: `Bearer ${tokens.accessToken}`,}
		} catch (error) {
			log.error('getOAuthTokens: ', error,)
			throw error
		}
	}

	// Tag the request so the Firefox cookie-rewrite listener swaps in the
	// originating container's cookies. No-op off Firefox or for the default store.
	const storeHeaders = tmpStoreHeaders(cookieStoreId,)
	if (storeHeaders) {
		fetchOptions.headers = {...fetchOptions.headers, ...storeHeaders,}
	}

	async function performFetch (failureMessage: string,): Promise<Response> {
		try {
			return await fetch(url, fetchOptions,)
		} catch (error) {
			log.error(failureMessage, error,)
			throw error
		}
	}

	// Perform the request, waiting first if the rate-limit budget is exhausted
	await waitForBudget()
	let response = await performFetch('Fetch request failed:',)
	updateRateLimitState(response,)

	// On 429, wait for Reddit's reset window and retry once.
	// updateRateLimitState above already recorded remaining=0 and resetAt from the
	// response headers (if present). If the 429 carried no rate-limit headers, set
	// a 1-second minimum so waitForBudget always delays before the retry.
	if (response.status === 429) {
		if (rateLimitState.remaining >= 1) {
			rateLimitState = {remaining: 0, resetAt: Date.now() + 1000,}
		}
		await waitForBudget()
		response = await performFetch('Fetch request failed on retry:',)
		updateRateLimitState(response,)
	}

	// `okOnly` means we should throw if the response has a non-2xx status
	if (okOnly && !response.ok) {
		const error: RequestError = new Error('Response returned non-2xx status code',)
		error.response = response
		throw error
	}

	// Otherwise return the raw response
	return response
}

/** Registers the `toolbox-request` message handler that proxies fetch calls. */
export function registerWebrequestHandlers () {
	registerMessageHandler('toolbox-request', (request, sender,) =>
		// cookieStoreId comes only from the trusted sender and is assigned after the
		// request fields so a spoofed payload value cannot override it.
		makeRequest({...request, cookieStoreId: sender.tab?.cookieStoreId,},).then(
			async (response,) => ({response: await serializeResponse(response,),}),
			async (error: RequestError,) => ({
				error: true as const,
				message: error.message,
				response: error.response ? await serializeResponse(error.response,) : undefined,
			}),
		),)
}
