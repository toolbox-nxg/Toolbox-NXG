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
 * One page of a listing, decoupled from the transport's envelope shape.
 *
 * Feature code consumes this instead of the raw Reddit listing envelope
 * (`{kind: 'Listing', data: {children, after}}`) so that paging semantics live in one
 * place rather than being re-derived at every call site.
 */
export interface Page<T,> {
	/** The items on this page, in the order the endpoint returned them. */
	items: T[]
	/**
	 * Cursor for the next page, or `null` when the listing is exhausted.
	 *
	 * Treat this as opaque: hand it back to the next fetch unchanged, and never parse,
	 * compare, or construct one. Today it is a Reddit `after` fullname; the format is
	 * owned by the transport and is not part of this contract.
	 */
	cursor: string | null
}

/** The Reddit REST listing envelope, as returned by `.json` listing endpoints. */
interface RestListingEnvelope<T,> {
	data: {
		children?: T[]
		after?: string | null
	}
}

/**
 * Converts a Reddit REST listing envelope into a transport-neutral {@link Page}.
 *
 * This is the single point where the REST envelope shape is unwrapped. Resource modules
 * call it so that `data.children` / `data.after` never reach feature code.
 * @param envelope The raw listing response.
 */
export function pageFromListing<T,> (envelope: RestListingEnvelope<T>,): Page<T> {
	return {
		items: envelope.data.children ?? [],
		cursor: envelope.data.after ?? null,
	}
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
