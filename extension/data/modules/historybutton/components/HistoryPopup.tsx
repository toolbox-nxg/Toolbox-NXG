/** Draggable popup that displays a user's submission and comment history broken down by domain and subreddit. */
import {useState,} from 'react'
import {Provider,} from 'react-redux'

import {historyButton,} from '../../../framework/moduleIds'
import {GeneralButton,} from '../../../shared/controls/GeneralButton'
import {Window,} from '../../../shared/window/Window'
import store from '../../../store/index'
import {niceDateDiff,} from '../../../util/data/time'
import {link,} from '../../../util/reddit/pageContext'
import {useFetched, useSetting,} from '../../../util/ui/hooks'
import {classes, mountPopup,} from '../../../util/ui/reactMount'
import {getCommentHistoryData, getSubmissionHistoryData, getUserInfo,} from '../moduleapi'

import css from './historybutton.module.css'

/** Props for the HistoryPopup component. */
interface HistoryPopupProps {
	/** The Reddit username to show history for. */
	user: string
	/** The current subreddit context, used to highlight matching rows; null if not on a sub page. */
	subreddit: string | null
	/** Where the popup should initially appear on screen. */
	initialPosition: {top: number; left: number}
	onClose?: () => void
}

/** Returns base URLSearchParams shared by all Reddit search URLs: sort, feature, and optionally include_over_18. */
function baseSearchParams (includeNsfw: boolean,): URLSearchParams {
	return new URLSearchParams({
		sort: 'new',
		feature: 'legacy_search',
		...(includeNsfw ? {include_over_18: 'on',} : {}),
	},)
}

/**
 * Returns a CSS class name to visually flag over-representation in a single domain or subreddit.
 * Applies `warning` when ratio >= 10 % (with more than 4 posts), and `danger` when >= 20 %.
 */
const ratioClassName = (ratio: number, rawCount: number,) =>
	ratio >= 0.1 && rawCount > 4 ? (ratio >= 0.2 ? css.danger : css.warning) : ''

/** Formats a decimal ratio as a rounded percentage string (e.g. `0.253` -> `'25%'`). */
const asPercentage = (ratio: number,) => `${Math.round(ratio * 100,)}%`

/**
 * Renders a draggable window with tables showing domain and subreddit breakdown for the user's submission
 * and (optionally) comment history.
 */
