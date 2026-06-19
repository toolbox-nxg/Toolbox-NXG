/** Tests for createLifecycle. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'
import {createLifecycle,} from './lifecycle'

describe('createLifecycle', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	},)
	afterEach(() => {
		vi.useRealTimers()
	},)

	describe('mount', () => {
		it('calls registered cleanup on cleanup()', async () => {
			const lc = createLifecycle()
			const fn = vi.fn()
			lc.mount(fn,)
			await lc.cleanup()
			expect(fn,).toHaveBeenCalledOnce()
		})

		it('clears the cleanup list so a second cleanup() is a no-op', async () => {
			const lc = createLifecycle()
			const fn = vi.fn()
			lc.mount(fn,)
			await lc.cleanup()
			await lc.cleanup()
			expect(fn,).toHaveBeenCalledOnce()
		})
	})

	describe('on', () => {
		it('adds and removes an event listener', async () => {
			const lc = createLifecycle()
			const target = new EventTarget()
			const handler = vi.fn()

			lc.on(target, 'click', handler,)
			target.dispatchEvent(new Event('click',),)
			expect(handler,).toHaveBeenCalledOnce()

			await lc.cleanup()
			target.dispatchEvent(new Event('click',),)
			expect(handler,).toHaveBeenCalledOnce() // still once
		})
	})

	describe('delegate', () => {
		it('fires only when the event target matches the selector', async () => {
			const lc = createLifecycle()
			const parent = document.createElement('div',)
			const child = document.createElement('button',)
			parent.appendChild(child,)
			document.body.appendChild(parent,)

			const handler = vi.fn()
			lc.delegate(parent, 'click', 'button', handler,)

			child.dispatchEvent(new Event('click', {bubbles: true,},),)
			expect(handler,).toHaveBeenCalledOnce()

			// click on parent (no button match)
			parent.dispatchEvent(new Event('click', {bubbles: true,},),)
			expect(handler,).toHaveBeenCalledOnce()

			document.body.removeChild(parent,)
		})

		it('removes the delegated listener on cleanup()', async () => {
			const lc = createLifecycle()
			const parent = document.createElement('div',)
			const child = document.createElement('button',)
			parent.appendChild(child,)
			document.body.appendChild(parent,)

			const handler = vi.fn()
			lc.delegate(parent, 'click', 'button', handler,)

			await lc.cleanup()
			child.dispatchEvent(new Event('click', {bubbles: true,},),)
			expect(handler,).not.toHaveBeenCalled()

			document.body.removeChild(parent,)
		})
	})

	describe('interval', () => {
		it('fires the handler and clears the interval on cleanup()', async () => {
			const lc = createLifecycle()
			const handler = vi.fn()
			lc.interval(handler, 1000,)

			vi.advanceTimersByTime(2500,)
			expect(handler,).toHaveBeenCalledTimes(2,)

			await lc.cleanup()
			vi.advanceTimersByTime(2000,)
			expect(handler,).toHaveBeenCalledTimes(2,) // stopped
		})
	})

	describe('timeout', () => {
		it('fires the handler and is cleared before firing on cleanup()', async () => {
			const lc = createLifecycle()
			const handler = vi.fn()
			lc.timeout(handler, 500,)

			await lc.cleanup()
			vi.advanceTimersByTime(1000,)
			expect(handler,).not.toHaveBeenCalled()
		})

		it('fires normally if not cleaned up', async () => {
			const lc = createLifecycle()
			const handler = vi.fn()
			lc.timeout(handler, 500,)
			vi.advanceTimersByTime(600,)
			expect(handler,).toHaveBeenCalledOnce()
		})
	})

	describe('cleanup order', () => {
		it('runs registered cleanups in reverse order', async () => {
			const lc = createLifecycle()
			const order: number[] = []
			lc.mount(() => {
				order.push(1,)
			},)
			lc.mount(() => {
				order.push(2,)
			},)
			lc.mount(() => {
				order.push(3,)
			},)
			await lc.cleanup()
			expect(order,).toEqual([3, 2, 1,],)
		})
	})

	describe('error aggregation', () => {
		it('throws if one cleanup throws', async () => {
			const lc = createLifecycle()
			lc.mount(() => {
				throw new Error('boom',)
			},)
			await expect(lc.cleanup(),).rejects.toThrow('boom',)
		})

		it('throws AggregateError if multiple cleanups throw', async () => {
			const lc = createLifecycle()
			lc.mount(() => {
				throw new Error('a',)
			},)
			lc.mount(() => {
				throw new Error('b',)
			},)
			await expect(lc.cleanup(),).rejects.toBeInstanceOf(AggregateError,)
		})

		it('still runs all cleanups even when one throws', async () => {
			const lc = createLifecycle()
			const fn = vi.fn()
			lc.mount(() => {
				throw new Error('oops',)
			},)
			lc.mount(fn,)
			await lc.cleanup().catch(() => {},)
			expect(fn,).toHaveBeenCalledOnce()
		})
	})
})
