/** Iteration utilities: chunked array processing and async iterable helpers. */

/** Either a synchronous or an asynchronous iterable of `T`. */
export type MaybeAsyncIterable<T,> = Iterable<T> | AsyncIterable<T>

/**
 * Iterates over `array` in chunks of `chunkSize`, calling `call` on each item
 * with a `delay` ms pause between chunks to keep the UI responsive.
 * @param array The array-like to iterate (no-op when `null`).
 * @param chunkSize Number of items to process per chunk.
 * @param delay Milliseconds to pause between chunks.
 * @param call Callback run for each item; return `false` to stop early.
 * @param complete Optional callback invoked after all items have been processed.
 * @param start Optional callback invoked before the first chunk.
 * @returns `false` if arguments are invalid (same as calling `complete`).
 */
export function forEachChunked (
	array: ArrayLike<any> | null,
	chunkSize: number,
	delay: number,
	call: (item: any, index: number, array: ArrayLike<any>,) => any,
	complete?: () => void,
	start?: () => void,
) {
	function finish () {
		return complete ? complete() : false
	}

	if (array === null || chunkSize === null || chunkSize < 1 || delay === null || delay < 0 || call === null) {
		return finish()
	}

	let counter = 0

	function doChunk () {
		if (counter === 0 && start) {
			start()
		}
		for (let end = Math.min(array!.length, counter + chunkSize,); counter < end; counter++) {
			const ret = call(array![counter], counter, array!,)
			if (ret === false) {
				window.setTimeout(finish, delay,)
				return
			}
		}
		if (counter < array!.length) {
			window.setTimeout(doChunk, delay,)
		} else {
			window.setTimeout(finish, delay,)
		}
	}

	window.setTimeout(doChunk, delay,)
}

/**
 * Iterates over `array` using `requestAnimationFrame` to spread processing over
 * multiple frames. Dynamically adjusts chunk size to target `framerate` FPS.
 * @param array The iterable to process.
 * @param process Callback run for each item.
 * @param options.size Initial items per frame.
 * @param options.framerate Target frames per second.
 * @param options.nerf Smoothing factor (0-1) for chunk size adjustment.
 * @returns A promise that resolves to the original iterable when done.
 */
export function forEachChunkedDynamic (
	array: Iterable<any>,
	process: (item: any,) => void,
	options?: {size?: number; framerate?: number; nerf?: number},
) {
	if (typeof process !== 'function') {
		return
	}
	const items = Array.from(array,)
	let start: number
	let stop: number
	let fr: number
	let started = false
	const opt = Object.assign({
		size: 25,
		framerate: 30,
		nerf: 0.9,
	}, options,)
	let size = opt.size as number
	const nerf = opt.nerf as number
	const framerate = opt.framerate as number

	const now = () => window.performance.now()

	const again = typeof window.requestAnimationFrame === 'function'
		? function (callback: FrameRequestCallback,) {
			window.requestAnimationFrame(callback,)
		}
		: function (callback: FrameRequestCallback,) {
			setTimeout(callback, 1000 / opt.framerate,)
		}

	function optimize () {
		stop = now()
		fr = 1000 / (stop - start)
		size = Math.ceil(size * (1 + (fr / framerate - 1) * nerf),)
		start = stop
	}

	return new Promise((resolve,) => {
		function doChunk () {
			if (started) {
				optimize()
			} else {
				started = true
			}

			items.splice(0, size,).forEach(process,)

			if (items.length) {
				return again(doChunk,)
			}
			return resolve(array,)
		}
		start = now()
		again(doChunk,)
	},)
}
