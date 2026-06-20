/**
 * Tests for the generic conflict-safe mutate loop. The versioned transport is
 * replaced with an in-memory fake enforcing the same optimistic-concurrency contract
 * as Reddit (a write with a stale `previous` conflicts and carries the current state),
 * so serialization, conflict-retry, and both refusal seams are exercised for real.
 */

// @vitest-environment node
import {beforeEach, describe, expect, it, vi,} from 'vitest'

const readWikiPageVersioned = vi.hoisted(() => vi.fn())
const writeWikiPageConditional = vi.hoisted(() => vi.fn())
vi.mock('../../api/resources/wikiVersioned', () => ({readWikiPageVersioned, writeWikiPageConditional,}),)

import type {WikiPageCodec,} from '../../api/resources/wikiVersioned'
import {mutateWikiPage, type WikiMutator,} from './mutateWikiPage'

/** The toy payload these tests mutate. */
interface Doc {
	ver: number
	items: string[]
}

/** A trivial codec; the transport is mocked, so parse/serialize are never exercised. */
const codec: WikiPageCodec<Doc> = {
	parse: (raw,) => ({ok: true, data: JSON.parse(raw,) as Doc,}),
	serialize: (data,) => JSON.stringify(data,),
	empty: () => ({ver: 1, items: [],}),
}

const clone = <T,>(v: T,): T => JSON.parse(JSON.stringify(v,),) as T

/**
 * Wires the transport mocks to an in-memory page with `previous`-based conflict
 * detection, mirroring the proposals test fake but against the generic transport.
 */
function fakeWiki () {
	let data: Doc = {ver: 1, items: [],}
	let rev: string | undefined = undefined
	let revCounter = 0
	let beforeNextWrite: (() => void) | null = null

	readWikiPageVersioned.mockImplementation(async () => ({data: clone(data,), rev,}))
	writeWikiPageConditional.mockImplementation(
		async (_sub: string, _page: string, next: Doc, _reason: string, previous: string | undefined,) => {
			if (beforeNextWrite) {
				const fn = beforeNextWrite
				beforeNextWrite = null
				fn()
			}
			if (previous !== rev) {
				return {ok: false, conflict: true, data: clone(data,), rev: rev!,}
			}
			data = clone(next,)
			rev = `rev${++revCounter}`
			return {ok: true,}
		},
	)

	return {
		seed (next: Doc,) {
			data = clone(next,)
			rev = `rev${++revCounter}`
		},
		get () {
			return data
		},
		injectConcurrentWrite (fn: (current: Doc,) => void,) {
			beforeNextWrite = () => {
				fn(data,)
				rev = `rev${++revCounter}`
			}
		},
	}
}

/** Builds a config with sensible defaults for the toy doc. */
function config<R,> (
	mutator: WikiMutator<Doc, R>,
	overrides: Partial<Parameters<typeof mutateWikiPage<Doc, R>>[0]> = {},
) {
	return {
		subreddit: 'sub',
		page: 'p',
		codec,
		reason: 'test',
		mutator,
		writeOptions: {listed: 'false' as const,},
		// Retry immediately in tests unless a case overrides it.
		backoff: () => Promise.resolve(),
		...overrides,
	}
}

beforeEach(() => {
	vi.clearAllMocks()
},)

