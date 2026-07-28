/**
 * Applies the `expandReports` setting's site-table class on old Reddit.
 * Deliberately independent of mass-moderation activation: the setting promises reports are
 * expanded on load, so it must work with `autoActivate` off and the queue tools never started.
 */

import {getSiteTable,} from '../../../dom/oldReddit/page'
import type {MassModerationSettings,} from '../settings'

/** Class on `#siteTable` that forces every `.report-reasons` block open (see massmoderation.css). */
export const reportsExpandedClass = 'toolbox-reports-expanded'

/**
 * Expands queue report details when the `expandReports` setting is on.
 * No page-type gate: Reddit only renders `.report-reasons` for a moderator of the sub in
 * question, so the class is inert everywhere else.
 * @param settings Subset of Mass Moderation settings this factory reads.
 * @returns `{cleanup}`; `index.ts` passes `cleanup` to `lifecycle.mount`.
 */
export function createExpandReportsHandlers ({expandReports,}: Pick<MassModerationSettings, 'expandReports'>,) {
	const siteTable = getSiteTable()
	if (expandReports) { siteTable?.classList.add(reportsExpandedClass,) }

	return {
		/** Clears the class so teardown leaves Reddit's markup as it was found. */
		cleanup () {
			// Cleared unconditionally: the toolbar's runtime expand/collapse button mutates the same
			// class, so teardown must leave the page clean regardless of what the setting started as.
			siteTable?.classList.remove(reportsExpandedClass,)
		},
	}
}
