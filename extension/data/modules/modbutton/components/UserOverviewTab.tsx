/** User Overview tab for the ModButtonPopup: account info, flair, bans, and removed comments. */

import {useEffect, useState,} from 'react'

import {getFlairSelector,} from '../../../api/resources/flair'
import type {FlairSelectorResponse,} from '../../../api/resources/flair'
import {getAllModNotes,} from '../../../api/resources/modnotes'
import {getInfoBulk,} from '../../../api/resources/things'
import type {CommentData,} from '../../../api/resources/things'
import {aboutUser,} from '../../../api/resources/users'
import type {UserAbout,} from '../../../api/resources/users'
import {RelativeTime,} from '../../../shared/controls/RelativeTime'
import {SelectInput,} from '../../../shared/controls/SelectInput'
import {link,} from '../../../util/reddit/pageContext'

import {
	classifyCommentBody,
	formatBanDate,
	type ModNotesResult,
	processModNotes,
	truncateText,
} from './UserOverviewTab.helpers'
import css from './UserOverviewTab.module.css'

/** Props for the UserOverviewTab component. */
interface Props {
	user: string
	/** Subreddit to show by default; becomes the initial value of the sub selector. */
	defaultSub: string
	/** All subreddits the current user moderates, for the sub selector dropdown. */
	modSubs: string[]
}

/**
 * Renders an overview of a user: account info, current flair, ban history, and recent removed comments.
 * @param props Component props.
 */
