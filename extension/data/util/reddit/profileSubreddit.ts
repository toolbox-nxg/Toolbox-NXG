/** Helpers for recognizing Reddit's user-profile pseudo-subreddits. */

/**
 * Whether a subreddit name is a user's profile pseudo-subreddit. Reddit names
 * the "subreddit" backing a user's profile `u_<username>`, and lists it among
 * the subs a user moderates (their own profile). Toolbox config and usernotes
 * don't apply there, so config/training reads should skip these rather than
 * issue doomed wiki requests for a page that has no toolbox wiki.
 * @param subreddit The subreddit name to test (without the `r/` prefix).
 */
export function isUserProfileSubreddit (subreddit: string,): boolean {
	return subreddit.startsWith('u_',)
}
