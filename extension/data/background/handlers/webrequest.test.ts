/** Tests for makeRequest. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

import {mockJwtCookie,} from './test-helpers'

const registerMessageHandler = vi.hoisted(() => vi.fn())
const cookies = vi.hoisted(() => ({get: vi.fn(),}))
const storageLocal = vi.hoisted(() => ({get: vi.fn(), set: vi.fn(),}))
// Presence of webRequest.onBeforeSendHeaders makes the Firefox cookie-rewrite path
// active, so requests with a non-default cookieStoreId get tagged with the temp header.
const webRequest = vi.hoisted(() => ({onBeforeSendHeaders: {addListener: vi.fn(),},}))

vi.mock('webextension-polyfill', () => ({
	default: {cookies, storage: {local: storageLocal,}, webRequest,},
}),)
vi.mock('../messageHandling', () => ({registerMessageHandler,}),)

import {makeRequest, registerWebrequestHandlers, resetRateLimitState,} from './webrequest'
import type {MakeRequestOptions,} from './webrequest'

beforeEach(() => {
	registerMessageHandler.mockClear()
	cookies.get.mockReset().mockResolvedValue(null,)
	storageLocal.get.mockReset().mockResolvedValue({},)
	storageLocal.set.mockReset().mockResolvedValue(undefined,)
	resetRateLimitState()
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ok: true,},), {
				status: 200,
				headers: {'content-type': 'application/json',},
			},),
		),
	)
},)

describe('makeRequest', () => {
	it('builds old reddit URLs, query strings, and form bodies', async () => {
		await makeRequest({
			method: 'POST',
			endpoint: '/api/test',
			query: {a: 'one two', skip: undefined,},
			body: {foo: 'bar', empty: undefined,},
		},)

		expect(fetch,).toHaveBeenCalledWith(
			'https://old.reddit.com/api/test?a=one+two',
			expect.objectContaining({
				method: 'POST',
				credentials: 'include',
				redirect: 'error',
				cache: 'no-store',
				body: expect.any(FormData,),
			},),
		)
		const body = vi.mocked(fetch,).mock.calls[0]![1].body as FormData
		expect(body.get('foo',),).toBe('bar',)
		expect(body.has('empty',),).toBe(false,)
	})

	it('appends query params with ampersand when endpoint already has a query string', async () => {
		await makeRequest({endpoint: '/api/test?existing=1', query: {next: '2',},},)

		expect(fetch,).toHaveBeenCalledWith('https://old.reddit.com/api/test?existing=1&next=2', expect.any(Object,),)
	})

	it('normalizes allowed HTTP methods', async () => {
		await makeRequest({method: 'delete', endpoint: '/api/test',},)

		expect(fetch,).toHaveBeenCalledWith(
			'https://old.reddit.com/api/test',
			expect.objectContaining({method: 'DELETE',},),
		)
	})

	it('rejects unsupported HTTP methods', async () => {
		await expect(makeRequest({method: 'PUT', endpoint: '/api/test',},),).rejects.toThrow(
			'unsupported HTTP method: PUT',
		)
		expect(fetch,).not.toHaveBeenCalled()
	})

	it('rejects request bodies without POST', async () => {
		await expect(makeRequest({method: 'GET', endpoint: '/api/test', body: {foo: 'bar',},},),).rejects.toThrow(
			'request bodies are only allowed with POST requests',
		)
		await expect(makeRequest({endpoint: '/api/test', body: {foo: 'bar',},},),).rejects.toThrow(
			'request bodies are only allowed with POST requests',
		)
		expect(fetch,).not.toHaveBeenCalled()
	})

	it('rejects non-scalar query parameter values', async () => {
		await expect(
			makeRequest({
				endpoint: '/api/test',
				query: {nested: {value: 'nope',},} as unknown as MakeRequestOptions['query'],
			},),
		).rejects.toThrow('query parameter nested must be a scalar value',)
		expect(fetch,).not.toHaveBeenCalled()
	})

	it('rejects non-string form body values', async () => {
		await expect(
			makeRequest({
				method: 'POST',
				endpoint: '/api/test',
				body: {count: 1,} as unknown as MakeRequestOptions['body'],
			},),
		).rejects.toThrow('body parameter count must be a string',)
		expect(fetch,).not.toHaveBeenCalled()
	})

	it('uses cached OAuth tokens when valid', async () => {
		cookies.get.mockResolvedValue(mockJwtCookie({jti: 'session',},),)
		storageLocal.get.mockResolvedValue({
			'toolbox-accessToken-session': {accessToken: 'token', expires: Date.now() + 1000,},
		},)

		await makeRequest({endpoint: '/api/me', oauth: true,},)

		expect(fetch,).toHaveBeenCalledWith(
			'https://oauth.reddit.com/api/me',
			expect.objectContaining({
				headers: {Authorization: 'Bearer token',},
			},),
		)
	})

	it('fetches and caches a new OAuth token when needed', async () => {
		cookies.get
			.mockResolvedValueOnce(mockJwtCookie({jti: 'session',},),)
			.mockResolvedValueOnce({value: 'csrf',},)
		storageLocal.get.mockResolvedValue({},)
		vi.mocked(fetch,)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({token: 'fresh', expires: Date.now() + 1000,},), {
					headers: {'content-type': 'application/json',},
				},),
			)
			.mockResolvedValueOnce(new Response('ok',),)

		await makeRequest({endpoint: '/api/me', oauth: true,},)

		expect(storageLocal.set,).toHaveBeenCalledWith({
			'toolbox-accessToken-session': expect.objectContaining({accessToken: 'fresh',},),
		},)
		expect(vi.mocked(fetch,).mock.calls[1]![1].headers,).toEqual({Authorization: 'Bearer fresh',},)
	})

	it('reports non-JSON OAuth token responses without a content-type header', async () => {
		cookies.get
			.mockResolvedValueOnce(mockJwtCookie({jti: 'session',},),)
			.mockResolvedValueOnce({value: 'csrf',},)
		storageLocal.get.mockResolvedValue({},)
		vi.mocked(fetch,).mockResolvedValueOnce(new Response('not json',),)

		await expect(makeRequest({endpoint: '/api/me', oauth: true,},),).rejects.toThrow(
			'Error getting accessToken from /svc/shreddit/token. Response text: not json',
		)
	})

	it('rejects absolute URLs outside reddit domains', async () => {
		await expect(makeRequest({endpoint: 'https://example.com/api', absolute: true,},),).rejects.toThrow(
			'absolute URL must target a reddit.com origin',
		)
	})

	it('rejects absolute lookalike reddit domains', async () => {
		await expect(makeRequest({endpoint: 'https://notreddit.com/api', absolute: true,},),).rejects.toThrow(
			'absolute URL must target a reddit.com origin',
		)
		await expect(makeRequest({endpoint: 'https://evilredd.it/api', absolute: true,},),).rejects.toThrow(
			'absolute URL must target a reddit.com origin',
		)
	})

	it('rejects non-HTTPS absolute reddit URLs', async () => {
		await expect(makeRequest({endpoint: 'http://old.reddit.com/api', absolute: true,},),).rejects.toThrow(
			'absolute URL must target a reddit.com origin',
		)
	})

	it('allows HTTPS absolute reddit and redd.it URLs', async () => {
		await makeRequest({endpoint: 'https://www.reddit.com/api/test', absolute: true,},)
		await makeRequest({endpoint: 'https://v.redd.it/api/test', absolute: true,},)

		expect(fetch,).toHaveBeenNthCalledWith(
			1,
			'https://www.reddit.com/api/test',
			expect.objectContaining({credentials: 'include',},),
		)
		expect(fetch,).toHaveBeenNthCalledWith(
			2,
			'https://v.redd.it/api/test',
			expect.objectContaining({credentials: 'omit',},),
		)
	})

	it('appends query params to absolute URLs', async () => {
		await makeRequest({
			endpoint: 'https://www.reddit.com/api/test?existing=1',
			query: {next: 'two words', raw_json: '1',},
			absolute: true,
		},)

		expect(fetch,).toHaveBeenCalledWith(
			'https://www.reddit.com/api/test?existing=1&next=two+words&raw_json=1',
			expect.any(Object,),
		)
	})

	it('rejects absolute OAuth requests before fetching a token', async () => {
		await expect(
			makeRequest({endpoint: 'https://oauth.reddit.com/api/me', absolute: true, oauth: true,},),
		).rejects.toThrow('absolute OAuth requests are not allowed',)
		expect(cookies.get,).not.toHaveBeenCalled()
		expect(fetch,).not.toHaveBeenCalled()
	})

	it('throws response-bearing errors for non-ok responses with okOnly', async () => {
		vi.mocked(fetch,).mockResolvedValue(new Response('nope', {status: 500,},),)

		await expect(makeRequest({endpoint: '/api/test', okOnly: true,},),).rejects.toMatchObject({
			response: expect.any(Response,),
		},)
	})
})

describe('rate limiting', () => {
	it('updates rate-limit state from response headers', async () => {
		vi.mocked(fetch,).mockResolvedValueOnce(
			new Response('', {
				status: 200,
				headers: {'x-ratelimit-remaining': '42.0', 'x-ratelimit-reset': '60',},
			},),
		)
		// Second request should proceed immediately (42 remaining)
		vi.mocked(fetch,).mockResolvedValueOnce(new Response('', {status: 200,},),)

		await makeRequest({endpoint: '/api/first',},)
		await makeRequest({endpoint: '/api/second',},)

		expect(fetch,).toHaveBeenCalledTimes(2,)
	})

	it('uses a single shared wait for concurrent requests hitting an exhausted budget', async () => {
		vi.useFakeTimers()
		vi.mocked(fetch,)
			.mockResolvedValueOnce(
				new Response('', {
					status: 200,
					headers: {'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '60',},
				},),
			)
			.mockResolvedValue(new Response('', {status: 200,},),)

		// Exhaust the budget
		await makeRequest({endpoint: '/api/first',},)

		// Queue three concurrent requests — all should share one wait, not create three timers
		const [p1, p2, p3,] = [
			makeRequest({endpoint: '/api/a',},),
			makeRequest({endpoint: '/api/b',},),
			makeRequest({endpoint: '/api/c',},),
		]
		await Promise.resolve()
		expect(fetch,).toHaveBeenCalledTimes(1,)

		await vi.advanceTimersByTimeAsync(60_000,)
		await Promise.all([p1, p2, p3,],)
		// All three fire after the shared wait — no extra fetches from spurious timer firings
		expect(fetch,).toHaveBeenCalledTimes(4,)

		vi.useRealTimers()
	})

	it('waits for the reset window when the budget is exhausted before sending the next request', async () => {
		vi.useFakeTimers()
		vi.mocked(fetch,)
			.mockResolvedValueOnce(
				new Response('', {
					status: 200,
					headers: {'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '60',},
				},),
			)
			.mockResolvedValueOnce(new Response('', {status: 200,},),)

		await makeRequest({endpoint: '/api/first',},)

		const pending = makeRequest({endpoint: '/api/second',},)
		// Flush microtasks so the second makeRequest reaches its setTimeout
		await Promise.resolve()
		expect(fetch,).toHaveBeenCalledTimes(1,)

		await vi.advanceTimersByTimeAsync(60_000,)
		await pending
		expect(fetch,).toHaveBeenCalledTimes(2,)

		vi.useRealTimers()
	})

	it('retries once after waiting when it receives a 429', async () => {
		vi.useFakeTimers()
		vi.mocked(fetch,)
			.mockResolvedValueOnce(
				new Response('', {
					status: 429,
					headers: {'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '30',},
				},),
			)
			.mockResolvedValueOnce(new Response('ok', {status: 200,},),)

		const pending = makeRequest({endpoint: '/api/test',},)
		await Promise.resolve()
		expect(fetch,).toHaveBeenCalledTimes(1,)

		await vi.advanceTimersByTimeAsync(30_000,)
		const response = await pending
		expect(fetch,).toHaveBeenCalledTimes(2,)
		expect(response.status,).toBe(200,)

		vi.useRealTimers()
	})

	it('propagates a 429 error after the retry if still rate-limited', async () => {
		vi.useFakeTimers()
		vi.mocked(fetch,).mockResolvedValue(
			new Response('', {
				status: 429,
				headers: {'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1',},
			},),
		)

		const pending = makeRequest({endpoint: '/api/test', okOnly: true,},)
		// Attach the rejection handler before advancing timers so the promise
		// is never unhandled when the retry throws
		const assertion = expect(pending,).rejects.toMatchObject({response: expect.any(Response,),},)
		await vi.advanceTimersByTimeAsync(1_000,)
		await assertion
		expect(fetch,).toHaveBeenCalledTimes(2,)

		vi.useRealTimers()
	})

	it('falls back to a 1-second wait for 429 with no rate-limit headers', async () => {
		vi.useFakeTimers()
		vi.mocked(fetch,)
			.mockResolvedValueOnce(new Response('', {status: 429,},),)
			.mockResolvedValueOnce(new Response('ok', {status: 200,},),)

		const pending = makeRequest({endpoint: '/api/test',},)
		await Promise.resolve()
		expect(fetch,).toHaveBeenCalledTimes(1,)

		await vi.advanceTimersByTimeAsync(1_000,)
		await pending
		expect(fetch,).toHaveBeenCalledTimes(2,)

		vi.useRealTimers()
	})
})

describe('webrequest message handler', () => {
	it('serializes successful responses', async () => {
		registerWebrequestHandlers()
		const handler = registerMessageHandler.mock.calls[0]![1]

		const result = await handler({endpoint: '/api/test',}, {},)

		expect(result,).toEqual({
			response: [JSON.stringify({ok: true,},), expect.objectContaining({status: 200,},),],
		},)
	})

	it('serializes response-bearing errors', async () => {
		vi.mocked(fetch,).mockResolvedValue(new Response('nope', {status: 500, statusText: 'Server Error',},),)
		registerWebrequestHandlers()
		const handler = registerMessageHandler.mock.calls[0]![1]

		const result = await handler({endpoint: '/api/test', okOnly: true,}, {},)

		expect(result,).toEqual({
			error: true,
			message: 'Response returned non-2xx status code',
			response: ['nope', expect.objectContaining({status: 500, statusText: 'Server Error',},),],
		},)
	})

	it('tags the request with the sender tab cookie store', async () => {
		registerWebrequestHandlers()
		const handler = registerMessageHandler.mock.calls[0]![1]

		await handler({endpoint: '/api/test',}, {tab: {cookieStoreId: 'firefox-container-1',},},)

		expect(fetch,).toHaveBeenCalledWith(
			'https://old.reddit.com/api/test',
			expect.objectContaining({
				headers: expect.objectContaining({'x-toolbox-tmp-cookiestore': 'firefox-container-1',},),
			},),
		)
	})

	it('ignores a spoofed cookieStoreId in the message payload', async () => {
		registerWebrequestHandlers()
		const handler = registerMessageHandler.mock.calls[0]![1]

		await handler(
			{endpoint: '/api/test', cookieStoreId: 'evil-store',},
			{tab: {cookieStoreId: 'firefox-container-1',},},
		)

		const headers = vi.mocked(fetch,).mock.calls[0]![1].headers
		expect(headers['x-toolbox-tmp-cookiestore'],).toBe('firefox-container-1',)
	})
})
