/** Tests for mutateProposals — focused on the forward-compatible schema-version write guard. */

// @vitest-environment node
import {beforeEach, describe, expect, it, vi,} from 'vitest'

const readProposalsPage = vi.hoisted(() => vi.fn())
const writeProposalsPage = vi.hoisted(() => vi.fn())
vi.mock('../../../api/resources/wikiVersioned', () => ({
	readWikiPageVersioned: readProposalsPage,
	writeWikiPageConditional: writeProposalsPage,
}),)

const setCachedProposals = vi.hoisted(() => vi.fn())
const emitProposalsChanged = vi.hoisted(() => vi.fn())
const broadcastProposalsChanged = vi.hoisted(() => vi.fn())
vi.mock('./events', () => ({setCachedProposals, emitProposalsChanged, broadcastProposalsChanged,}),)

import {mutateProposals,} from './mutate'

beforeEach(() => {
	vi.clearAllMocks()
},)

describe('mutateProposals schema-version write guard', () => {
	it('refuses to write a page whose schema version is newer than supported', async () => {
		// A future v2 client wrote the page; this v1 build's read dropped any proposals it
		// couldn't parse, so writing our lossy view back would discard that newer data.
		readProposalsPage.mockResolvedValue({data: {ver: 2, proposals: {},}, rev: 'r1',},)

		await expect(
			mutateProposals('sub', () => ({write: true, result: 'ok',}), 'test',),
		).rejects.toThrow(/newer than supported/,)
		expect(writeProposalsPage,).not.toHaveBeenCalled()
	})

	it('writes normally when the page is on the supported schema version', async () => {
		readProposalsPage.mockResolvedValue({data: {ver: 1, proposals: {},}, rev: 'r1',},)
		writeProposalsPage.mockResolvedValue({ok: true,},)

		const result = await mutateProposals('sub', () => ({write: true, result: 'done',}), 'test',)

		expect(result,).toBe('done',)
		expect(writeProposalsPage,).toHaveBeenCalledOnce()
		// A committed write mirrors the post-write data (with its bumped seq) to every tab.
		expect(broadcastProposalsChanged,).toHaveBeenCalledWith('sub', {ver: 1, seq: 1, proposals: {},},)
	})

	it('bumps the monotonic page version by one on a committed write', async () => {
		readProposalsPage.mockResolvedValue({data: {ver: 1, seq: 5, proposals: {},}, rev: 'r1',},)
		writeProposalsPage.mockResolvedValue({ok: true,},)

		await mutateProposals('sub', () => ({write: true, result: 'done',}), 'test',)

		// The data handed to the conditional write carries seq + 1.
		expect(writeProposalsPage.mock.calls[0][2],).toMatchObject({seq: 6,},)
	})

	it('does not broadcast or bump seq when the mutator writes nothing', async () => {
		readProposalsPage.mockResolvedValue({data: {ver: 1, seq: 5, proposals: {},}, rev: 'r1',},)

		const result = await mutateProposals('sub', () => ({write: false, result: 'noop',}), 'test',)

		expect(result,).toBe('noop',)
		expect(writeProposalsPage,).not.toHaveBeenCalled()
		expect(broadcastProposalsChanged,).not.toHaveBeenCalled()
	})
})
