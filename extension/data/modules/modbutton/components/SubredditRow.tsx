/** One selectable subreddit row in the ModButtonPopup Role tab, with status badges and a pin toggle. */

import {classes,} from '../../../util/ui/reactMount'
import {SubStatus,} from '../schema'
import css from './ModButtonPopup.module.css'

/** Renders small inline badges showing the target user's ban/mod/contributor/muted status for a subreddit. */
export function StatusBadges ({status,}: {status: SubStatus | undefined},) {
	if (!status) { return null }
	if (status.loading) { return <span className={classes(css.statusBadge, css.statusLoading,)}>...</span> }
	return (
		<>
			{status.banned
				&& <span className={classes(css.statusBadge, css.statusBanned,)}>
					{status.daysLeft !== null ? 'temporarily banned' : 'permanently banned'}
				</span>}
			{status.isMod && <span className={classes(css.statusBadge, css.statusMod,)}>mod</span>}
			{status.isContributor
				&& <span className={classes(css.statusBadge, css.statusContributor,)}>contributor</span>}
			{status.isMuted && <span className={classes(css.statusBadge, css.statusMuted,)}>muted</span>}
		</>
	)
}

/** Props for the SubredditRow component. */
interface SubredditRowProps {
	subreddit: string
	checked: boolean
	/** When false, the checkbox is disabled (the current action doesn't apply to this sub). */
	applicable: boolean
	/** Tooltip explaining why the row is disabled; shown only when not applicable. */
	notApplicableTitle?: string | undefined
	/** Lazily-loaded status used for the badges; `undefined` before any load was requested. */
	status: SubStatus | undefined
	/** Whether the subreddit is currently pinned to the quick list. */
	pinned: boolean
	onToggle: (checked: boolean,) => void
	/** Called when the subreddit name is clicked to make it the active subreddit. */
	onActivate: () => void
	onPinToggle: () => void
}

/**
 * A single subreddit row in the Role tab's selection list: an include-checkbox,
 * the clickable subreddit name, status badges, and a pin/unpin star.
 */
export function SubredditRow ({
	subreddit,
	checked,
	applicable,
	notApplicableTitle,
	status,
	pinned,
	onToggle,
	onActivate,
	onPinToggle,
}: SubredditRowProps,) {
	return (
		<div className={css.subRow}>
			<input
				type="checkbox"
				aria-label={`Include /r/${subreddit} in action`}
				checked={checked}
				disabled={!applicable}
				title={!applicable ? notApplicableTitle : undefined}
				onChange={(event,) => onToggle(event.target.checked,)}
			/>
			<span
				className={css.subLabel}
				onClick={onActivate}
				title="Set as active subreddit"
			>
				/r/{subreddit}
			</span>
			<StatusBadges status={status} />
			<button
				type="button"
				className={css.pinBtn}
				title={pinned ? 'Remove from quick list' : 'Save to quick list'}
				onClick={onPinToggle}
			>
				{pinned ? '★' : '☆'}
			</button>
		</div>
	)
}