describe('mutateWikiPage', () => {
	it('appends and persists when there is no conflict', async () => {
		const wiki = fakeWiki()
		const result = await mutateWikiPage(config<string>((doc,) => {
			doc.items.push('a',)
			return {write: true, result: 'done',}
		},),)
		expect(result,).toBe('done',)
		expect(wiki.get().items,).toEqual(['a',],)
	})

	it('retries against fresh state when a concurrent writer wins', async () => {
		const wiki = fakeWiki()
		wiki.injectConcurrentWrite((current,) => current.items.push('other',))
		const result = await mutateWikiPage(config<string>((doc,) => {
			doc.items.push('mine',)
			return {write: true, result: 'ok',}
		},),)
		expect(result,).toBe('ok',)
		expect(wiki.get().items.sort(),).toEqual(['mine', 'other',],)
	})

	it('awaits the backoff once, with the failed attempt index, between conflict retries', async () => {
		const wiki = fakeWiki()
		wiki.injectConcurrentWrite((current,) => current.items.push('other',))
		const backoff = vi.fn(async () => {},)
		await mutateWikiPage(config<string>((doc,) => {
			doc.items.push('mine',)
			return {write: true, result: 'ok',}
		}, {backoff,},),)
		expect(backoff,).toHaveBeenCalledTimes(1,)
		expect(backoff,).toHaveBeenCalledWith(0,)
	})

	it('serializes concurrent mutations of the same page', async () => {
		const wiki = fakeWiki()
		const append = (v: string,) =>
			mutateWikiPage(config<void>((doc,) => {
				doc.items.push(v,)
				return {write: true, result: undefined,}
			},),)
		await Promise.all([append('a',), append('b',), append('c',),],)
		expect(wiki.get().items.sort(),).toEqual(['a', 'b', 'c',],)
	})

	it('skips the write and runs onNoop when the mutator declines', async () => {
		fakeWiki()
		const onNoop = vi.fn()
		const result = await mutateWikiPage(config<string>(
			() => ({write: false, result: 'noop',}),
			{onNoop,},
		),)
		expect(result,).toBe('noop',)
		expect(onNoop,).toHaveBeenCalledOnce()
		expect(writeWikiPageConditional,).not.toHaveBeenCalled()
	})

	it('runs onCommit only after a committed write', async () => {
		fakeWiki()
		const onCommit = vi.fn()
		await mutateWikiPage(config<void>(
			(doc,) => {
				doc.items.push('x',)
				return {write: true, result: undefined,}
			},
			{onCommit,},
		),)
		expect(onCommit,).toHaveBeenCalledOnce()
	})

	it('rejects with the abort error and does not write', async () => {
		fakeWiki()
		const boom = new Error('refused by mutator',)
		await expect(
			mutateWikiPage(config<string>(() => ({write: false, abort: boom,})),),
		).rejects.toThrow('refused by mutator',)
		expect(writeWikiPageConditional,).not.toHaveBeenCalled()
	})

	it('refuses before writing when the read is unparseable (seam 1)', async () => {
		readWikiPageVersioned.mockResolvedValue({
			data: {ver: 1, items: [],},
			rev: 'r1',
			unparseable: {reason: 'corrupt page',},
		},)
		await expect(
			mutateWikiPage(config<string>(() => ({write: true, result: 'x',})),),
		).rejects.toThrow('corrupt page',)
		expect(writeWikiPageConditional,).not.toHaveBeenCalled()
	})

	it('refuses via refuseWrite, re-checked against post-409 fresh data (seam 2)', async () => {
		const wiki = fakeWiki()
		// First read is on the supported version; a concurrent writer bumps it to a
		// newer version, so the post-409 re-check must refuse.
		wiki.injectConcurrentWrite((current,) => {
			current.ver = 2
		},)
		await expect(
			mutateWikiPage(config<string>(
				(doc,) => {
					doc.items.push('mine',)
					return {write: true, result: 'x',}
				},
				{refuseWrite: (doc,) => doc.ver > 1 ? 'page is a newer schema version' : undefined,},
			),),
		).rejects.toThrow('newer schema version',)
	})

	it('refuses when a conflict surfaces unparseable fresh state', async () => {
		readWikiPageVersioned.mockResolvedValue({data: {ver: 1, items: [],}, rev: 'r1',},)
		writeWikiPageConditional.mockResolvedValue({
			ok: false,
			conflict: true,
			data: {ver: 1, items: [],},
			rev: 'r2',
			unparseable: {reason: 'fresh corrupt',},
		},)
		await expect(
			mutateWikiPage(config<string>((doc,) => {
				doc.items.push('x',)
				return {write: true, result: 'x',}
			},),),
		).rejects.toThrow('fresh corrupt',)
	})

	it('rejects after exhausting conflict retries', async () => {
		readWikiPageVersioned.mockResolvedValue({data: {ver: 1, items: [],}, rev: 'r1',},)
		// Always conflict, never letting the write commit.
		writeWikiPageConditional.mockResolvedValue({
			ok: false,
			conflict: true,
			data: {ver: 1, items: [],},
			rev: 'rX',
		},)
		await expect(
			mutateWikiPage(config<string>(
				(doc,) => {
					doc.items.push('x',)
					return {write: true, result: 'x',}
				},
				{maxAttempts: 3,},
			),),
		).rejects.toThrow(/exhausted 3 conflict retries/,)
		expect(writeWikiPageConditional,).toHaveBeenCalledTimes(3,)
	})

	it('propagates a non-conflict transport error', async () => {
		readWikiPageVersioned.mockResolvedValue({data: {ver: 1, items: [],}, rev: 'r1',},)
		writeWikiPageConditional.mockResolvedValue({
			ok: false,
			conflict: false,
			error: new Error('network down',),
		},)
		await expect(
			mutateWikiPage(config<string>((doc,) => {
				doc.items.push('x',)
				return {write: true, result: 'x',}
			},),),
		).rejects.toThrow('network down',)
	})
})
