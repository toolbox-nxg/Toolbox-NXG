/**
 * Per-key async task serialization. Tasks queued under the same key run one
 * after another in call order; tasks under different keys run independently.
 * Used to serialize wiki writes per subreddit so a later save can't race an
 * earlier in-flight one and silently discard its changes.
 */

/**
 * Creates an independent per-key queue. Each call to the returned function
 * chains `task` behind any still-running task for the same `key` and resolves
 * (or rejects) with that task's own outcome. A rejected task never blocks the
 * tasks queued after it.
 */
export function createPerKeyQueue (): <T,>(key: string, task: () => Promise<T>,) => Promise<T> {
	const tails = new Map<string, Promise<void>>()

	return function enqueue<T,> (key: string, task: () => Promise<T>,): Promise<T> {
		const previous = tails.get(key,) ?? Promise.resolve()
		const current = previous.then(() => task())
		// Absorb rejections on the stored tail so a failure doesn't block
		// subsequent tasks; callers still see the rejection on `current`.
		tails.set(key, current.then(() => {}, () => {},),)
		return current
	}
}
