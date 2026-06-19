/** Async utility functions: delays, debouncing, deferred batch queues, and async iteration helpers. */

/**
 * Produces a promise that settles once the given duration has elapsed.
 * @param ms Number of milliseconds to delay
 */
export const delay = (ms: number,): Promise<void> => new Promise((resolve,) => setTimeout(resolve, ms,))

/**
 * Wraps a function so bursts of calls within the timeout collapse into one.
 */
export function debounce<T extends (...args: any[]) => void,> (func: T, debounceTime = 100,): T {
	let timeout: ReturnType<typeof setTimeout> | undefined

	return function (this: unknown, ...args: Parameters<T>) {
		const functionCall = () => func.apply(this, args,)
		clearTimeout(timeout,)
		timeout = setTimeout(functionCall, debounceTime,)
	} as T
}

/**
 * Options for key-based result matching in {@link createDeferredProcessQueue}.
 * When provided, the queue uses these functions to correlate results back to
 * their callers by key instead of by position - required when the bulk
 * processor may return results in a different order than the inputs, or may
 * omit some entirely (e.g. Reddit's `/api/info` silently drops deleted things).
 */
export interface DeferredQueueMatchOptions<Item, Result,> {
	/** Extract a lookup key from a queued item. */
	getItemKey: (item: Item,) => string
	/** Extract a lookup key from a bulk result. */
	getResultKey: (result: Result,) => string
}

/**
 * Builds a batching queue: callers insert items one at a time, and processing
 * is held off until either the gap between inserts exceeds a set delay or the
 * queue reaches a maximum length. Each insert call returns a promise that
 * resolves with that specific item's processed result.
 *
 * The queue is constructed with a processing function that takes an array of
 * queued items and returns a promise resolving to the array of matching results.
 *
 * When `matchOptions` is provided, results are matched to callers by key rather
 * than by position. Callers whose key is absent from the bulk response receive
 * a rejected promise with a descriptive error. Without `matchOptions`, results
 * are matched positionally; any callers beyond the end of the results array are
 * also rejected.
 */
export function createDeferredProcessQueue<Item, Result,> (
	bulkProcess: (items: Item[],) => Promise<Result[]>,
	delayTime = 100,
	maxQueueLength = Infinity,
	matchOptions?: DeferredQueueMatchOptions<Item, Result>,
): (item: Item,) => Promise<Result> {
	let timeout: ReturnType<typeof setTimeout> | undefined
	let queue: {item: Item; resolve: (value: Result,) => void; reject: (error: any,) => void}[] = []

	const flushQueue = async () => {
		const queueSnapshot = queue
		queue = []

		let results: Result[]
		try {
			results = await bulkProcess(queueSnapshot.map((call,) => call.item),)
		} catch (error) {
			queueSnapshot.forEach((call,) => call.reject(error,))
			return
		}

		if (matchOptions) {
			const {getItemKey, getResultKey,} = matchOptions
			const resultMap = new Map(results.map((r,) => [getResultKey(r,), r,]),)
			queueSnapshot.forEach((call,) => {
				const key = getItemKey(call.item,)
				if (resultMap.has(key,)) {
					call.resolve(resultMap.get(key,)!,)
				} else {
					call.reject(new Error(`No result returned for item: ${key}`,),)
				}
			},)
		} else {
			results.forEach((result, i,) => queueSnapshot[i]!.resolve(result,))
			// Safety net: reject any callers beyond the end of the results array
			for (let i = results.length; i < queueSnapshot.length; i++) {
				queueSnapshot[i]!.reject(new Error(`No result returned for queued item at index ${i}`,),)
			}
		}
	}

	return (item,) =>
		new Promise((resolve, reject,) => {
			queue.push({item, resolve, reject,},)
			clearTimeout(timeout,)

			if (queue.length >= maxQueueLength) {
				flushQueue()
				return
			}

			timeout = setTimeout(flushQueue, delayTime,)
		},)
}

/**
 * Wraps an iterable so each yielded value becomes `{item, last}` where `last`
 * is true for the final item. Used by the pager to preload the next page.
 */
export async function* wrapWithLastValue<T,> (iterable: AsyncIterable<T> | Iterable<T>,) {
	const iterator: Iterator<T> | AsyncIterator<T> = (iterable as AsyncIterable<T>)[Symbol.asyncIterator]?.()
		?? (iterable as Iterable<T>)[Symbol.iterator]?.()
	let current = await iterator.next()
	while (!current.done) {
		const next = await iterator.next()
		yield {item: current.value, last: !!next.done,}
		current = next
	}
}

/**
 * Maps `items` through `fn` with at most `limit` calls in flight at once, preserving
 * input order in the result. A small bounded worker-pool so a fan-out doesn't start one
 * operation per item simultaneously (e.g. a cross-subreddit wiki read across dozens of
 * subs). `fn` is expected to handle its own errors - a rejection propagates and aborts
 * the batch.
 * @param items The inputs to map.
 * @param limit Maximum number of concurrent `fn` calls (coerced to at least 1).
 * @param fn The async mapper, receiving each item and its index.
 */
export async function mapWithConcurrency<T, R,> (
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number,) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length,)
	const width = Math.max(1, Math.floor(limit,),)
	let next = 0
	async function worker () {
		while (next < items.length) {
			const index = next++
			// `index < items.length` guarantees a defined element here.
			results[index] = await fn(items[index]!, index,)
		}
	}
	// Cap the pool at the work available so we never spin up idle workers.
	await Promise.all(Array.from({length: Math.min(width, items.length,),}, worker,),)
	return results
}