export function UserOverviewTab ({user, defaultSub, modSubs,}: Props,) {
	const [selectedSub, setSelectedSub,] = useState(defaultSub,)

	// User info (global, doesn't change with sub)
	const [userInfo, setUserInfo,] = useState<UserAbout['data'] | null>(null,)
	const [userInfoError, setUserInfoError,] = useState<string | null>(null,)

	// Flair state
	const [flairCurrent, setFlairCurrent,] = useState<FlairSelectorResponse['current']>(null,)
	const [flairLoading, setFlairLoading,] = useState(true,)
	const [flairError, setFlairError,] = useState<string | null>(null,)

	// Mod notes state
	const [notesResult, setNotesResult,] = useState<ModNotesResult | null>(null,)
	const [notesLoading, setNotesLoading,] = useState(true,)
	const [notesError, setNotesError,] = useState<string | null>(null,)

	// Comment preview state
	const [commentPreviews, setCommentPreviews,] = useState<
		{
			fullname: string
			date: Date
			body: string | undefined
			author: string
			spam: boolean | undefined
			bannedBy: string | boolean | null | undefined
			permalink: string
		}[]
	>([],)
	const [previewsLoading, setPreviewsLoading,] = useState(false,)

	// Effect 1 — user info (runs once per user)
	useEffect(() => {
		let cancelled = false
		setUserInfo(null,)
		setUserInfoError(null,)
		aboutUser(user,).then((result,) => {
			if (cancelled) { return }
			setUserInfo(result.data,)
		},).catch((error: unknown,) => {
			if (cancelled) { return }
			setUserInfoError(error instanceof Error ? error.message : String(error,),)
		},)
		return () => {
			cancelled = true
		}
	}, [user,],)

	// Effect 2 — sub-scoped data (runs when user or selectedSub changes)
	useEffect(() => {
		let cancelled = false

		// Reset sub-scoped state to loading
		setFlairCurrent(null,)
		setFlairLoading(true,)
		setFlairError(null,)
		setNotesResult(null,)
		setNotesLoading(true,)
		setNotesError(null,)
		setCommentPreviews([],)
		setPreviewsLoading(false,)

		// Fire flair fetch
		getFlairSelector(selectedSub, user,).then((result,) => {
			if (cancelled) { return }
			setFlairCurrent(result.current,)
			setFlairLoading(false,)
		},).catch((error: unknown,) => {
			if (cancelled) { return }
			setFlairError(error instanceof Error ? error.message : String(error,),)
			setFlairLoading(false,)
		},)

		// Fire mod notes IIFE
		void (async () => {
			try {
				const allNotes = []
				for await (const note of getAllModNotes(selectedSub, user,)) {
					if (cancelled) { return }
					allNotes.push(note,)
				}
				if (cancelled) { return }

				const result = processModNotes(allNotes,)
				setNotesResult(result,)
				setNotesLoading(false,)

				const fullnames = result.recentRemovals
					.filter((r,) => r.redditId !== null)
					.map((r,) => r.redditId!)

				if (fullnames.length > 0 && !cancelled) {
					setPreviewsLoading(true,)
					const things = await getInfoBulk<CommentData>(fullnames,)
					if (cancelled) { return }

					// Build a date map from recentRemovals
					const dateMap = new Map<string, Date>(
						result.recentRemovals
							.filter((r,) => r.redditId !== null)
							.map((r,) => [r.redditId!, r.date,] as [string, Date,]),
					)

					const previews = things
						.map((thing,) => ({
							fullname: thing.data.name,
							date: dateMap.get(thing.data.name,) ?? new Date(thing.data.created_utc * 1000,),
							body: thing.data.body,
							author: thing.data.author,
							spam: thing.data.spam,
							bannedBy: thing.data.banned_by,
							permalink: thing.data.permalink,
						}))
						.sort((a, b,) => b.date.getTime() - a.date.getTime())

					setCommentPreviews(previews,)
					setPreviewsLoading(false,)
				}
			} catch (error: unknown) {
				if (cancelled) { return }
				setNotesError(error instanceof Error ? error.message : String(error,),)
				setNotesLoading(false,)
			}
		})()

		return () => {
			cancelled = true
		}
	}, [user, selectedSub,],)

	return (
		<div className={css.container}>
			{/* Sub selector */}
			<div className={css.subSelector}>
				<label htmlFor="overview-sub-select">Viewing:</label>
				<SelectInput
					id="overview-sub-select"
					value={selectedSub}
					disabled={notesLoading || flairLoading}
					onChange={(e,) => setSelectedSub(e.target.value,)}
				>
					{modSubs.map((subreddit,) => <option key={subreddit} value={subreddit}>{subreddit}</option>)}
				</SelectInput>
			</div>

			{/* Account header — global, doesn't change with sub */}
			<section className={css.section}>
				{userInfo
					? (
						<div className={css.accountHeader}>
							<a href={link(`/user/${encodeURIComponent(user,)}`,)}>/u/{user}</a>
							<span className={css.accountMeta}>
								{'· Account created '}
								<time dateTime={new Date(userInfo.created_utc * 1000,).toISOString()}>
									{formatBanDate(new Date(userInfo.created_utc * 1000,),)}
								</time>
							</span>
							{userInfo.is_suspended && <span className={css.suspendedBadge}>SUSPENDED</span>}
						</div>
					)
					: userInfoError
					? <p className={css.errorText}>{userInfoError}</p>
					: <p className={css.loadingText}>Loading…</p>}
			</section>

			{/* Flair */}
			<section className={css.section}>
				<h3 className={css.sectionHeading}>Flair</h3>
				{flairLoading
					? <p className={css.loadingText}>Loading…</p>
					: flairError
					? <p className={css.errorText}>{flairError}</p>
					: flairCurrent?.flair_text
					? <p>{flairCurrent.flair_text}</p>
					: <p className={css.mutedText}>No flair set</p>}
			</section>

			{/* Bans */}
			<section className={css.section}>
				<h3 className={css.sectionHeading}>
					Bans
					{notesResult?.currentlyBanned && <span className={css.currentBanBadge}>Currently banned</span>}
				</h3>
				{notesLoading
					? <p className={css.loadingText}>Loading…</p>
					: notesError
					? <p className={css.errorText}>{notesError}</p>
					: notesResult!.bans.length === 0
					? <p className={css.mutedText}>Never banned</p>
					: (
						<>
							<p className={css.banCount}>
								Banned {notesResult!.bans.length} time{notesResult!.bans.length !== 1 ? 's' : ''}
							</p>
							<table className={css.banTable}>
								<tbody>
									{notesResult!.bans.map((ban,) => (
										<tr key={ban.id}>
											<td className={css.banDuration}>{ban.duration}</td>
											<td className={css.banDate}>{formatBanDate(ban.date,)}</td>
											<td>
												<a href={link(`/user/${encodeURIComponent(ban.moderator,)}`,)}>
													/u/{ban.moderator}
												</a>
											</td>
											{ban.reason && <td className={css.banReason}>{ban.reason}</td>}
										</tr>
									))}
								</tbody>
							</table>
						</>
					)}
			</section>

			{/* Removed comments */}
			<section className={css.section}>
				<h3 className={css.sectionHeading}>Removed Comments</h3>
				{notesLoading
					? <p className={css.loadingText}>Loading…</p>
					: notesError
					? <p className={css.errorText}>{notesError}</p>
					: (
						<>
							<p className={css.removalCount}>
								{notesResult!.totalRemovalCount === 0
									? 'No removed comments'
									: `${notesResult!.totalRemovalCount} removed`}
							</p>
							{previewsLoading && <p className={css.loadingText}>Loading previews…</p>}
							{commentPreviews.length > 0 && (
								<table className={css.previewTable}>
									<tbody>
										{commentPreviews.map((preview,) => {
											const classification = classifyCommentBody({
												body: preview.body,
												author: preview.author,
												spam: preview.spam,
												bannedBy: preview.bannedBy,
											},)
											return (
												<tr key={preview.fullname}>
													<td className={css.previewDate}>
														<RelativeTime date={preview.date} />
													</td>
													<td className={css.previewBody}>
														{classification === 'deleted'
															? <span className={css.mutedText}>[deleted by user]</span>
															: classification === 'removed-by-reddit'
															? <span className={css.mutedText}>[removed by Reddit]</span>
															: (
																<a href={link(preview.permalink,)}>
																	&quot;{truncateText(preview.body ?? '', 300,)}&quot;
																</a>
															)}
													</td>
												</tr>
											)
										},)}
									</tbody>
								</table>
							)}
						</>
					)}
			</section>
		</div>
	)
}
