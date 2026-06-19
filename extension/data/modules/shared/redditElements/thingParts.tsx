/**
 * Shared building blocks for the TBComment and TBSubmission custom-view components.
 * Both render a Reddit "thing" (comment or submission) and duplicated this logic; it
 * lives here so the two stay in sync. Each piece preserves the exact markup the two
 * components produced individually.
 */

import {useEffect, useState,} from 'react'
import browser from 'webextension-polyfill'

import type {TbModqueueMessage,} from '../../../background/messages'

import {link,} from '../../../util/reddit/pageContext'

/** A `[reason, moderator]` report tuple as returned by the Reddit API. */
type ReportTuple = [string, string,]

/**
 * On mount, asks the background page whether a removed/spammed thing is still sitting in
 * the modqueue (so mod-action buttons can be offered). Returns the resolved flag.
 * @param thing The raw Reddit API thing data (`comment.data` / `submission.data`).
 * @param status The derived moderation status from {@link deriveThingStatus}.
 */
export function useFilteredFromQueue (thing: any, status: string,): boolean {
	const [filteredFromQueue, setFilteredFromQueue,] = useState(false,)

	useEffect(() => {
		if (status === 'removed' || status === 'spammed') {
			browser.runtime.sendMessage(
				{
					action: 'toolbox-modqueue',
					subreddit: thing.subreddit,
					thingName: thing.name,
					thingTimestamp: thing.created_utc,
				} satisfies TbModqueueMessage,
			).then((result,) => {
				if (result) { setFilteredFromQueue(true,) }
			},)
		}
	}, [status, thing,],)

	return filteredFromQueue
}

/** Maps a thing's `likes` value to a vote-state class fragment. */
export function getVoteState (likes: boolean | null,): 'liked' | 'disliked' | 'neutral' {
	if (likes !== null && !likes) { return 'disliked' }
	if (likes) { return 'liked' }
	return 'neutral'
}

/**
 * Computes the author status class and the inline author-attribute badges (submitter,
 * admin, moderator, unknown distinguish) for a thing's tagline.
 * @param thing The raw Reddit API thing data.
 * @param submitterHref Where the "S" (submitter) badge links - the thread permalink for
 *   comments, the post permalink for submissions.
 */
export function buildAuthorAttrs (
	thing: any,
	submitterHref: string,
): {authorStatus: string; authorAttrs: React.ReactNode[]} {
	let authorStatus = 'toolbox-regular'
	const authorAttrs: React.ReactNode[] = []
	if (thing.is_submitter) {
		authorStatus = 'toolbox-submitter'
		authorAttrs.push(
			<a key="s" className="toolbox-submitter" title="submitter" href={submitterHref}>S</a>,
		)
	}
	if (thing.distinguished) {
		authorStatus = `toolbox-${thing.distinguished}`
		if (thing.distinguished === 'admin') {
			authorAttrs.push(
				<span key="a" className="toolbox-admin" title="reddit admin, speaking officially">A</span>,
			)
		} else if (thing.distinguished === 'moderator') {
			authorAttrs.push(
				<a
					key="m"
					className="toolbox-moderator"
					title={`moderator of /r/${thing.subreddit}, speaking officially`}
					href={link(`/r/${thing.subreddit}/about/moderators`,)}
				>
					M
				</a>,
			)
		} else {
			authorAttrs.push(
				<a key="u" className="toolbox-unknown" title={`Unknown distinguish type ${thing.distinguished}`}>
					{thing.distinguished}
				</a>,
			)
		}
	}
	return {authorStatus, authorAttrs,}
}

/** Props for {@link ThingReports}. */
interface ThingReportsProps {
	/** User report tuples (`[reason, reporter]`). */
	userReports: ReportTuple[]
	/** Mod report tuples (`[reason, moderator]`). */
	modReports: ReportTuple[]
	/** Whether user reports are being ignored on this thing. */
	ignoreReports: boolean
	/** Class for each user-report `<li>` (differs between comment and submission markup). */
	userReportClass: string
}

/**
 * Renders the user-reports list, the "reports ignored" notice, and the mod-reports list
 * for a thing, in that order. Each section is gated exactly as the original components.
 */
export function ThingReports ({userReports, modReports, ignoreReports, userReportClass,}: ThingReportsProps,) {
	return (
		<>
			{userReports.length > 0 && !ignoreReports && (
				<ul className="toolbox-user-reports">
					<li>user reports</li>
					{userReports.map((report, i,) => (
						<li key={i} className={userReportClass}>
							<strong>{report[1]} :</strong> {report[0]}
						</li>
					))}
				</ul>
			)}
			{ignoreReports && (
				<span className="toolbox-ignored-user-reports">
					reports ignored ({userReports.length})
				</span>
			)}
			{modReports.length > 0 && (
				<ul className="toolbox-user-reports">
					<li>mod reports</li>
					{modReports.map((report, i,) => (
						<li key={i} className="toolbox-mod-report">
							<strong>{report[1]} :</strong> {report[0]}
						</li>
					))}
				</ul>
			)}
		</>
	)
}
