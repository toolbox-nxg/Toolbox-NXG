/** Shared helpers for page navigation so window.location manipulations are centralized. */

/**
 * Reloads the current page.
 * @param delayMs Optional delay in milliseconds before reloading (default: 0). Pass a non-zero
 *   value when there is UI feedback visible that the user needs time to read.
 */
export function reloadPage (delayMs = 0,): void {
	if (delayMs > 0) {
		setTimeout(() => window.location.reload(), delayMs,)
	} else {
		window.location.reload()
	}
}

/**
 * Navigates to the given URL (absolute or relative).
 */
export function navigateTo (url: string,): void {
	window.location.href = url
}

/**
 * Navigates to a subreddit moderation management page.
 * @param subreddit The subreddit name (without the `r/` prefix).
 * @param page Which moderation page to open.
 */
export function navigateToSubredditPage (
	subreddit: string,
	page: 'banned' | 'muted' | 'flair',
): void {
	window.location.href = `https://www.reddit.com/r/${encodeURIComponent(subreddit,)}/about/${page}/`
}
