/** React component for rendering a single Reddit submission in Toolbox's custom submission view. */

import {useState,} from 'react'

import {Icon,} from '../../../shared/controls/Icon'
import {purifyHTML,} from '../../../util/data/purify'
import {formatRelativeTime,} from '../../../util/data/time'
import {link,} from '../../../util/reddit/pageContext'
import {stringToColor,} from '../../../util/reddit/reddit-domain'
import {deriveThingStatus,} from './deriveStatus'
import {buildAuthorAttrs, getVoteState, ThingReports, useFilteredFromQueue,} from './thingParts'
import {SubmissionOptions,} from './types'

/** Props for the TBSubmission component. */
interface TBSubmissionProps {
	/** Raw Reddit API submission object (with a `data` property). */
	submission: any
	options?: SubmissionOptions | undefined
	/** Salt string appended to subreddit names when computing border colors. */
	subredditColorSalt: string
}

/** Renders a single Reddit submission with score, thumbnail, tagline, moderation status, reports, and action buttons. */
export function TBSubmission ({submission, options, subredditColorSalt,}: TBSubmissionProps,) {
	const s = submission.data
	const {status, actionByOn,} = deriveThingStatus(s,)
	const isSelf = s.is_self
	const permalink = link(s.permalink,)
	const url = isSelf ? permalink : s.url
	const createdAt = new Date(s.created_utc * 1000,)

	const [selfExpanded, setSelfExpanded,] = useState(false,)
	const filteredFromQueue = useFilteredFromQueue(s, status,)

	const voteState = getVoteState(s.likes,)

	const {authorStatus, authorAttrs,} = buildAuthorAttrs(s, permalink,)

	const numComments = s.num_comments
	let commentsButtonText = 'comment'
	if (numComments === 1) { commentsButtonText = '1 comment' }
	else if (numComments > 1) { commentsButtonText = `${numComments} comments` }

	const canMod = s.can_mod_post
	const userReports: [string, string,][] = s.user_reports || []
	const modReports: [string, string,][] = s.mod_reports || []

	const showApprove = canMod && (status === 'removed' || status === 'spammed' || status === 'neutral')
	const showRemoveSpam = canMod && (status === 'approved' || status === 'neutral')
	const showFilteredRemoveSpam = canMod && filteredFromQueue

	const className = ['toolbox-submission', 'toolbox-thing', status,]
	if (s.pinned) { className.push('pinned',) }
	if (filteredFromQueue) { className.push('filtered',) }

	const style: React.CSSProperties = {}
	if (options?.subredditColor) {
		style.borderLeft = `solid 3px ${stringToColor(s.subreddit + subredditColorSalt,)}`
	}

	const selfTextHtml = s.selftext_html
	const editedAt = s.edited ? new Date(s.edited * 1000,) : null
	const flairStyle: React.CSSProperties = {}
	if (s.link_flair_background_color) {
		flairStyle.backgroundColor = s.link_flair_background_color
	}
	if (s.link_flair_text_color === 'light') {
		flairStyle.color = '#FFFFFF'
	} else if (s.link_flair_text_color === 'dark') {
		flairStyle.color = '#1A1A1B'
	}

	return (
		<div
			className={className.join(' ',)}
			data-submission-author={s.author}
			data-fullname={s.name}
			data-post-id={s.name}
			data-subreddit={s.subreddit}
			data-subreddit-type={s.subreddit_type}
			style={style}
		>
			<div className={`toolbox-submission-score ${voteState}`}>{s.score}</div>
			{String(s.thumbnail,).startsWith('http',) && (
				<a className={`toolbox-submission-thumbnail ${s.over_18 ? 'nsfw' : ''}`} href={url}>
					<img src={s.thumbnail} width="70" alt="" />
				</a>
			)}
			<div className="toolbox-submission-entry">
				<div className="toolbox-submission-title">
					<a className="toolbox-title" href={url}>{s.title}</a>{' '}
					{options?.showPostFlair && s.link_flair_text && (
						<>
							<span
								className={`toolbox-submission-flair toolbox-post-flair ${
									s.link_flair_css_class || ''
								}`}
								style={flairStyle}
							>
								{s.link_flair_text}
							</span>
							{' '}
						</>
					)}
					<span className="toolbox-domain">
						(<a href={link(`/domain/${s.domain}`,)}>{s.domain}</a>)
					</span>
				</div>
				{isSelf && selfTextHtml && (
					<button
						type="button"
						className="toolbox-self-expando-button"
						onClick={() => setSelfExpanded((prev,) => !prev)}
					>
						<Icon icon={selfExpanded ? 'remove' : 'add'} />
					</button>
				)}
				<div className="toolbox-tagline">
					submitted{' '}
					<span className="toolbox-submission-submitted">
						<time
							className="toolbox-live-timestamp"
							dateTime={createdAt.toISOString()}
							title={createdAt.toLocaleString()}
						>
							{formatRelativeTime(createdAt,)}
						</time>
					</span>
					{editedAt && (
						<span className="toolbox-submission-edited">
							*last edited{' '}
							<time
								className="toolbox-live-timestamp"
								dateTime={editedAt.toISOString()}
								title={editedAt.toLocaleString()}
							>
								{formatRelativeTime(editedAt,)}
							</time>
						</span>
					)} by {s.author === '[deleted]'
						? <span>[deleted]</span>
						: (
							<a
								href={link(`/user/${s.author}`,)}
								className={`toolbox-submission-author ${authorStatus}`}
							>
								{s.author}
							</a>
						)}
					{authorAttrs.length > 0 && (
						<span className="toolbox-userattrs">{authorAttrs}</span>
					)}
					<span className="toolbox-author-slot"></span> to{' '}
					<a href={link(`/r/${s.subreddit}`,)}>/r/{s.subreddit}</a>
					{s.pinned && (
						<>
							{' '}-{' '}
							<span className="toolbox-pinned-tagline" title="pinned to this user's profile">pinned</span>
						</>
					)}
					{s.gildings?.gid_1
						? (
							<>
								- <span className="toolbox-award-silver">silver x{s.gildings.gid_1}</span>
							</>
						)
						: null}
					{s.gildings?.gid_2
						? (
							<>
								- <span className="toolbox-award-gold">gold x{s.gildings.gid_2}</span>
							</>
						)
						: null}
					{s.gildings?.gid_3
						? (
							<>
								- <span className="toolbox-award-platinum">platinum x{s.gildings.gid_3}</span>
							</>
						)
						: null}
				</div>
				{status !== 'neutral' && (
					<div className="toolbox-submission-data">
						<ul className="toolbox-submission-details">
							<li className={`toolbox-status-${status}`}>{status} {actionByOn}.</li>
						</ul>
					</div>
				)}
				<ThingReports
					userReports={userReports}
					modReports={modReports}
					ignoreReports={!!s.ignore_reports}
					userReportClass="toolbox-user-report"
				/>
				<div className="toolbox-submission-buttons">
					{s.over_18 && (
						<span className="toolbox-nsfw-stamp toolbox-stamp">
							<abbr title="Adult content: Not Safe For Work">NSFW</abbr>
						</span>
					)}
					<a
						className="toolbox-submission-button toolbox-submission-button-comments"
						href={permalink}
					>
						{commentsButtonText}
					</a>
					{showApprove && (
						<a
							className="toolbox-submission-button toolbox-submission-button-approve"
							data-fullname={s.name}
						>
							approve
						</a>
					)}
					{showRemoveSpam && (
						<>
							<a
								className="toolbox-submission-button toolbox-submission-button-spam"
								data-fullname={s.name}
							>
								spam
							</a>
							<a
								className="toolbox-submission-button toolbox-submission-button-remove"
								data-fullname={s.name}
							>
								remove
							</a>
						</>
					)}
					{canMod && (
						s.locked
							? (
								<a
									className="toolbox-submission-button toolbox-submission-button-unlock"
									data-fullname={s.name}
								>
									unlock
								</a>
							)
							: (
								<a
									className="toolbox-submission-button toolbox-submission-button-lock"
									data-fullname={s.name}
								>
									lock
								</a>
							)
					)}
					{canMod && (
						s.over_18
							? (
								<a
									className="toolbox-submission-button toolbox-submission-button-unsfw"
									data-fullname={s.name}
								>
									un-nsfw
								</a>
							)
							: (
								<a
									className="toolbox-submission-button toolbox-submission-button-nsfw"
									data-fullname={s.name}
								>
									nsfw
								</a>
							)
					)}
					{showFilteredRemoveSpam && (
						<>
							<a
								className="toolbox-submission-button toolbox-submission-button-spam"
								data-fullname={s.name}
							>
								spam
							</a>
							<a
								className="toolbox-submission-button toolbox-submission-button-remove"
								data-fullname={s.name}
							>
								remove
							</a>
						</>
					)}
				</div>
				{isSelf && selfTextHtml && (
					<div
						className="toolbox-self-expando"
						style={{display: selfExpanded ? 'block' : 'none',}}
						dangerouslySetInnerHTML={{__html: purifyHTML(selfTextHtml,),}}
					/>
				)}
				<div className="toolbox-submission-slot"></div>
			</div>
		</div>
	)
}
