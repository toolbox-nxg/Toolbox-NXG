import {describe, expect, it,} from 'vitest'

import {createPerKeyQueue,} from './perKeyQueue'

/** Returns a promise plus its externally-callable resolve/reject handles. */
function deferred<T,> () {
	let resolve!: (value: T,) => void
	let reject!: (reason?: unknown,) => void
	const promise = new Promise<T>((res, rej,) => {
		resolve = res
		reject = rej
	},)
	return {promise, resolve, reject,}
}

describe('createPerKeyQueue', () => {
	it('runs tasks for the same key strictly in order', async () => {
		const enqueue = createPerKeyQueue()
		const order: string[] = []
		const first = deferred<void>()

		const a = enqueue('sub', async () => {
			order.push('a-start',)
			await first.promise
			order.push('a-end',)
		},)
		const b = enqueue('sub', async () => {
			order.push('b',)
		},)

		// b must not start while a is still pending.
		await Promise.resolve()
		expect(order,).toEqual(['a-start',],)

		first.resolve()
		await Promise.all([a, b,],)
		expect(order,).toEqual(['a-start', 'a-end', 'b',],)
	})

	it('runs tasks for different keys independently', async () => {
		const enqueue = createPerKeyQueue()
		const order: string[] = []
		const blocker = deferred<void>()

		const a = enqueue('one', async () => {
			await blocker.promise
			order.push('one',)
		},)
		const b = enqueue('two', async () => {
			order.push('two',)
		},)

		await b
		expect(order,).toEqual(['two',],)
		blocker.resolve()
		await a
		expect(order,).toEqual(['two', 'one',],)
	})

	it('returns each task\'s own result', async () => {
		const enqueue = createPerKeyQueue()
		const a = enqueue('sub', async () => 1,)
		const b = enqueue('sub', async () => 'two',)
		expect(await a,).toBe(1,)
		expect(await b,).toBe('two',)
	})

	it('does not block later tasks when an earlier one rejects', async () => {
		const enqueue = createPerKeyQueue()
		const a = enqueue('sub', async () => {
			throw new Error('boom',)
		},)
		const b = enqueue('sub', async () => 'ok',)

		await expect(a,).rejects.toThrow('boom',)
		expect(await b,).toBe('ok',)
	})
})
