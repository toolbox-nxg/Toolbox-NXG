/** Tests for sendRequest. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const sendMessage = vi.hoisted(() => vi.fn())

vi.mock('webextension-polyfill', () => ({
	default: {runtime: {sendMessage,},},
}),)

import {
	apiOauthDELETE,
	apiOauthGET,
	apiOauthPOST,
	clearRatelimitCache,
	getJSON,
	getRatelimit,
	post,
	sendRequest,
} from './http'

function mockResponse (body: unknown, init?: ResponseInit,): [BodyInit, ResponseInit,] {
	return [JSON.stringify(body,), init ?? {status: 200, headers: {'content-type': 'application/json',},},]
}

beforeEach(() => {
	sendMessage.mockReset()
},)

describe('sendRequest', () => {
	it('sends toolbox request messages through the extension runtime', async () => {
		sendMessage.mockResolvedValue({response: mockResponse({ok: true,},),},)

		const response = await sendRequest({
			method: 'GET',
			endpoint: '/api/test',
			query: {raw_json: '1',},
			oauth: true,
			okOnly: true,
		},)

		expect(sendMessage,).toHaveBeenCalledWith({
			action: 'toolbox-request',
			method: 'GET',
			endpoint: '/api/test',
			query: {raw_json: '1',},
			body: undefined,
			oauth: true,
			okOnly: true,
			absolute: undefined,
		},)
		await expect(response.json(),).resolves.toEqual({ok: true,},)
	})

	it('throws request errors and rebuilds the response when provided', async () => {
		sendMessage.mockResolvedValue({
			error: true,
			message: 'bad response',
			response: mockResponse({reason: 'NOPE',}, {status: 403,},),
		},)

		await expect(sendRequest({endpoint: '/api/test',},),).rejects.toMatchObject({
			message: 'bad response',
			response: expect.any(Response,),
		},)
	})
})

describe('request helpers', () => {
	it('getJSON parses JSON from a GET request', async () => {
		sendMessage.mockResolvedValue({response: mockResponse({data: {ok: true,},},),},)

		await expect(getJSON('/api/test', {foo: 'bar',},),).resolves.toEqual({data: {ok: true,},},)
		expect(sendMessage.mock.calls[0]![0],).toMatchObject({
			method: 'GET',
			endpoint: '/api/test',
			query: {foo: 'bar',},
			okOnly: true,
		},)
	})

	it('post parses JSON from a POST request', async () => {
		sendMessage.mockResolvedValue({response: mockResponse({json: {errors: [],},},),},)

		await expect(post('/api/test', {foo: 'bar',},),).resolves.toEqual({json: {errors: [],},},)
		expect(sendMessage.mock.calls[0]![0],).toMatchObject({
			method: 'POST',
			endpoint: '/api/test',
			body: {foo: 'bar',},
			okOnly: true,
		},)
	})

	it('oauth helpers set oauth, method, endpoint, and okOnly', async () => {
		sendMessage.mockResolvedValue({response: mockResponse({ok: true,},),},)

		await apiOauthPOST('/api/lock', {id: 't3_post',},)
		await apiOauthGET('/api/v1/me', {raw_json: '1',},)
		await apiOauthDELETE('/api/v1/message', {id: 'abc',},)

		expect(sendMessage.mock.calls.map((call,) => call[0]),).toEqual([
			expect.objectContaining({method: 'POST', oauth: true, endpoint: '/api/lock', okOnly: true,},),
			expect.objectContaining({method: 'GET', oauth: true, endpoint: '/api/v1/me', okOnly: true,},),
			expect.objectContaining({method: 'DELETE', oauth: true, endpoint: '/api/v1/message', okOnly: true,},),
		],)
	})
})

describe('getRatelimit', () => {
	beforeEach(() => {
		clearRatelimitCache()
	},)

	it('makes a HEAD request on cold cache and caches the result', async () => {
		sendMessage.mockResolvedValue({
			response: ['', {status: 200, headers: {'x-ratelimit-remaining': '12.5', 'x-ratelimit-reset': '42',},},],
		},)

		await expect(getRatelimit(),).resolves.toEqual({ratelimitRemaining: '12.5', ratelimitReset: '42',},)
		expect(sendMessage,).toHaveBeenCalledTimes(1,)

		await expect(getRatelimit(),).resolves.toEqual({ratelimitRemaining: '12.5', ratelimitReset: '42',},)
		expect(sendMessage,).toHaveBeenCalledTimes(1,)
	})

	it('returns zero defaults when cold-cache HEAD response has no ratelimit headers', async () => {
		sendMessage.mockResolvedValue({response: ['', {status: 200,},],},)

		await expect(getRatelimit(),).resolves.toEqual({ratelimitRemaining: '0', ratelimitReset: '0',},)
	})

	it('passively updates cache from any sendRequest response with ratelimit headers', async () => {
		sendMessage.mockResolvedValue({
			response: ['', {status: 200, headers: {'x-ratelimit-remaining': '50', 'x-ratelimit-reset': '30',},},],
		},)

		await sendRequest({method: 'GET', endpoint: '/api/test',},)
		await expect(getRatelimit(),).resolves.toEqual({ratelimitRemaining: '50', ratelimitReset: '30',},)
		expect(sendMessage,).toHaveBeenCalledTimes(1,)
	})
})
