/**
 * Page-session cache mapping removed things to the modmail message that
 * delivered their removal reason.
 *
 * When a removal reason is sent as modmail, the send response carries the new
 * conversation's id. The removal pipeline records `permalink -> conversation
 * URL` here so that a usernote added *later in the same page session* (via
 * the add-note popup) can still attach the removal message link, even though
 * the modmail send happened in a different flow. The cache is a plain
 * module-level map, so it lives exactly as long as the page: a refresh or
 * navigation clears it, which is the intended lifetime - after that the
 * association is no longer trustworthy.
 */

/** Cached `normalized permalink -> message URL` entries for this page session. */
const messageLinks = new Map<string, string>()

/**
 * Normalizes a permalink into a stable cache key. Permalinks for the same
 * thing arrive in different shapes depending on the source (absolute vs
 * subreddit-relative, with or without a trailing slash), so the key is the
 * lowercased pathname with no trailing slash.
 * @param permalink Absolute URL or site-relative path; empty input yields ''.
 */
export function normalizePermalinkKey (permalink: string,): string {
	if (!permalink) { return '' }
	let path = permalink
	// Strip the origin from absolute URLs; tolerate malformed input.
	if (/^https?:\/\//.test(permalink,)) {
		try {
			path = new URL(permalink,).pathname
		} catch {
			return ''
		}
	}
	// Drop any query/hash that survived (relative inputs skip the URL parse).
	path = path.split(/[?#]/, 1,)[0]!
	return path.replace(/\/+$/, '',).toLowerCase()
}

/**
 * Records the removal message URL for a removed thing, so later note
 * creation can look it up by any permalink form of that thing.
 * @param permalinks Permalinks identifying the removed thing (e.g. the
 *   comment permalink and its parent post link); falsy entries are skipped.
 * @param messageLink Full URL of the modmail conversation.
 */
export function rememberMessageLink (permalinks: (string | undefined)[], messageLink: string,) {
	if (!messageLink) { return }
	for (const permalink of permalinks) {
		const key = normalizePermalinkKey(permalink ?? '',)
		if (key) { messageLinks.set(key, messageLink,) }
	}
}

/**
 * Looks up the removal message URL recorded for a thing this page session.
 * @param permalink Any permalink form of the thing.
 * @returns The message URL, or undefined when none was recorded.
 */
export function getMessageLink (permalink: string,): string | undefined {
	const key = normalizePermalinkKey(permalink,)
	return key ? messageLinks.get(key,) : undefined
}

/** Clears all cached message links (for tests). */
export function clearMessageLinks () {
	messageLinks.clear()
}
