/**
 * Subreddit-name helpers. Subreddit names are case-insensitive, so anywhere we compare a
 * stored subreddit against a live one (e.g. the current subreddit against a proposal's
 * subreddit, when filtering or grouping the review queue) we must compare case-folded.
 */

/** True when two names refer to the same subreddit, ignoring case. */
export function sameSub (a: string, b: string,): boolean {
	return a.toLowerCase() === b.toLowerCase()
}
