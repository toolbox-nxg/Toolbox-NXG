/** Presentational table of recent mod-log actions for a queue item. */
import {RelativeTime,} from '../../../shared/controls/RelativeTime'
import {actionFamily, actionLabels,} from '../../../util/reddit/modActions'
import type {ActionEntry,} from '../schema'
import css from './ActionDetails.module.css'

/**
 * Renders a table of recent mod-log actions for a queue item.
 * @param props Component properties.
 * @param actions Map of action ID to action data for this item.
 * @param postStateEntry Synthetic entry derived from the post's own approval/removal fields.
 */
export function ActionsTable (
	{actions, postStateEntry,}: {
		actions: Record<string, ActionEntry>
		postStateEntry?: ActionEntry | null
	},
) {
	return (
		<table className={css.table}>
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
								<RelativeTime date={createdAt} />
							</td>
						</tr>
					)
				},)}
			</tbody>
		</table>
	)
}
