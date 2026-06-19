/** Reddit domain and subreddit string utilities. */

/**
 * Convert titles to a format usable in urls.
 * from r2.lib.utils import title_to_url
 */
export function title_to_url (title: string,): string {
	const max_length = 50

	title = title.replace(/\s+/g, '_',) // remove whitespace
	title = title.replace(/\W+/g, '',) // remove non-printables
	title = title.replace(/_+/g, '_',) // remove double underscores
	title = title.replace(/^_+|_+$/g, '',) // remove trailing underscores
	title = title.toLowerCase() // lowercase the title

	if (title.length > max_length) {
		title = title.slice(0, max_length,)
		title = title.replace(/_[^_]*$/g, '',)
	}

	return title || '_'
}

/**
 * Reduces the many ways a subreddit can be written down to just its bare name.
 */
export function cleanSubredditName (dirtySub: string,): string {
	return dirtySub.replace('/r/', '',).replace('r/', '',).replace('/', '',).replace('−', '',).replace('+', '',).trim()
}

/**
 * Strips the origin from any reddit.com URL (e.g. `https://old.reddit.com/r/...`
 * or `https://reddit.com/r/...`) returning only the pathname.
 * Relative paths are returned unchanged.
 */
export function normalizeRedditPath (path: string,): string {
	try {
		const url = new URL(path,)
		if (url.hostname === 'reddit.com' || url.hostname.endsWith('.reddit.com',)) {
			return url.pathname
		}
	} catch {
		// path is already relative - fall through
	}
	return path
}

/**
 * Derives a stable color from an arbitrary string (used to tint subreddit
 * post borders in shared queues).
 */
export function stringToColor (str: string,): string {
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		hash = str.charCodeAt(i,) + ((hash << 5) - hash)
	}

	let color = '#'
	for (let index = 0; index < 3; index++) {
		color += `00${(hash >> index * 8 & 0xFF).toString(16,)}`.slice(-2,)
	}

	return color
}