export function HistoryPopup ({user, subreddit: currentSubreddit, initialPosition, onClose,}: HistoryPopupProps,) {
	const commentCount = parseInt(useSetting(historyButton, 'commentCount', '1000',), 10,)
	const includeNsfwSearches = useSetting(historyButton, 'includeNsfwSearches', false,)
	const alwaysComments = useSetting(historyButton, 'alwaysComments', true,)

	const userInfo = useFetched(getUserInfo(user,),)
	const submissionData = useFetched(getSubmissionHistoryData(user,),)
	const commentData = useFetched(getCommentHistoryData(user, commentCount,),)

	const [commentReportShown, setCommentReportShown,] = useState(alwaysComments,)

	if (!userInfo || !submissionData) {
		return (
			<Window title={`u/${user}`} draggable initialPosition={initialPosition} onClose={onClose}>
				<div className={css.windowContent}>Loading...</div>
			</Window>
		)
	}

	const hasSecondRow = (commentReportShown && commentData != null)
		|| Object.keys(submissionData.textLinkDomains,).length > 0

	return (
		<Window
			title={`u/${user}`}
			draggable
			initialPosition={initialPosition}
			onClose={onClose}
		>
			<div className={css.windowContent}>
				<div className={css.headerRow}>
					<span>
						<a href={link(`/user/${user}`,)} target="_blank" rel="noreferrer">{user}</a>{' '}
						<span>({userInfo.submissionKarma} | {userInfo.commentKarma})</span>
					</span>
					{!commentReportShown && (
						<GeneralButton onClick={() => setCommentReportShown(true,)}>
							comment history
						</GeneralButton>
					)}
				</div>
				<span>redditor for {niceDateDiff(userInfo.createdAt,)}</span>
				<p className={css.disclaimer}>
					<strong>Disclaimer:</strong> The information shown below is an <i>indication</i>{' '}
					not a complete picture, it lacks the context you would get from having a look at a person{'\''}s
					profile.
				</p>
				<b>Available history:</b> {submissionData.total} submissions
				{commentReportShown && commentData && (
					<span>, {commentData.total} comments</span>
				)}
			</div>
			<div className={css.row}>
				<div>
					<table className={css.table}>
						<thead>
							<tr>
								<th>domain submitted from</th>
								<th>count</th>
								<th>%</th>
							</tr>
						</thead>
						<tbody>
							{Object.entries(submissionData.domains,)
								.sort(([_, a,], [__, b,],) => b.count - a.count)
								.map(([domain, {count,},],) => {
									const ratio = count / submissionData.total
									const className = ratioClassName(ratio, count,)

									const domainSearchQuery = baseSearchParams(includeNsfwSearches,)
									let domainSearchURL
									const selfDomainMatch = domain.match(/^self\.(\w+)$/,)
									if (selfDomainMatch) {
										domainSearchQuery.set('q', `author:${user} is_self:1`,)
										domainSearchQuery.set('restrict_sr', 'on',)
										domainSearchURL = `/r/${selfDomainMatch[1]}/search?${domainSearchQuery}`
									} else {
										domainSearchQuery.set('q', `author:${user} site:${domain} is_self:0`,)
										domainSearchQuery.set('restrict_sr', 'off',)
										domainSearchURL = `/search?${domainSearchQuery}`
									}
									domainSearchURL = link(domainSearchURL,)

									return (
										<tr key={domain} className={className}>
											<td>
												<a
													target="_blank"
													rel="noreferrer"
													href={domainSearchURL}
													title={`view links ${user} recently submitted from '${domain}'`}
												>
													{domain}
												</a>
											</td>
											<td>{count}</td>
											<td>{asPercentage(ratio,)}</td>
										</tr>
									)
								},)}
						</tbody>
					</table>
				</div>
				<div>
					<table className={css.table}>
						<thead>
							<tr>
								<th>subreddit submitted to</th>
								<th>count</th>
								<th>%</th>
								<th>karma</th>
							</tr>
						</thead>
						<tbody>
							{Object.entries(submissionData.subreddits,)
								.sort(([_, a,], [__, b,],) => b.count - a.count)
								.map(([subreddit, {count, karma,},],) => {
									const ratio = count / submissionData.total
									const subredditSearchQuery = baseSearchParams(includeNsfwSearches,)
									subredditSearchQuery.set('q', `author:${user}`,)
									subredditSearchQuery.set('restrict_sr', 'on',)
									const searchURL = link(`/r/${subreddit}/search?${subredditSearchQuery}`,)

									return (
										<tr
											key={subreddit}
											className={classes(
												ratioClassName(ratio, count,),
												subreddit === currentSubreddit && css.currentSubreddit,
											)}
										>
											<td>
												<a
													target="_blank"
													rel="noreferrer"
													href={searchURL}
													title={`view links ${user} recently submitted to /r/${subreddit}`}
												>
													{subreddit}
												</a>
											</td>
											<td>{count}</td>
											<td>{asPercentage(ratio,)}</td>
											<td>{karma}</td>
										</tr>
									)
								},)}
						</tbody>
					</table>
				</div>
			</div>
			{hasSecondRow && (
				<div className={css.row}>
					{commentReportShown && commentData && (
						<div>
							<table className={css.table}>
								<thead>
									<tr>
										<th>subreddit commented in</th>
										<th>count</th>
										<th>%</th>
									</tr>
								</thead>
								<tbody>
									{Object.entries(commentData.subreddits,)
										.sort(([_, a,], [__, b,],) => b - a)
										.map(([subreddit, count,],) => {
											const ratio = count / commentData.total
											return (
												<tr
													key={subreddit}
													className={classes(
														ratioClassName(ratio, count,),
														subreddit === currentSubreddit && css.currentSubreddit,
													)}
												>
													<td>{subreddit}</td>
													<td>{count}</td>
													<td>{asPercentage(ratio,)}</td>
												</tr>
											)
										},)}
								</tbody>
							</table>
						</div>
					)}
					{commentReportShown && commentData && Object.keys(commentData.linkDomains,).length > 0 && (
						<div>
							<table className={css.table}>
								<thead>
									<tr>
										<th>domain linked in comments</th>
										<th>count</th>
									</tr>
								</thead>
								<tbody>
									{Object.entries(commentData.linkDomains,)
										.sort(([_, a,], [__, b,],) => b.count - a.count)
										.map(([domain, {count,},],) => (
											<tr key={domain}>
												<td>
													<a
														target="_blank"
														rel="noreferrer"
														href={`https://${domain}`}
													>
														{domain}
													</a>
												</td>
												<td>{count}</td>
											</tr>
										))}
								</tbody>
							</table>
						</div>
					)}
					{Object.keys(submissionData.textLinkDomains,).length > 0 && (
						<div>
							<table className={css.table}>
								<thead>
									<tr>
										<th>domain linked in selfposts</th>
										<th>count</th>
									</tr>
								</thead>
								<tbody>
									{Object.entries(submissionData.textLinkDomains,)
										.sort(([_, a,], [__, b,],) => b.count - a.count)
										.map(([domain, {count,},],) => (
											<tr key={domain}>
												<td>
													<a
														target="_blank"
														rel="noreferrer"
														href={`https://${domain}`}
													>
														{domain}
													</a>
												</td>
												<td>{count}</td>
											</tr>
										))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			)}
		</Window>
	)
}

/**
 * Mounts a {@link HistoryPopup} through the shared popup registry and returns a cleanup
 * function. Deduplicated per user: re-opening the same user's history reveals the live
 * popup (recovering it on-screen if it was dragged out of view) instead of mounting a
 * duplicate. Wraps the popup in the Redux `Provider` since `mountPopup` creates a fresh
 * React root that does not inherit the trigger button's context.
 * @param props Popup props; `onClose` is supplied by the popup manager.
 */
export function showHistoryPopup (props: Omit<HistoryPopupProps, 'onClose'>,) {
	return mountPopup(
		(onClose,) => (
			<Provider store={store}>
				<HistoryPopup {...props} onClose={onClose} />
			</Provider>
		),
		undefined,
		`history:${props.user}`,
	)
}
