/** User Overview tab for the ModButtonPopup: account info, flair, bans, and removed content. */

import {useEffect, useRef, useState,} from 'react'

import {getFlairSelector,} from '../../../api/resources/flair'
import type {FlairSelectorResponse,} from '../../../api/resources/flair'
import {getAllModNotes,} from '../../../api/resources/modnotes'
import {getInfoBulk,} from '../../../api/resources/things'
import {aboutUser,} from '../../../api/resources/users'
import type {UserAbout,} from '../../../api/resources/users'
import {RelativeTime,} from '../../../shared/controls/RelativeTime'
import {SelectInput,} from '../../../shared/controls/SelectInput'
import {link,} from '../../../util/reddit/pageContext'

import type {SubStatus,} from '../schema'
import {
	classifyCommentBody,
	createNotesAccumulator,
	finalizeNotes,
	formatShortDate,
	type ModNotesResult,
	type RemovalEntry,
	processNote,
	truncateText,
} from './UserOverviewTab.helpers'
import css from './UserOverviewTab.module.css'

/** Fields needed from the Reddit API for a removed comment or post preview. */
type PreviewData = {
	name: string
	created_utc: number
	author: string
	banned_by?: string | boolean | null
	permalink: string
	body?: string
	title?: string
}

/** Props for the UserOverviewTab component. */
interface Props {
	user: string
	/** Subreddit to show by default; becomes the initial value of the sub selector. */
	defaultSub: string
	/** All subreddits the current user moderates, for the sub selector dropdown. */
	modSubs: string[]
	/** Live per-subreddit status map from the popup, used to derive current ban state. */
	subStatuses: Map<string, SubStatus>
}

/**
 * Renders an overview of a user: account info, current flair, ban history, and recent removed content.
 * @param props Component props.
 */
