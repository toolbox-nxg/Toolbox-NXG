/**
 * Tests for the revision-aware wiki transport. The underlying wiki helpers and the
 * HTTP POST are mocked so the read consistency (head rev → that revision's content),
 * the always-on mod-only settings write, and 409 conflict handling are exercised in
 * isolation.
 */

// @vitest-environment node
import {beforeEach, describe, expect, it, vi,} from 'vitest'

const getWikiRevisions = vi.hoisted(() => vi.fn())
const readWikiRevision = vi.hoisted(() => vi.fn())
const setWikiPageSettings = vi.hoisted(() => vi.fn())
vi.mock('./wiki', () => ({getWikiRevisions, readWikiRevision, setWikiPageSettings,}),)

const apiOauthPOST = vi.hoisted(() => vi.fn())
vi.mock('../transport/http', () => ({apiOauthPOST,}),)

import {readWikiPageVersioned, type WikiPageCodec, writeWikiPageConditional,} from './wikiVersioned'

interface Doc {
	n: number
}

/** Codec that refuses any content containing the sentinel `"bad"`. */
const codec: WikiPageCodec<Doc> = {
	parse: (raw,) =>
		raw.includes('bad',)
			? {ok: false, reason: 'unrecognized',}
			: {ok: true, data: JSON.parse(raw,) as Doc,},
	serialize: (data,) => JSON.stringify(data,),
	empty: () => ({n: 0,}),
}

/** Builds a minimal Response-like object for the POST mock. */
function fakeResponse (
	{ok, status, body,}: {ok: boolean; status: number; body?: unknown},
): Response {
	return {
		ok,
		status,
		json: async () => body,
	} as unknown as Response
}

beforeEach(() => {
	vi.clearAllMocks()
	setWikiPageSettings.mockResolvedValue(undefined,)
},)

describe('readWikiPageVersioned', () => {
	/** Builds a RequestError-shaped rejection carrying an HTTP status. */
	function httpError (status: number,): Error {
		return Object.assign(new Error(`HTTP ${status}`,), {response: {status,} as Response,},)
	}

	it('returns empty data when the page does not exist (404)', async () => {
		getWikiRevisions.mockRejectedValue(httpError(404,),)
		const read = await readWikiPageVersioned('sub', 'p', codec,)
		expect(read,).toEqual({data: {n: 0,}, rev: undefined,},)
	})

	it('refuses (unparseable) when listing revisions fails for a non-404 reason', async () => {
		getWikiRevisions.mockRejectedValue(httpError(500,),)
		const read = await readWikiPageVersioned('sub', 'p', codec,)
		expect(read.rev,).toBeUndefined()
		expect(read.unparseable,).toBeDefined()
	})

	it('refuses (unparseable) when listing revisions fails with no response (network error)', async () => {
		getWikiRevisions.mockRejectedValue(new Error('offline',),)
		const read = await readWikiPageVersioned('sub', 'p', codec,)
		expect(read.unparseable,).toBeDefined()
	})

	it('reads the exact head revision content', async () => {
		getWikiRevisions.mockResolvedValue([{id: 'rev9',},],)
		readWikiRevision.mockResolvedValue({ok: true, data: '{"n":7}',},)
		const read = await readWikiPageVersioned('sub', 'p', codec,)
		expect(readWikiRevision,).toHaveBeenCalledWith('sub', 'p', 'rev9',)
		expect(read,).toEqual({data: {n: 7,}, rev: 'rev9',},)
	})

	it('flags unparseable content but keeps the rev', async () => {
		getWikiRevisions.mockResolvedValue([{id: 'rev9',},],)
		readWikiRevision.mockResolvedValue({ok: true, data: 'bad',},)
		const read = await readWikiPageVersioned('sub', 'p', codec,)
		expect(read.rev,).toBe('rev9',)
		expect(read.unparseable,).toEqual({reason: 'unrecognized',},)
	})

	it('flags an unreadable revision as unparseable but keeps the rev', async () => {
		getWikiRevisions.mockResolvedValue([{id: 'rev9',},],)
		readWikiRevision.mockResolvedValue({ok: false, reason: 'no_page',},)
		const read = await readWikiPageVersioned('sub', 'p', codec,)
		expect(read.rev,).toBe('rev9',)
		expect(read.unparseable,).toBeDefined()
	})
})

