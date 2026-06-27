/**
 * Combined per-queue-item renderer: shows "show recent actions" and "show reports" toggle
 * buttons side by side, each expanding its own collapsible table below.
 */
import {useState,} from 'react'

import type {UILocationContext,} from '../../../dom/uiLocations'
import {GeneralInlineButton,} from '../../../shared/controls/GeneralInlineButton'
import {ActionsTable,} from './ActionsTable'
import {type GetActions, type IgnoredReportData, useItemActions, useItemReports,} from './hooks'
import css from './QueueItemTables.module.css'
import {ReportsTable,} from './ReportsTable'

/**
 * Renders the inline action/report toggles and tables for a queue item.
 *
 * Each half is independently gated: the actions toggle appears only when the relevant per-state
 * toggle for the item (`showRecentActionsOnApproved` / `showRecentActionsOnRemoved`) is enabled and
 * the item has recent mod-log actions, and the reports toggle only when `showReportReasons` is
 * enabled and the item has ignored reports.
 * @param props Component properties.
 * @param context UILocationContext for the current queue item.
 * @param showRecentActionsOnApproved Whether the recent-actions table shows on approved (not removed) items.
 * @param showRecentActionsOnRemoved Whether the recent-actions table shows on removed items.
 * @param showReportReasons Whether the ignored-reports feature is enabled.
 * @param getActions Factory-provided function to retrieve cached mod-log actions.
 * @param checkIsMod Factory-provided check for whether the current user moderates a subreddit.
 * @param getThingData Factory-provided fetch for a thing's raw data fields.
 * @param getReports Factory-provided fetch returning ignored-report data, or null when not applicable.
 */
export function QueueItemTables (
	{
		context,
		showRecentActionsOnApproved,
		showRecentActionsOnRemoved,
		showReportReasons,
		getActions,
		checkIsMod,
		getThingData,
		getReports,
	}: {
		context: UILocationContext
		showRecentActionsOnApproved: boolean
		showRecentActionsOnRemoved: boolean
		showReportReasons: boolean
		getActions: GetActions
		checkIsMod: (subreddit: string,) => Promise<boolean>
		getThingData: (thingId: string,) => Promise<Record<string, unknown>>
		getReports: (subreddit: string, thingId: string,) => Promise<IgnoredReportData | null>
	},
) {
	// Pick the per-state toggle for the item's removed state: an approved/unactioned item uses the
	// "approved" toggle, a removed one uses the "removed" toggle.
	const showActionsFeature = context.isRemoved ? showRecentActionsOnRemoved : showRecentActionsOnApproved
	const itemActions = useItemActions(context, {getActions, checkIsMod, getThingData,}, showActionsFeature,)
	const reportData = useItemReports(context, getReports, showReportReasons,)

	const [showActions, setShowActions,] = useState(
		() => document.body.classList.contains('toolbox-show-actions',),
	)
	const [showReports, setShowReports,] = useState(false,)

	// useItemActions already returns null unless the item has a thingId+subreddit (and the host's
	// renderAtLocation callback guards on both), so a non-null itemActions implies they're present.
	const hasActions = !!itemActions
	const hasReports = !!reportData && !!context.author

	if (!hasActions && !hasReports) { return null }

	return (
		<div>
			<div className={css.toggles}>
				{hasActions && (
					<GeneralInlineButton onClick={() => setShowActions((s,) => !s)}>
						{showActions ? 'hide' : 'show'} recent actions
					</GeneralInlineButton>
				)}
				{hasReports && (
					<GeneralInlineButton onClick={() => setShowReports((s,) => !s)}>
						{showReports ? 'hide' : 'show'} reports
					</GeneralInlineButton>
				)}
			</div>
			{hasActions && showActions && (
				<ActionsTable actions={itemActions.actions} postStateEntry={itemActions.postStateEntry} />
			)}
			{hasReports && showReports && (
				<ReportsTable modReports={reportData.modReports} userReports={reportData.userReports} />
			)}
		</div>
	)
}
