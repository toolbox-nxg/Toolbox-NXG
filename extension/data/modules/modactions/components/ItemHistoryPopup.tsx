/**
 * Per-item "recent mod actions" popup. Shows the moderation-log entries taken on a single
 * post or comment, sourced from the subreddit mod log and filtered client-side to the target
 * item's fullname (Reddit's `about/log` does not reliably filter by a single fullname, so we
 * fetch a recent window and filter in memory - the same approach the modbar's cross-subreddit
 * {@link RecentActionsPopup} uses).
 *
 * Surfaced by the {@link FlatListModActions} "Recent actions" button. The native
 * `mod-content-actions[enable-previous-actions]` popover is rendered lazily (its shadow root is
 * empty until interacted with), so driving it is fragile; this Toolbox popup is the robust path.
 */

import {useEffect, useState,} from 'react'

import {getModLogEntries,} from '../../../api/resources/subreddits'
import {Backdrop,} from '../../../shared/window/Backdrop'
import {Window,} from '../../../shared/window/Window'
import {relativeTimeShort,} from '../../../util/data/time'
import {actionLabels,} from '../../../util/reddit/modActions'
import {mountPopup,} from '../../../util/ui/reactMount'
import type {ModLogEntry,} from '../modLog'
import {getRecentActions,} from '../recentActionsStore'
import css from './ItemHistoryPopup.module.css'

/** Renders the mod-log entries that target `itemId`, from the store's cached window when available. */
function ItemHistoryList ({subreddit, itemId,}: {subreddit: string; itemId: string},) {
	// The "Recent actions" button only shows once the store has fetched this sub's window, so the
	// cache is almost always primed here - reuse it instead of issuing a second identical request.
	const [entries, setEntries,] = useState<ModLogEntry[] | null>(() => getRecentActions(subreddit, itemId,) ?? null)
	const [error, setError,] = useState(false,)

	useEffect(() => {
		// Cache hit (including a legitimately empty result): nothing to fetch.
		if (entries !== null) { return }
		let cancelled = false
		getModLogEntries<ModLogEntry>(subreddit,).then((list,) => {
			if (cancelled) { return }
			setEntries(list.filter((entry,) => entry.target_fullname === itemId),)
		},).catch(() => {
			if (!cancelled) { setError(true,) }
		},)
		return () => {
			cancelled = true
		}
	}, [subreddit, itemId, entries,],)

	if (error) { return <div className={css.message}>Mod log unavailable.</div> }
	if (entries === null) { return <div className={css.message}>Loading...</div> }
	if (entries.length === 0) {
		return <div className={css.message}>No recent mod actions for this item.</div>
	}

	return (
		<ul className={css.list}>
			{entries.map((entry,) => (
				<li key={`${entry.target_fullname}:${entry.created_utc}:${entry.mod}`} className={css.row}>
					<span className={css.action}>{actionLabels[entry.action] ?? entry.action}</span>
					<a
						className={css.mod}
						href={`https://www.reddit.com/user/${entry.mod}`}
						target="_blank"
						rel="noreferrer"
					>
						/u/{entry.mod}
					</a>
					{entry.details && <span className={css.details}>{entry.details}</span>}
					<span className={css.time}>{relativeTimeShort(entry.created_utc,)}</span>
				</li>
			))}
		</ul>
	)
}

/**
 * Opens a modal popup listing the recent mod-log actions taken on a single item. Deduplicated
 * per item, so re-clicking the button reveals the existing popup instead of stacking a new one.
 * @param target Identifies the item: its subreddit and fullname.
 * @returns A cleanup that closes the popup.
 */
export function openItemHistory ({subreddit, itemId,}: {subreddit: string; itemId: string},): () => void {
	return mountPopup(
		(onClose,) => (
			<Backdrop onClickOutside={onClose}>
				<Window title="Recent actions" onClose={onClose}>
					<ItemHistoryList subreddit={subreddit} itemId={itemId} />
				</Window>
			</Backdrop>
		),
		undefined,
		`toolbox-item-history:${subreddit}:${itemId}`,
	)
}
