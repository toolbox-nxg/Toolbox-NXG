/**
 * Username helpers. Reddit usernames are case-insensitive, so anywhere we compare
 * a stored username against a live one (proposer vs. reviewer, claim holder vs.
 * releaser, the current user against a set) we must compare case-folded — a casing
 * mismatch must never decide an authorization check.
 */

/** Case-folds a username to its canonical (lowercase) form for comparison or keying. */
export function normalizeUsername (name: string,): string {
	return name.toLowerCase()
}

/** True when two usernames refer to the same Reddit user, ignoring case. */
export function sameUsername (a: string, b: string,): boolean {
	return normalizeUsername(a,) === normalizeUsername(b,)
}
