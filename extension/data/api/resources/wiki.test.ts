/** Tests for readFromWiki. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const apiOauthGET = vi.hoisted(() => vi.fn())
const apiOauthGetJSON = vi.hoisted(() => vi.fn())
const apiOauthPOST = vi.hoisted(() => vi.fn())

vi.mock('../../util/infra/logging', () => ({default: () => ({debug: vi.fn(), warn: vi.fn(), error: vi.fn(),}),}),)
vi.mock('../transport/http', () => ({apiOauthGET, apiOauthGetJSON, apiOauthPOST,}),)

import {getWikiPages, getWikiRevisions, postToWiki, readFromWiki, readWikiRevision, setWikiPageSettings,} from './wiki'

beforeEach(() => {
	apiOauthGET.mockReset()
	apiOauthGetJSON.mockReset()
	apiOauthPOST.mockReset().mockResolvedValue(new Response('',),)
},)

describe('readFromWiki', () => {
	it('returns raw wiki markdown by default', async () => {
		apiOauthGET.mockResolvedValue(new Response(JSON.stringify({data: {content_md: 'hello wiki',},},),),)

		await expect(readFromWiki('testsub', 'toolbox',),).resolves.toEqual({ok: true, data: 'hello wiki',},)
		expect(apiOauthGET,).toHaveBeenCalledWith('/r/testsub/wiki/toolbox.json',)
	})

	it('parses wiki JSON when requested', async () => {
		apiOauthGET.mockResolvedValue(new Response(JSON.stringify({data: {content_md: '{"enabled":true}',},},),),)

		await expect(readFromWiki('testsub', 'toolbox', true,),).resolves.toEqual({ok: true, data: {enabled: true,},},)
	})

	it('reverses content_md entity encoding before parsing JSON', async () => {
		// Reddit escapes & < > in content_md; a stored plain-text `<` comes back
		// as &lt; and a stored &lt; comes back as &amp;lt;.
		apiOauthGET.mockResolvedValue(
			new Response(JSON.stringify({data: {content_md: '{"text":"a &lt;b&gt; &amp;amp; c"}',},},),),
		)

		await expect(readFromWiki('testsub', 'toolbox', true,),)
			.resolves.toEqual({ok: true, data: {text: 'a <b> &amp; c',},},)
	})

	it('returns invalid_json for invalid JSON pages', async () => {
		apiOauthGET.mockResolvedValue(new Response(JSON.stringify({data: {content_md: '{bad json',},},),),)

		await expect(readFromWiki('testsub', 'toolbox', true,),).resolves.toEqual({ok: false, reason: 'invalid_json',},)
	})

	it('returns no_page for empty wiki content', async () => {
		apiOauthGET.mockResolvedValue(new Response(JSON.stringify({data: {content_md: '',},},),),)

		await expect(readFromWiki('testsub', 'toolbox',),).resolves.toEqual({ok: false, reason: 'no_page',},)
	})

	it('maps missing wiki error reasons to no_page', async () => {
		const error: Error & {response?: Response} = new Error('not found',)
		error.response = new Response(JSON.stringify({reason: 'PAGE_NOT_CREATED',},), {status: 404,},)
		apiOauthGET.mockRejectedValue(error,)

		await expect(readFromWiki('testsub', 'toolbox',),).resolves.toEqual({ok: false, reason: 'no_page',},)
	})

	it('maps unknown request failures to unknown_error', async () => {
		apiOauthGET.mockRejectedValue(new Error('network',),)

		await expect(readFromWiki('testsub', 'toolbox',),).resolves.toEqual({ok: false, reason: 'unknown_error',},)
	})
})

describe('postToWiki', () => {
	it('stringifies JSON content and posts with a revision reason', async () => {
		await postToWiki('testsub', 'toolbox', {enabled: true,}, 'save settings', true, false,)

		expect(apiOauthPOST,).toHaveBeenCalledWith('/r/testsub/api/wiki/edit', {
			content: '{"enabled":true}',
			page: 'toolbox',
			reason: '"save settings" via toolbox',
		},)
	})

	it('uses the default revision reason and replaces tabs for automoderator updates', async () => {
		await postToWiki('testsub', 'config/automoderator', 'a:\n\t- b', '', false, true,)

		expect(apiOauthPOST.mock.calls[0]![1],).toMatchObject({
			content: 'a:\n    - b',
			reason: 'updated via toolbox',
		},)
	})

	it('sets wiki page to mod-only access after writes', async () => {
		await postToWiki('testsub', 'toolbox', 'content', 'reason', false, false,)

		expect(apiOauthPOST,).toHaveBeenCalledWith('/r/testsub/wiki/settings/toolbox', {
			listed: 'true',
			permlevel: '2',
		},)
	})

	it('resolves despite wiki page settings failure (best-effort)', async () => {
		apiOauthPOST
			.mockResolvedValueOnce(new Response('',),)
			.mockRejectedValueOnce(new Error('forbidden',),)

		await expect(
			postToWiki('testsub', 'toolbox', 'content', 'reason', false, false,),
		).resolves.toBeUndefined()
	})
})

describe('setWikiPageSettings', () => {
	it('posts wiki visibility settings via OAuth API', async () => {
		await setWikiPageSettings({
			subreddit: 'testsub',
			page: 'notes/example',
			listed: 'false',
			permlevel: '2',
		},)

		expect(apiOauthPOST,).toHaveBeenCalledWith('/r/testsub/wiki/settings/notes/example', {
			listed: 'false',
			permlevel: '2',
		},)
	})
})

describe('getWikiPages', () => {
	it('returns the wiki page list', async () => {
		apiOauthGetJSON.mockResolvedValue({data: ['toolbox', 'usernotes',],},)

		await expect(getWikiPages('testsub',),).resolves.toEqual(['toolbox', 'usernotes',],)
	})
})

describe('getWikiRevisions', () => {
	it('maps the revision listing to flat entries', async () => {
		apiOauthGetJSON.mockResolvedValue({
			data: {
				children: [
					{
						id: 'rev-1',
						timestamp: 1_700_000_000,
						author: {kind: 't2', data: {name: 'somemod',},},
						reason: 'fixed a thing',
					},
					{id: 'rev-2', timestamp: 1_600_000_000, author: null, reason: null,},
				],
			},
		},)

		await expect(getWikiRevisions('testsub', 'toolbox',),).resolves.toEqual([
			{id: 'rev-1', timestamp: 1_700_000_000, author: 'somemod', reason: 'fixed a thing',},
			{id: 'rev-2', timestamp: 1_600_000_000, author: '[unknown]', reason: '',},
		],)
		expect(apiOauthGetJSON,).toHaveBeenCalledWith('/r/testsub/wiki/revisions/toolbox.json', {limit: '25',},)
	})

	it('returns an empty list when the listing has no children', async () => {
		apiOauthGetJSON.mockResolvedValue({data: {},},)

		await expect(getWikiRevisions('testsub', 'toolbox',),).resolves.toEqual([],)
	})
})

describe('readWikiRevision', () => {
	it('reads a specific revision via the v query parameter', async () => {
		apiOauthGET.mockResolvedValue(new Response(JSON.stringify({data: {content_md: 'old content',},},),),)

		await expect(readWikiRevision('testsub', 'toolbox', 'rev-1',),).resolves.toEqual(
			{ok: true, data: 'old content',},
		)
		expect(apiOauthGET,).toHaveBeenCalledWith('/r/testsub/wiki/toolbox.json', {v: 'rev-1',},)
	})

	it('returns no_page for empty revision content', async () => {
		apiOauthGET.mockResolvedValue(new Response(JSON.stringify({data: {content_md: '',},},),),)

		await expect(readWikiRevision('testsub', 'toolbox', 'rev-1',),).resolves.toEqual(
			{ok: false, reason: 'no_page',},
		)
	})

	it('returns unknown_error when the request fails', async () => {
		apiOauthGET.mockRejectedValue(new Error('network',),)

		await expect(readWikiRevision('testsub', 'toolbox', 'rev-1',),).resolves.toEqual(
			{ok: false, reason: 'unknown_error',},
		)
	})
})
