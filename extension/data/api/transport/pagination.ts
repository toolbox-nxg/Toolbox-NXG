/** Pagination helpers for Reddit listing endpoints. */

/**
 * Reports whether a caught value represents a 504 Gateway Timeout response,
 * which callers may safely retry. Accepts any thrown value - only objects
 * carrying a `response.status` of 504 match - so it works for both
 * `RequestError` instances and plain `{response: {status}}` shapes. Defined
 * here (rather than in `http`) so it carries no browser-extension dependency.
 * @param error The caught value to inspect.
 */
export function is504 (error: unknown,): boolean {
	return error != null && typeof error === 'object'
		&& (error as {response?: {status?: number}}).response?.status === 504
}

/**
 * Fetches all pages from a Reddit listing endpoint using an `after` cursor,
 * collecting `data.children` across all pages into a single array.
 *
 * Stops when the response has no `after` cursor, when a page returns no
 * children, or when `options.maxCount` items have been accumulated.
 *
 * @param fetchPage Called for each page; receives the `after` cursor from the
 *   previous response (undefined on the first call) and must return a Reddit
 *   listing response containing `data.children` and `data.after`.
 * @param options.maxCount Stop after accumulating at least this many items.
 * @param options.maxRetries Maximum total attempts per page when a 504 Gateway
 *   Timeout is encountered. Defaults to 1 (first failure throws immediately).
 */
export async function fetchAllListingPages<T,> (
	fetchPage: (after: string | undefined,) => Promise<{data: {children: T[]; after: string | null | undefined}}>,
	options?: {maxCount?: number | undefined; maxRetries?: number | undefined},
): Promise<T[]> {
	const {maxCount, maxRetries = 1,} = options ?? {}
	const results: T[] = []
	let after: string | undefined
	let tries = 1
	while (true) {
		let children: T[] = []
		let nextAfter: string | null | undefined
		try {
			const page = await fetchPage(after,)
			tries = 1
			children = page.data.children
			nextAfter = page.data.after
		} catch (error) {
			// Retry on 504 Gateway Timeout up to maxRetries total attempts.
			if (tries < maxRetries && is504(error,)) {
				tries++
				continue
			}
			throw error
		}
		if (children.length) {
			results.push(...children,)
			if (maxCount != null && results.length >= maxCount) { break }
		}
		if (!nextAfter) { break }
		after = nextAfter
	}
	return results
}