export function UserOverviewTab ({user, defaultSub, modSubs, subStatuses,}: Props,) {
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

	// Content preview state (comments and posts combined, split in render)
	const [contentPreviews, setContentPreviews,] = useState<
		{
			fullname: string
			date: Date
			body: string | undefined
			title: string | undefined
			author: string
			bannedBy: string | boolean | null | undefined
			permalink: string
			contentType: 'comment' | 'post'
		}[]
	>([],)
	const [previewsLoading, setPreviewsLoading,] = useState(false,)

	// Per-subreddit notes cache: avoids re-fetching when switching back to a sub
	const notesCacheRef = useRef(new Map<string, ModNotesResult>(),)

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

		setFlairCurrent(null,)
		setFlairLoading(true,)
		setFlairError(null,)
		setNotesError(null,)
		setContentPreviews([],)
		setPreviewsLoading(false,)

		// Use cached notes immediately if available; otherwise start loading
		const cached = notesCacheRef.current.get(selectedSub,)
		if (cached) {
			setNotesResult(cached,)
			setNotesLoading(false,)
		} else {
			setNotesResult(null,)
			setNotesLoading(true,)
		}

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

		// Fire notes + previews IIFE
		void (async () => {
			try {
				let result: ModNotesResult
				if (cached) {
					result = cached
				} else {
					// Stream notes one-at-a-time (no accumulation), break once 3 removals found
					const acc = createNotesAccumulator()
					for await (const note of getAllModNotes(selectedSub, user, 'MOD_ACTION',)) {
						if (cancelled) { return }
						processNote(note, acc,)
						if (acc.recentRemovals.length >= 3) { break }
					}
					if (cancelled) { return }
					result = finalizeNotes(acc,)
					notesCacheRef.current.set(selectedSub, result,)
					setNotesResult(result,)
					setNotesLoading(false,)
				}

				const fullnames = result.recentRemovals
					.filter((r,): r is RemovalEntry & {redditId: string} => r.redditId !== null)
					.map((r,) => r.redditId)

				if (fullnames.length > 0 && !cancelled) {
					setPreviewsLoading(true,)
					const things = await getInfoBulk<PreviewData>(fullnames,)
					if (cancelled) { return }

					const dateMap = new Map<string, Date>(
						result.recentRemovals
							.filter((r,): r is RemovalEntry & {redditId: string} => r.redditId !== null)
							.map((r,) => [r.redditId, r.date,] as [string, Date,]),
					)
					const contentTypeMap = new Map<string, 'comment' | 'post'>(
						result.recentRemovals
							.filter((r,): r is RemovalEntry & {redditId: string} => r.redditId !== null)
							.map((r,) => [r.redditId, r.contentType,] as [string, 'comment' | 'post',]),
					)

					const previews = things
						.map((thing,) => ({
							fullname: thing.data.name,
							date: dateMap.get(thing.data.name,) ?? new Date(thing.data.created_utc * 1000,),
							body: thing.data.body,
							title: thing.data.title,
							author: thing.data.author,
							bannedBy: thing.data.banned_by,
							permalink: thing.data.permalink,
							contentType: contentTypeMap.get(thing.data.name,) ?? 'comment' as const,
						}))
						.sort((a, b,) => b.date.getTime() - a.date.getTime())

					setContentPreviews(previews,)
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
									{formatShortDate(new Date(userInfo.created_utc * 1000,),)}
								</time>
							</span>
							{userInfo.is_suspended && <span className={css.suspendedBadge}>SUSPENDED</span>}
						</div>
					)
					: userInfoError
					? <p className={css.errorText}>{userInfoError}</p>
					: <p className={css.loadingText}>Loading…</p>}
			</section>

			{/* Flair — inline */}
			<section className={css.section}>
				<p className={css.flairRow}>
					<span className={css.flairLabel}>Flair:</span>
					{flairLoading
						? <span className={css.loadingText}>Loading…</span>
						: flairError
						? <span className={css.errorText}>{flairError}</span>
						: flairCurrent?.flair_text
						? flairCurrent.flair_text
						: <span className={css.mutedText}>Not set</span>}
				</p>
			</section>

			{/* Bans + Removed Comments + Removed Posts — all sourced from notesResult */}
			{(() => {
				if (notesLoading) { return <p className={css.loadingText}>Loading modlog…</p> }
				if (notesError) { return <p className={css.errorText}>{notesError}</p> }
				const notes = notesResult!
				const commentPreviews = contentPreviews.filter((p,) => p.contentType === 'comment')
				const postPreviews = contentPreviews.filter((p,) => p.contentType === 'post')
				const commentRemovals = notes.recentRemovals.filter((r,) => r.contentType === 'comment')
				const postRemovals = notes.recentRemovals.filter((r,) => r.contentType === 'post')
				return (
					<>
						{/* Bans */}
						<section className={css.section}>
							<h3 className={css.sectionHeading}>
								Bans
								{subStatuses.get(selectedSub,)?.banned && (
									<span className={css.currentBanBadge}>Currently banned</span>
								)}
							</h3>
							{notes.bans.length === 0
								? <p className={css.mutedText}>No Bans in User Modlog</p>
								: (
									<>
										<p className={css.banCount}>
											Banned {notes.bans.length} time{notes.bans.length !== 1 ? 's' : ''}
										</p>
										<table className={css.banTable}>
											<tbody>
												{notes.bans.map((ban,) => (
													<tr key={ban.id}>
														<td className={css.banDuration}>{ban.duration}</td>
														<td className={css.banDate}>{formatShortDate(ban.date,)}</td>
														<td>
															<a href={link(`/user/${encodeURIComponent(ban.moderator,)}`,)}>
																/u/{ban.moderator}
															</a>
														</td>
														{ban.reason && <td className={css.banReason}>{ban.reason}</td>}
													</tr>
												),)}
											</tbody>
										</table>
									</>
								)}
						</section>

						{/* Removed Comments */}
						<section className={css.section}>
							<h3 className={css.sectionHeading}>Removed Comments</h3>
							{commentRemovals.length === 0
								? <p className={css.mutedText}>No removed comments in modlog</p>
								: (
									<>
										{previewsLoading && <p className={css.loadingText}>Loading previews…</p>}
										{commentPreviews.length > 0 && (
											<table className={css.previewTable}>
												<tbody>
													{commentPreviews.map((preview,) => {
														const classification = classifyCommentBody({
															body: preview.body,
															author: preview.author,
															bannedBy: preview.bannedBy,
														},)
														return (
															<tr key={preview.fullname}>
																<td className={css.previewDate}>
																	<RelativeTime date={preview.date} />
																</td>
																<td className={css.previewBody}>
																	<a href={link(preview.permalink,)}>
																		{classification === 'deleted'
																			? <span className={css.mutedText}>[deleted by user]</span>
																			: classification === 'removed-by-reddit'
																			? <span className={css.mutedText}>[removed by Reddit]</span>
																			: `"${truncateText(preview.body ?? '', 300,)}"`}
																	</a>
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

						{/* Removed Posts */}
						<section className={css.section}>
							<h3 className={css.sectionHeading}>Removed Posts</h3>
							{postRemovals.length === 0
								? <p className={css.mutedText}>No removed posts in modlog</p>
								: (
									<>
										{previewsLoading && <p className={css.loadingText}>Loading previews…</p>}
										{postPreviews.length > 0 && (
											<table className={css.previewTable}>
												<tbody>
													{postPreviews.map((preview,) => {
														const classification = classifyCommentBody({
															body: preview.title,
															author: preview.author,
															bannedBy: preview.bannedBy,
														},)
														return (
															<tr key={preview.fullname}>
																<td className={css.previewDate}>
																	<RelativeTime date={preview.date} />
																</td>
																<td className={css.previewBody}>
																	<a href={link(preview.permalink,)}>
																		{classification === 'deleted'
																			? <span className={css.mutedText}>[deleted by user]</span>
																			: classification === 'removed-by-reddit'
																			? <span className={css.mutedText}>[removed by Reddit]</span>
																			: `"${truncateText(preview.title ?? '', 300,)}"`}
																	</a>
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
					</>
				)
			})()}
		</div>
	)
}
