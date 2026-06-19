/** Slide-out drawer showing recent mod-log actions across all moderated subreddits. */

import {useEffect, useRef, useState,} from 'react'

import {getModLogEntries, type RedditModLogEntry,} from '../../../api/resources/subreddits'
import {Icon,} from '../../../shared/controls/Icon'
import {ShadowPortal,} from '../../../shared/window/ShadowPortal'
import {relativeTimeShort,} from '../../../util/data/time'
import {type ActionFamily, actionFamily, actionLabels,} from '../../../util/reddit/modActions'

import css from './RecentActionsPopup.module.css'

/** A single entry from the Reddit moderation log API. */
interface ModAction extends RedditModLogEntry {
	target_author: string
	target_title: string | null
	target_permalink: string | null
	subreddit: string
	description: string
}

/** Filter chip categories available in the Recent Actions drawer. */
type FilterCategory = 'all' | 'removes' | 'bans' | 'approvals'

/** In-memory cache entry for the mod log API response. */
interface CacheEntry {
	actions: ModAction[]
	/** Timestamp (ms) when the data was fetched, used to check the 60-second TTL. */
	ts: number
}

const cacheTtl = 60 * 1000

// Intentionally at module level - not inside the component - to avoid recreating the object on every render.
const familyRowClass: Record<ActionFamily, string> = {
	approval: css.rowApproval!,
	remove: css.rowRemove!,
	ban: css.rowBan!,
	other: css.row!,
}

/** Renders the "Recent mod actions" slide-out drawer with filtering and a refresh button. */
export function RecentActionsPopup ({onClose,}: {onClose: () => void},) {
	const [actions, setActions,] = useState<ModAction[] | null>(null,)
	const [error, setError,] = useState<string | null>(null,)
	const [refreshKey, setRefreshKey,] = useState(0,)
	const [filter, setFilter,] = useState<FilterCategory>('all',)
	const cacheRef = useRef<CacheEntry | null>(null,)

	useEffect(() => {
		setActions(null,)
		setError(null,)
		if (cacheRef.current && Date.now() - cacheRef.current.ts < cacheTtl) {
			setActions(cacheRef.current.actions,)
			return
		}
		getModLogEntries<ModAction>('mod', '50',).then((list,) => {
			cacheRef.current = {actions: list, ts: Date.now(),}
			setActions(list,)
		},).catch((err: unknown,) => {
			setError(err instanceof Error ? err.message : String(err,),)
		},)
	}, [refreshKey,],)

	const handleRefresh = () => {
		cacheRef.current = null
		setRefreshKey((k,) => k + 1)
	}

	const filtered = actions?.filter((a,) => {
		if (filter === 'all') { return true }
		const family = actionFamily[a.action] ?? 'other'
		if (filter === 'removes') { return family === 'remove' }
		if (filter === 'bans') { return family === 'ban' }
		if (filter === 'approvals') { return family === 'approval' }
		return true
	},) ?? null

	const activeMods = actions
		? [
			...new Set(
				actions
					.filter((a,) => (Date.now() / 1000 - a.created_utc) < 15 * 60)
					.map((a,) => a.mod),
			),
		]
		: []

	return (
		<ShadowPortal>
			<div className={css.drawer}>
				<div className={css.header}>
					<span>Recent mod actions</span>
					<div className={css.headerButtons}>
						<button
							type="button"
							aria-label="Refresh"
							className={css.refreshButton}
							onClick={handleRefresh}
						>
							<Icon icon="refresh" />
						</button>
						<button type="button" aria-label="Close" className={css.headerButton} onClick={onClose}>
							<Icon icon="close" />
						</button>
					</div>
				</div>
				{activeMods.length > 0 && (
					<div className={css.activeMods}>
						<span className={css.activeModsLabel}>Active (15m):</span>
						{activeMods.map((mod,) => (
							<a
								key={mod}
								className={css.activeMod}
								href={`https://www.reddit.com/user/${mod}`}
								target="_blank"
								rel="noreferrer"
							>
								{mod}
							</a>
						))}
					</div>
				)}
				<div className={css.filters}>
					{(['all', 'removes', 'bans', 'approvals',] as FilterCategory[]).map((f,) => (
						<button
							key={f}
							type="button"
							className={`${css.chip}${filter === f ? ` ${css.chipActive}` : ''}`}
							onClick={() => setFilter(f,)}
						>
							{f.charAt(0,).toUpperCase() + f.slice(1,)}
						</button>
					))}
				</div>
				<div className={css.list}>
					{error && <div className={css.error}>Failed to load: {error}</div>}
					{!error && filtered === null && <div className={css.loading}>Loading...</div>}
					{!error && filtered !== null && filtered.length === 0 && (
						<div className={css.empty}>No actions.</div>
					)}
					{!error && filtered !== null && filtered.map((action, i,) => {
						const label = actionLabels[action.action] ?? action.action
						const family = actionFamily[action.action] ?? 'other'
						const rowClass = familyRowClass[family]
						const permalink = action.target_permalink
							? `https://www.reddit.com${action.target_permalink}`
							: null
						return (
							<div key={i} className={rowClass}>
								<span className={css.actionType}>{label}</span>
								<span className={css.sub}>/r/{action.subreddit}</span>
								{action.target_author && (
									<a
										className={css.author}
										href={`https://www.reddit.com/user/${action.target_author}`}
										target="_blank"
										rel="noreferrer"
									>
										/u/{action.target_author}
									</a>
								)}
								{permalink && (
									<a
										className={css.link}
										href={permalink}
										target="_blank"
										rel="noreferrer"
										title={action.target_title ?? undefined}
									>
										{action.target_title
											? action.target_title.substring(0, 40,)
												+ (action.target_title.length > 40 ? '...' : '')
											: 'link'}
									</a>
								)}
								<a
									className={css.mod}
									href={`https://www.reddit.com/user/${action.mod}`}
									target="_blank"
									rel="noreferrer"
								>
									/u/{action.mod}
								</a>
								<span className={css.time}>{relativeTimeShort(action.created_utc,)}</span>
							</div>
						)
					},)}
				</div>
			</div>
		</ShadowPortal>
	)
}
