/** Fixed-position popover that shows the 20 most recent mod-log entries for a specific moderator and action. */

import {useEffect, useRef,} from 'react'
import {nowInSeconds,} from '../../../util/data/time'
import {link,} from '../../../util/reddit/pageContext'
import css from '../modmatrix.module.css'
import {useDrilldownFetch,} from './useDrilldownFetch'

/**
 * Converts a UTC Unix timestamp to a human-readable relative time string (e.g. "5m ago").
 * @param utcSeconds Unix timestamp in seconds.
 */
function relativeTime (utcSeconds: number,): string {
	const diffSeconds = nowInSeconds() - utcSeconds
	if (diffSeconds < 60) { return `${diffSeconds}s ago` }
	const diffMinutes = Math.floor(diffSeconds / 60,)
	if (diffMinutes < 60) { return `${diffMinutes}m ago` }
	const diffHours = Math.floor(diffMinutes / 60,)
	if (diffHours < 24) { return `${diffHours}h ago` }
	const diffDays = Math.floor(diffHours / 24,)
	return `${diffDays}d ago`
}

/**
 * Converts a Reddit fullname (e.g. `t1_abc123`) to a relative URL path for links and comments.
 * @returns A path string, or `null` if the fullname type is not t1 or t3.
 */
function fullnameToPath (fullname: string,): string | null {
	if (fullname.startsWith('t1_',) || fullname.startsWith('t3_',)) {
		return link(`/comments/${fullname.slice(3,)}`,)
	}
	return null
}

/** Props for the {@link DrilldownPopover} component. */
interface Props {
	/** Username of the moderator whose actions are being shown. */
	mod: string
	/** Reddit API action type code (e.g. `removelink`). */
	actionCode: string
	/** Human-readable label for the action type. */
	actionTitle: string
	/** Absolute URL of the subreddit (e.g. `https://www.reddit.com/r/example/`). */
	subredditUrl: string
	/** Viewport X coordinate where the popover should appear. */
	x: number
	/** Viewport Y coordinate where the popover should appear. */
	y: number
	onClose: () => void
}

/**
 * Renders a fixed-position popover showing the 20 most recent mod-log entries for a given
 * moderator/action combination, with a link to view the full mod log.
 */
export function DrilldownPopover ({mod, actionCode, actionTitle, subredditUrl, x, y, onClose,}: Props,) {
	const {entries, error,} = useDrilldownFetch(subredditUrl, actionCode, mod,)
	const ref = useRef<HTMLDivElement>(null,)

	useEffect(() => {
		function onKeyDown (e: KeyboardEvent,) {
			if (e.key === 'Escape') { onClose() }
		}
		function onMouseDown (e: MouseEvent,) {
			const target = e.composedPath()[0] as Node
			if (ref.current && !ref.current.contains(target,)) { onClose() }
		}
		document.addEventListener('keydown', onKeyDown,)
		document.addEventListener('mousedown', onMouseDown,)
		return () => {
			document.removeEventListener('keydown', onKeyDown,)
			document.removeEventListener('mousedown', onMouseDown,)
		}
	}, [onClose,],)

	// Keep popover on screen
	const style: React.CSSProperties = {
		position: 'fixed',
		left: Math.min(x, window.innerWidth - 320,),
		top: Math.min(y, window.innerHeight - 200,),
		zIndex: 10001,
	}

	return (
		<div ref={ref} className={css.drilldown} style={style}>
			<div className={css.drilldownHeader}>
				<strong>{mod}</strong>
				{' - '}
				{actionTitle}
				<button type="button" className={css.drilldownClose} onClick={onClose} aria-label="Close">✕</button>
			</div>
			<div className={css.drilldownBody}>
				{entries == null && !error && <div className={css.drilldownLoading}>loading...</div>}
				{error && <div className={css.drilldownLoading}>error loading entries</div>}
				{entries != null && entries.length === 0 && (
					<div className={css.drilldownLoading}>no entries found</div>
				)}
				{entries != null && entries.length > 0 && (
					<ul className={css.drilldownList}>
						{entries.map((entry,) => (
							<li key={entry.id} className={css.drilldownEntry}>
								<span className={css.drilldownTime}>{relativeTime(entry.created_utc,)}</span>
								{entry.target_fullname
									? (
										<a
											href={fullnameToPath(entry.target_fullname,) ?? '#'}
											target="_blank"
											rel="noreferrer"
											className={css.drilldownLink}
										>
											{entry.target_body
												? entry.target_body.slice(0, 80,)
													+ (entry.target_body.length > 80 ? '...' : '')
												: entry.target_fullname}
										</a>
									)
									: <span className={css.drilldownLink}>{actionTitle}</span>}
							</li>
						))}
					</ul>
				)}
			</div>
			<div className={css.drilldownFooter}>
				<a
					href={`${subredditUrl}about/log?type=${actionCode}&mod=${mod}`}
					target="_blank"
					rel="noreferrer"
				>
					view all in mod log →
				</a>
			</div>
		</div>
	)
}
