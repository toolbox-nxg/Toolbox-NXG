/** Tests for createDeferredProcessQueue and mapWithConcurrency. */

// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

import {createDeferredProcessQueue, mapWithConcurrency,} from './async'

describe('mapWithConcurrency', () => {
	it('preserves input order in the results', async () => {
		const out = await mapWithConcurrency([1, 2, 3, 4,], 2, async (n,) => n * 10,)
		expect(out,).toEqual([10, 20, 30, 40,],)
	})

	it('never runs more than `limit` tasks at once', async () => {
		let active = 0
		let peak = 0
		const release: Array<() => void> = []
		const tasks = mapWithConcurrency(Array.from({length: 6,}, (_, i,) => i,), 2, async () => {
			active++
			peak = Math.max(peak, active,)
			// Hold the task open until explicitly released so overlap is observable.
			await new Promise<void>((resolve,) => release.push(resolve,))
			active--
		},)
		// Drain the held tasks wave by wave: settle microtasks, release whatever is
		// waiting, repeat until the pool finishes. Capped so a bug can't hang the test.
		let settled = false
		void tasks.then(() => {
			settled = true
		},)
		for (let i = 0; i < 50 && !settled; i++) {
			await Promise.resolve()
			release.splice(0,).forEach((fn,) => fn())
		}
		await tasks
		expect(peak,).toBe(2,) // two workers for six items
	})

	it('treats a limit below 1 as a single worker and handles empty input', async () => {
		expect(await mapWithConcurrency([], 4, async (n,) => n,),).toEqual([],)
		expect(await mapWithConcurrency([1, 2,], 0, async (n,) => n,),).toEqual([1, 2,],)
	})
})

describe('createDeferredProcessQueue', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	},)
	afterEach(() => {
		vi.useRealTimers()
	},)

	it('collapses concurrent calls into one bulk call', async () => {
		const bulk = vi.fn().mockResolvedValue(['res1', 'res2',],)
		const fn = createDeferredProcessQueue(bulk, 100,)

		const p1 = fn('a',)
		const p2 = fn('b',)

		await vi.runAllTimersAsync()

		expect(bulk,).toHaveBeenCalledTimes(1,)
		expect(bulk,).toHaveBeenCalledWith(['a', 'b',],)
		expect(await p1,).toBe('res1',)
		expect(await p2,).toBe('res2',)
	})

	it('delivers each result to the correct caller', async () => {
		const bulk = vi.fn().mockResolvedValue([10, 20, 30,],)
		const fn = createDeferredProcessQueue(bulk, 100,)

		const [p1, p2, p3,] = [fn('x',), fn('y',), fn('z',),]
		await vi.runAllTimersAsync()

		expect(await p1,).toBe(10,)
		expect(await p2,).toBe(20,)
		expect(await p3,).toBe(30,)
	})

	it('propagates bulk errors to all callers', async () => {
		const bulk = vi.fn().mockRejectedValue(new Error('bulk failed',),)
		const fn = createDeferredProcessQueue(bulk, 100,)

		const p1 = fn('a',)
		const p2 = fn('b',)

		// Attach before advancing timers to avoid "unhandled rejection" warnings
		const check1 = expect(p1,).rejects.toThrow('bulk failed',)
		const check2 = expect(p2,).rejects.toThrow('bulk failed',)
		await vi.runAllTimersAsync()
		await check1
		await check2
	})

	it('flushes immediately at maxQueueLength', async () => {
		const bulk = vi.fn().mockResolvedValue(['r1', 'r2',],)
		const fn = createDeferredProcessQueue(bulk, 1000, 2,)

		const p1 = fn('a',)
		const p2 = fn('b',) // triggers flush at maxQueueLength=2

		// No timer advance needed — flushed synchronously on 2nd call
		expect(bulk,).toHaveBeenCalledTimes(1,)

		await vi.runAllTimersAsync()
		expect(await p1,).toBe('r1',)
		expect(await p2,).toBe('r2',)
	})

	it('sends separate bulk calls for items queued after a flush', async () => {
		const bulk = vi.fn()
			.mockResolvedValueOnce(['first',],)
			.mockResolvedValueOnce(['second',],)
		const fn = createDeferredProcessQueue(bulk, 100,)

		const p1 = fn('a',)
		await vi.runAllTimersAsync()

		const p2 = fn('b',)
		await vi.runAllTimersAsync()

		expect(bulk,).toHaveBeenCalledTimes(2,)
		expect(await p1,).toBe('first',)
		expect(await p2,).toBe('second',)
	})

	it('with key matching: rejects callers whose key is absent and resolves those present', async () => {
		// 'a' was requested but omitted; 'b' was returned — order must not matter
		const bulk = vi.fn().mockResolvedValue([{id: 'b', value: 'res_b',},],)
		const fn = createDeferredProcessQueue(
			bulk,
			100,
			Infinity,
			{getItemKey: (item,) => item, getResultKey: (result,) => result.id,},
		)

		const p1 = fn('a',)
		const p2 = fn('b',)

		const check1 = expect(p1,).rejects.toThrow('No result returned for item: a',)
		await vi.runAllTimersAsync()

		await check1
		expect(await p2,).toEqual({id: 'b', value: 'res_b',},)
	})

	it('without key matching: rejects trailing callers when bulk returns fewer results', async () => {
		const bulk = vi.fn().mockResolvedValue(['res_a',],) // 1 result for 2 items
		const fn = createDeferredProcessQueue(bulk, 100,)

		const p1 = fn('a',)
		const p2 = fn('b',)

		const check2 = expect(p2,).rejects.toThrow('No result returned for queued item at index 1',)
		await vi.runAllTimersAsync()

		expect(await p1,).toBe('res_a',)
		await check2
	})
})
