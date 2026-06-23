/** Profile overlay sidebar showing account details and recent activity for the user. */
import {useEffect, useState,} from 'react'

import {aboutUser, getUserListingPage,} from '../../../api/resources/users'
import type {UserAbout,} from '../../../api/resources/users'
import {GeneralButton,} from '../../../shared/controls/GeneralButton'
import {RelativeTime,} from '../../../shared/controls/RelativeTime'
import {link,} from '../../../util/reddit/pageContext'
import {getUserThumbnailUrl,} from './ProfileOverlay.helpers'
import css from './ProfileOverlay.module.css'

interface UserSidebarProps {
	user: string
}

/** A subreddit summary entry from the `moderated_subreddits` listing. */
interface ModeratedSubreddit {
	sr: string
	subscribers?: number
	icon_img?: string
	over_18?: boolean
}

/** A trophy entry from the `trophies` listing. */
interface Trophy {
	data: {
		name?: string
		description?: string
		icon_40?: string
		url?: string
	}
}

export function UserSidebar ({user,}: UserSidebarProps,) {
	const [aboutData, setAboutData,] = useState<UserAbout['data'] | null>(null,)
	const [error, setError,] = useState(false,)
	const [modSubs, setModSubs,] = useState<ModeratedSubreddit[]>([],)
	const [showAllMod, setShowAllMod,] = useState(false,)
	const [trophies, setTrophies,] = useState<Trophy[]>([],)

	useEffect(() => {
		aboutUser(user,).then((data,) => {
			setAboutData(data.data,)
		},).catch(() => setError(true,))

		getUserListingPage<{data: ModeratedSubreddit[]}>(user, 'moderated_subreddits',).then((data,) => {
			if (data && Array.isArray(data.data,)) {
				setModSubs(data.data,)
			}
		},).catch(() => undefined)

		getUserListingPage<{data: {trophies: Trophy[]}}>(user, 'trophies',).then((data,) => {
			if (data && data.data && Array.isArray(data.data.trophies,)) {
				setTrophies(data.data.trophies,)
			}
		},).catch(() => undefined)
	}, [user,],)

	if (error) {
		return (
			<div className={css.sidebar}>
				<ul className={css.userDetailList}>
					<li>No user information found - shadowbanned or deleted?</li>
				</ul>
			</div>
		)
	}

	if (!aboutData) {
		return <div className={css.sidebar}>
			<ul className={css.userDetailList}>
				<li>Loading...</li>
			</ul>
		</div>
	}

	const userThumbnail = getUserThumbnailUrl(aboutData,)
	const userCreated = aboutData.created_utc
	const verifiedMail = aboutData.has_verified_email
	const linkKarma = aboutData.link_karma
	const commentKarma = aboutData.comment_karma
	const displayName = aboutData.subreddit?.title
	const publicDescription = aboutData.subreddit?.public_description
	const createdAt = new Date(userCreated * 1000,)

	const visibleSubs = showAllMod ? modSubs : modSubs.slice(0, 10,)

	return (
		<div className={css.sidebar}>
			{userThumbnail && <img src={userThumbnail} className={css.userThumbnail} alt="" />}
			<ul className={css.userDetailList}>
				<li>
					<a href={link(`/user/${user}`,)}>/u/{user}</a>
				</li>
				{displayName && <li>Display name: {displayName}</li>}
				<li>Link karma: {linkKarma.toLocaleString()}</li>
				<li>Comment karma: {commentKarma.toLocaleString()}</li>
				<li className="toolbox-user-detail-join-date">
					Joined <RelativeTime date={createdAt} />
				</li>
				<li>{verifiedMail ? 'Verified mail' : 'No verified mail'}</li>
			</ul>
			{publicDescription && (
				<div className={css.userDescription}>{publicDescription}</div>
			)}
			{modSubs.length > 0 && (
				<>
					<h3>{modSubs.length} Moderated subreddits</h3>
					<ul className={css.userModsubsList}>
						{visibleSubs.map((subreddit,) => (
							<li key={subreddit.sr}>
								<a href={link(`/r/${subreddit.sr}`,)} title={`${subreddit.subscribers} subscribers`}>
									/r/{subreddit.sr}
								</a>
								{subreddit.icon_img
									&& <img src={subreddit.icon_img} className={css.subredditIcon} alt="" />}
								{subreddit.over_18 && (
									<span className="toolbox-nsfw-stamp toolbox-stamp">
										<abbr title="Adult content: Not Safe For Work">NSFW</abbr>
									</span>
								)}
							</li>
						))}
					</ul>
					{modSubs.length > 10 && (
						<div className={css.centeredAction}>
							<GeneralButton onClick={() => setShowAllMod((prev,) => !prev)}>
								{showAllMod ? `show ${modSubs.length - 10} less` : `${modSubs.length - 10} more ...`}
							</GeneralButton>
						</div>
					)}
				</>
			)}
			{trophies.length > 0 && (
				<div className={css.userTrophies}>
					<h3>Trophies</h3>
					{trophies.map((trophy, i,) => {
						const inner = (
							<>
								<img className={css.trophyIcon} src={trophy.data.icon_40} alt="" />
								<span className={css.trophyName}>{trophy.data.name}</span>
								{trophy.data.description && (
									<span className={css.trophyDescription}>{trophy.data.description}</span>
								)}
							</>
						)
						return (
							<div key={i} className={css.trophyInfo}>
								{trophy.data.url
									? <a href={trophy.data.url} className={css.trophyLink}>{inner}</a>
									: inner}
							</div>
						)
					},)}
				</div>
			)}
		</div>
	)
}
