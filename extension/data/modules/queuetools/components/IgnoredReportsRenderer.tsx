/** React renderer that shows a "show reports" link for items with ignored reports. */
import {useEffect, useState,} from 'react'

import type {UILocationContext,} from '../../../dom/uiLocations'
import {GeneralInlineButton,} from '../../../shared/controls/GeneralInlineButton'
import {drawPosition,} from '../../../util/ui/drawPosition'
import {showQueuetoolsReportsPopup,} from './QueuetoolsReportsPopup'

/** Mod/user report lists for a queue item whose reports have been ignored. */
export interface IgnoredReportData {
	modReports: Array<[string, string,]>
	userReports: Array<[string, string,]>
}

/**
 * Shows a "show reports" link for items whose reports have been ignored,
 * but only when the current user moderates the item's subreddit.
 * @param props Component properties.
 * @param context UILocationContext for the current queue item.
 * @param getReports Factory-provided fetch returning ignored-report data, or null when not applicable.
 */
export function IgnoredReportsRenderer (
	{context, getReports,}: {
		context: UILocationContext
		getReports: (subreddit: string, thingId: string,) => Promise<IgnoredReportData | null>
	},
) {
	const {thingId, subreddit, author, kind,} = context
	const [reportData, setReportData,] = useState<IgnoredReportData | null>(null,)

	useEffect(() => {
		if (!subreddit || !thingId) { return }
		let alive = true
		getReports(subreddit, thingId,).then((data,) => {
			if (alive) { setReportData(data,) }
		},).catch(() => {},)
		return () => {
			alive = false
		}
	}, [subreddit, thingId, getReports,],)

	if (!reportData || !author) { return null }

	return (
		<GeneralInlineButton
			onClick={(e,) => {
				const {topPosition, leftPosition,} = drawPosition(e.nativeEvent,)
				showQueuetoolsReportsPopup({
					initialPosition: {top: topPosition, left: leftPosition,},
					title: `Old reports on ${author}'s ${kind === 'comment' ? 'comment' : 'post'}`,
					modReports: reportData.modReports,
					userReports: reportData.userReports,
				},)
			}}
		>
			show reports
		</GeneralInlineButton>
	)
}