describe('writeWikiPageConditional', () => {
	it('re-applies mod-only settings on every successful write', async () => {
		apiOauthPOST.mockResolvedValue(fakeResponse({ok: true, status: 200,},),)
		const result = await writeWikiPageConditional('sub', 'p', {n: 1,}, 'why', 'rev1', codec, {listed: 'false',},)
		expect(result,).toEqual({ok: true,},)
		expect(setWikiPageSettings,).toHaveBeenCalledWith({
			subreddit: 'sub',
			page: 'p',
			listed: 'false',
			permlevel: '2',
		},)
	})

	it('formats the reason and sends the previous revision', async () => {
		apiOauthPOST.mockResolvedValue(fakeResponse({ok: true, status: 200,},),)
		await writeWikiPageConditional('sub', 'p', {n: 1,}, 'my edit', 'rev1', codec, {listed: 'true',},)
		expect(apiOauthPOST,).toHaveBeenCalledWith(
			'/r/sub/api/wiki/edit',
			{page: 'p', content: '{"n":1}', reason: '"my edit" via toolbox', previous: 'rev1',},
			{okOnly: false,},
		)
	})

	it('expands tabs when requested', async () => {
		apiOauthPOST.mockResolvedValue(fakeResponse({ok: true, status: 200,},),)
		const tabCodec: WikiPageCodec<string> = {
			parse: (r,) => ({ok: true, data: r,}),
			serialize: (d,) => d,
			empty: () => '',
		}
		await writeWikiPageConditional('sub', 'p', 'a\tb', 'r', undefined, tabCodec, {
			listed: 'true',
			expandTabs: true,
		},)
		expect(apiOauthPOST.mock.calls[0]![1].content,).toBe('a    b',)
	})

	it('returns the current state from a 409 EDIT_CONFLICT body', async () => {
		apiOauthPOST.mockResolvedValue(fakeResponse({
			ok: false,
			status: 409,
			body: {reason: 'EDIT_CONFLICT', newrevision: 'rev2', newcontent: '{"n":42}',},
		},),)
		const result = await writeWikiPageConditional('sub', 'p', {n: 1,}, 'r', 'rev1', codec, {listed: 'false',},)
		expect(result,).toEqual({ok: false, conflict: true, data: {n: 42,}, rev: 'rev2',},)
	})

	it('marks a conflict unparseable when the fresh content is unrecognized', async () => {
		apiOauthPOST.mockResolvedValue(fakeResponse({
			ok: false,
			status: 409,
			body: {reason: 'EDIT_CONFLICT', newrevision: 'rev2', newcontent: 'bad',},
		},),)
		const result = await writeWikiPageConditional('sub', 'p', {n: 1,}, 'r', 'rev1', codec, {listed: 'false',},)
		expect(result,).toMatchObject({
			ok: false,
			conflict: true,
			rev: 'rev2',
			unparseable: {reason: 'unrecognized',},
		},)
	})

	it('falls back to a fresh read on a 409 without a usable body', async () => {
		apiOauthPOST.mockResolvedValue(fakeResponse({ok: false, status: 409, body: {},},),)
		getWikiRevisions.mockResolvedValue([{id: 'rev5',},],)
		readWikiRevision.mockResolvedValue({ok: true, data: '{"n":9}',},)
		const result = await writeWikiPageConditional('sub', 'p', {n: 1,}, 'r', 'rev1', codec, {listed: 'false',},)
		expect(result,).toEqual({ok: false, conflict: true, data: {n: 9,}, rev: 'rev5',},)
	})

	it('returns a non-conflict error on an unexpected status', async () => {
		apiOauthPOST.mockResolvedValue(fakeResponse({ok: false, status: 500,},),)
		const result = await writeWikiPageConditional('sub', 'p', {n: 1,}, 'r', 'rev1', codec, {listed: 'false',},)
		expect(result,).toMatchObject({ok: false, conflict: false,},)
		expect((result as {error: Error}).error.message,).toMatch(/HTTP 500/,)
	})

	it('returns a non-conflict error when the POST throws', async () => {
		apiOauthPOST.mockRejectedValue(new Error('offline',),)
		const result = await writeWikiPageConditional('sub', 'p', {n: 1,}, 'r', 'rev1', codec, {listed: 'false',},)
		expect(result,).toMatchObject({ok: false, conflict: false,},)
	})
})
