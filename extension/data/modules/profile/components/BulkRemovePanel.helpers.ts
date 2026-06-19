/** Scan-and-remove loop backing the profile bulk-remove panel. */
import {removeThing,} from '../../../api/resources/things'
import {getUserListingPage,} from '../../../api/resources/users'
import {registerItemSubreddit, unregisterItemSubreddit,} from '../../../util/infra/captureGuard'

/** Running totals reported back to the panel as the scan progresses. */
export interface BulkRemoveProgress {
	/** How many history items have been scanned so far (across all subreddits). */
	scanned: number
	/** How many items have actually been removed so far. */
	removed: number
}

/** Options controlling and observing a {@link bulkRemoveUserContent} run. */
export interface BulkRemoveOptions {
	/** Polled before each page and each item; return true to stop the scan early. */
	isCancelled: () => boolean
	/** Called after each page is scanned and after each successful removal. */
	onProgress: (progress: BulkRemoveProgress,) => void
}

/**
 * Scans a user's full overview history and removes every non-removed item that
 * belongs to `subreddit`. Errors propagate to the caller (the panel logs them).
 *
 * The fetched items aren't DOM-attached, so the training-mode capture guard can't
 * resolve their subreddit from the fullname. Every kept item is in `subreddit`
 * (filtered below), so we register that mapping for the guard before each removal
 * and clean it up after - mirroring the modbutton bulk-remove path. Without this,
 * a trainee sandboxed in some OTHER subreddit would trip the guard's
 * "unresolved sub + sandboxed somewhere" fail-closed branch on the first removal and
 * abort the whole scan, even though the target subreddit isn't sandboxed. (A trainee
 * sandboxed in `subreddit` itself is refused upfront by the panel, so the loop never
 * runs for them.)
 * @param subreddit Target subreddit; only this subreddit's items are removed.
 * @param user Reddit username whose content is being removed.
 * @param opts Cancellation and progress callbacks.
 */
export async function bulkRemoveUserContent (
	subreddit: string,
	user: string,
	opts: BulkRemoveOptions,
): Promise<void> {
	let totalRemoved = 0
	let totalScanned = 0
	let after: string | undefined

	while (!opts.isCancelled()) {
		// eslint-disable-next-line no-await-in-loop
		const data: any = await getUserListingPage(user, 'overview', {
			raw_json: '1',
			after: after ?? '',
			sort: 'new',
			limit: '100',
			t: 'all',
		},)
		const children: any[] = data.data.children ?? []
		totalScanned += children.length
		opts.onProgress({scanned: totalScanned, removed: totalRemoved,},)

		for (const item of children) {
			if (opts.isCancelled()) { break }
			if (item.data?.subreddit?.toLowerCase() !== subreddit.toLowerCase()) { continue }
			if (item.data?.banned_by) { continue }
			const fullname: string = item.data.name
			registerItemSubreddit(subreddit, fullname,)
			try {
				// eslint-disable-next-line no-await-in-loop
				await removeThing(fullname,)
			} finally {
				unregisterItemSubreddit(fullname,)
			}
			totalRemoved++
			opts.onProgress({scanned: totalScanned, removed: totalRemoved,},)
		}

		if (!data.data.after || opts.isCancelled()) { break }
		after = data.data.after
	}
}
