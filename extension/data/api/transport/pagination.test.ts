/** Tests for fetchAllListingPages. */

import {describe, expect, it, vi,} from 'vitest'
import {fetchAllListingPages,} from './pagination'

/** Builds a mock listing response for one page. */
function page<T,> (children: T[], after: string | null = null,) {
	return {data: {children, after,},}
}

describe('fetchAllListingPages', () => {
	it('collects children across multiple pages until after cursor is absent', async () => {
		const fetchPage = vi.fn()
			.mockResolvedValueOnce(page([{id: 'a',}, {id: 'b',},], 'cursor1',),)
			.mockResolvedValueOnce(page([{id: 'c',},],),)

		await expect(fetchAllListingPages(fetchPage,),).resolves.toEqual([{id: 'a',}, {id: 'b',}, {id: 'c',},],)
		expect(fetchPage,).toHaveBeenCalledTimes(2,)
		expect(fetchPage,).toHaveBeenNthCalledWith(1, undefined,)
		expect(fetchPage,).toHaveBeenNthCalledWith(2, 'cursor1',)
	})

	it('returns an empty array when the first page has no children', async () => {
		const fetchPage = vi.fn().mockResolvedValue(page([],),)

		await expect(fetchAllListingPages(fetchPage,),).resolves.toEqual([],)
		expect(fetchPage,).toHaveBeenCalledTimes(1,)
	})

	it('stops early when maxCount items have been accumulated', async () => {
		const fetchPage = vi.fn()
			.mockResolvedValueOnce(page([{id: 'a',}, {id: 'b',},], 'cursor1',),)
			.mockResolvedValueOnce(page([{id: 'c',},],),)

		await expect(fetchAllListingPages(fetchPage, {maxCount: 2,},),).resolves.toEqual([{id: 'a',}, {id: 'b',},],)
		expect(fetchPage,).toHaveBeenCalledTimes(1,)
	})

	it('does not overshoot when a page puts results over maxCount', async () => {
		// First page gives 3 items; maxCount is 2 — should include all 3 from that page
		const fetchPage = vi.fn()
			.mockResolvedValueOnce(page([{id: 'a',}, {id: 'b',}, {id: 'c',},], 'cursor1',),)
			.mockResolvedValueOnce(page([{id: 'd',},],),)

		const result = await fetchAllListingPages(fetchPage, {maxCount: 2,},)
		expect(result,).toEqual([{id: 'a',}, {id: 'b',}, {id: 'c',},],)
		expect(fetchPage,).toHaveBeenCalledTimes(1,)
	})

	it('throws immediately on non-504 errors (default maxRetries=1)', async () => {
		const error = Object.assign(new Error('forbidden',), {response: {status: 403,},},)
		const fetchPage = vi.fn().mockRejectedValue(error,)

		await expect(fetchAllListingPages(fetchPage,),).rejects.toThrow('forbidden',)
		expect(fetchPage,).toHaveBeenCalledTimes(1,)
	})

	it('throws immediately on 504 when maxRetries is 1 (default)', async () => {
		const error = {response: {status: 504,},}
		const fetchPage = vi.fn().mockRejectedValue(error,)

		await expect(fetchAllListingPages(fetchPage,),).rejects.toEqual(error,)
		expect(fetchPage,).toHaveBeenCalledTimes(1,)
	})

	it('retries on 504 up to maxRetries total attempts then succeeds', async () => {
		const timeoutError = {response: {status: 504,},}
		const fetchPage = vi.fn()
			.mockRejectedValueOnce(timeoutError,)
			.mockRejectedValueOnce(timeoutError,)
			.mockRejectedValueOnce(timeoutError,)
			.mockRejectedValueOnce(timeoutError,)
			.mockResolvedValueOnce(page([{id: 'a',},],),)

		await expect(fetchAllListingPages(fetchPage, {maxRetries: 5,},),).resolves.toEqual([{id: 'a',},],)
		expect(fetchPage,).toHaveBeenCalledTimes(5,)
	})

	it('throws after exhausting all maxRetries attempts', async () => {
		const timeoutError = {response: {status: 504,},}
		const fetchPage = vi.fn().mockRejectedValue(timeoutError,)

		await expect(fetchAllListingPages(fetchPage, {maxRetries: 5,},),).rejects.toEqual(timeoutError,)
		expect(fetchPage,).toHaveBeenCalledTimes(5,)
	})

	it('resets the retry counter after each successful page', async () => {
		const timeoutError = {response: {status: 504,},}
		const fetchPage = vi.fn()
			// page 1: success
			.mockResolvedValueOnce(page([{id: 'a',},], 'cursor1',),)
			// page 2: 4 retries, then success
			.mockRejectedValueOnce(timeoutError,)
			.mockRejectedValueOnce(timeoutError,)
			.mockRejectedValueOnce(timeoutError,)
			.mockRejectedValueOnce(timeoutError,)
			.mockResolvedValueOnce(page([{id: 'b',},],),)

		await expect(fetchAllListingPages(fetchPage, {maxRetries: 5,},),).resolves.toEqual([{id: 'a',}, {id: 'b',},],)
		expect(fetchPage,).toHaveBeenCalledTimes(6,)
	})

	it('follows the after cursor even when a page returns empty children', async () => {
		// Reddit can return children: [] with a valid after cursor when items are filtered/removed.
		// The pagination must follow the cursor rather than stopping early.
		const fetchPage = vi.fn()
			.mockResolvedValueOnce({data: {children: [], after: 'cursor1',},},)
			.mockResolvedValueOnce(page([{id: 'a',},],),)

		await expect(fetchAllListingPages(fetchPage,),).resolves.toEqual([{id: 'a',},],)
		expect(fetchPage,).toHaveBeenCalledTimes(2,)
		expect(fetchPage,).toHaveBeenNthCalledWith(2, 'cursor1',)
	})
})
