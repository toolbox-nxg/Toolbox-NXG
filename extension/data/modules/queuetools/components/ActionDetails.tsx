/** Collapsible table of recent mod-log actions for a queue item. */
import {useState,} from 'react'

import {GeneralInlineButton,} from '../../../shared/controls/GeneralInlineButton'
import {formatRelativeTime,} from '../../../util/data/time'
import {actionFamily, actionLabels,} from '../../../util/reddit/modActions'
import type {ActionEntry,} from '../schema'
import css from './ActionDetails.module.css'

/**
 * Renders a collapsible table of recent mod-log actions for a queue item.
 * @param props Component properties.
 * @param actions Map of action ID to action data for this item.
 * @param initialShow Whether the table should start expanded.
 * @param postStateEntry Synthetic entry derived from the post's own approval/removal fields.
 */
export function ActionDetails (
	{actions, initialShow, postStateEntry,}: {
		actions: Record<string, ActionEntry>
		initialShow: boolean
		postStateEntry?: ActionEntry | null
	},
) {
	const [show, setShow,] = useState(initialShow,)
	return (
		<div className="toolbox-action-details">
			<GeneralInlineButton className="toolbox-show-action-table" onClick={() => setShow((s,) => !s)}>
				{show ? 'hide' : 'show'} recent actions
			</GeneralInlineButton>
			<table className={css.table} style={{display: show ? 'table' : 'none',}}>
				<tbody>
					<tr>{['Mod', 'Action', 'Details', 'Time',].map((h,) => <th key={h}>{h}</th>)}</tr>
					{[
						...(postStateEntry ? [postStateEntry,] : []),
						...Object.values(actions,).sort((a, b,) => b.created_utc - a.created_utc),
					].map((v,) => {
						const createdAt = new Date(v.created_utc * 1000,)
						const description = v.description ? ` : ${v.description}` : ''
						const family = actionFamily[v.action] ?? 'other'
						const rowClass = family === 'approval'
							? css.rowApproval
							: family === 'remove'
							? css.rowRemove
							: family === 'ban'
							? css.rowBan
							: css.row
						return (
							<tr key={v.id} className={rowClass}>
								<td>{v.mod}</td>
								<td>{actionLabels[v.action] ?? v.action}</td>
								<td>{v.details}{description}</td>
								<td>
									<time
										className="live-timestamp"
										dateTime={createdAt.toISOString()}
										title={createdAt.toLocaleString()}
									>
										{formatRelativeTime(createdAt,)}
									</time>
								</td>
							</tr>
						)
					},)}
				</tbody>
			</table>
		</div>
	)
}
