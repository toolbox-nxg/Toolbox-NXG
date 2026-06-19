/** React component for rendering a single Reddit comment in Toolbox's custom comment view. */

import './redditElements.css'

import {useState,} from 'react'

import {escapeHTML, removeLastDirectoryPartOf,} from '../../../util/data/string'
import {formatRelativeTime,} from '../../../util/data/time'
import {link,} from '../../../util/reddit/pageContext'
import {stringToColor,} from '../../../util/reddit/reddit-domain'
import {deriveThingStatus,} from './deriveStatus'
import {buildAuthorAttrs, getVoteState, ThingReports, useFilteredFromQueue,} from './thingParts'
import {CommentOptions,} from './types'

/** Props for the TBComment component. */
interface TBCommentProps {
	/** Raw Reddit API comment object (with a `data` property). */
	comment: any
	options?: CommentOptions | undefined
	/** Salt string appended to subreddit names when computing border colors. */
	subredditColorSalt: string
}

/** Renders a single Reddit comment with tagline, body, moderation status, reports, and action buttons. */
export function TBComment ({comment, options = {}, subredditColorSalt,}: TBCommentProps,) {
	const c = comment.data
	const {status, actionByOn,} = deriveThingStatus(c,)
	const permalink = link(c.permalink,)
	const threadPermalink = removeLastDirectoryPartOf(permalink,)
	const createdAt = new Date(c.created_utc * 1000,)
	const editedAt = c.edited ? new Date(c.edited * 1000,) : null
	const depth = options.commentDepthPlus ? c.depth + 1 : c.depth
	const depthClass = options.noOddEven ? depth : (depth % 2 ? 'odd' : 'even')

	const parentKind = c.parent_id?.substring(0, 2,)
	const parentLink = parentKind === 't1'
		? threadPermalink + c.parent_id.substring(3,)
		: threadPermalink

	const {authorStatus, authorAttrs,} = buildAuthorAttrs(c, threadPermalink,)

	const score = c.score
	const voteState = getVoteState(c.likes,)
	const userReports: [string, string,][] = c.user_reports || []
	const modReports: [string, string,][] = c.mod_reports || []
	const canMod = c.can_mod_post

	const [collapsed, setCollapsed,] = useState(false,)
	const filteredFromQueue = useFilteredFromQueue(c, status,)

	let parentBlock: React.ReactNode = null
	if (options.overviewData) {
		let linkUrl = c.link_url
		if (linkUrl?.startsWith('https://old.reddit.com',)) {
			linkUrl = link(linkUrl.replace('https://old.reddit.com', '',),)
		}
		parentBlock = (
			<div className="toolbox-parent">
				<a className="toolbox-link-title" href={linkUrl}>{c.link_title}</a> by {c.link_author === '[deleted]'
					? <span>[deleted]</span>
					: (
						<a className="toolbox-link-author" href={link(`/user/${c.link_author}`,)}>
							{c.link_author}
						</a>
					)} in <a className="subreddit hover" href={link(`/r/${c.subreddit}/`,)}>{c.subreddit}</a>
			</div>
		)
	}

	const filteredEntry = userReports.length > 0 && !c.ignore_reports || modReports.length > 0
		|| filteredFromQueue

	const hasControversiality = !!c.controversiality

	const className = ['toolbox-thing', 'toolbox-comment', `toolbox-comment-${depthClass}`,]
	const style: React.CSSProperties = {}
	if (options.subredditColor) {
		style.borderLeft = `solid 3px ${stringToColor(c.subreddit + subredditColorSalt,)}`
	}

	const entryClass = ['toolbox-comment-entry', status,]
	if (c.stickied) { entryClass.push('toolbox-stickied',) }
	if (c.author_flair_css_class) { entryClass.push(`toolbox-user-flair-${c.author_flair_css_class}`,) }
	if (filteredEntry) { entryClass.push('filtered',) }

	const childReplies = c.replies?.data?.children
	const optionsJSON = escapeHTML(JSON.stringify(options,),)

	return (
		<div
			className={className.join(' ',)}
			data-thread-permalink={threadPermalink}
			data-comment-options={optionsJSON}
			data-subreddit={c.subreddit}
			data-subreddit-type={c.subreddit_type}
			data-comment-id={c.name}
			data-fullname={c.name}
			data-comment-author={c.author}
			data-comment-post-id={c.link_id}
			style={style}
		>
			<div className={entryClass.join(' ',)}>
				<div
					className={`toolbox-comment-score ${voteState} ${
						hasControversiality ? 'toolbox-iscontroversial' : ''
					}`}
					title={String(score,)}
				>
					{score}
				</div>
				<div className="toolbox-comment-content">
					{parentBlock}
					<div className="toolbox-tagline">
						<button
							type="button"
							className="toolbox-comment-toggle"
							onClick={() => setCollapsed((prev,) => !prev)}
							style={{
								background: 'none',
								border: 0,
								padding: 0,
								cursor: 'pointer',
								font: 'inherit',
								color: 'inherit',
							}}
						>
							{collapsed ? '[+]' : '[–]'}
						</button>{' '}
						{c.author === '[deleted]'
							? <span>[deleted]</span>
							: (
								<a
									className={`toolbox-comment-author ${authorStatus}`}
									href={link(`/user/${c.author}`,)}
								>
									{c.author}
								</a>
							)}
						{c.author_flair_text && (
							<span
								className={`toolbox-comment-flair ${c.author_flair_css_class || ''}`}
								title={c.author_flair_text}
							>
								{c.author_flair_text}
							</span>
						)}
						{authorAttrs.length > 0 && (
							<span className="toolbox-userattrs">[{authorAttrs}]</span>
						)}
						<span className="toolbox-author-slot"></span>{' '}
						<time
							className="toolbox-live-timestamp"
							dateTime={createdAt.toISOString()}
							title={createdAt.toLocaleString()}
						>
							{formatRelativeTime(createdAt,)}
						</time>
						{editedAt && (
							<>
								{' '}
								<span className="toolbox-comment-edited">
									*last edited{' '}
									<time
										className="toolbox-live-timestamp"
										dateTime={editedAt.toISOString()}
										title={editedAt.toLocaleString()}
									>
										{formatRelativeTime(editedAt,)}
									</time>
								</span>
							</>
						)}
						{c.stickied && <span className="toolbox-comment-stickied">stickied</span>}
						{c.gildings?.gid_1
							? (
								<span className="toolbox-award-silver">silver x{c.gildings.gid_1}</span>
							)
							: null}
						{c.gildings?.gid_2
							? (
								<span className="toolbox-award-gold">gold x{c.gildings.gid_2}</span>
							)
							: null}
						{c.gildings?.gid_3
							? (
								<span className="toolbox-award-platinum">platinum x{c.gildings.gid_3}</span>
							)
							: null}
					</div>
					<div
						className="toolbox-comment-body"
						style={collapsed ? {display: 'none',} : undefined}
						dangerouslySetInnerHTML={{__html: c.body_html,}}
					/>
					{(hasControversiality || status !== 'neutral') && (
						<div
							className="toolbox-comment-data"
							style={collapsed ? {display: 'none',} : undefined}
						>
							<ul className="toolbox-comment-details">
								{hasControversiality && (
									<li>Controversial score: {c.controversiality}.</li>
								)}
								{status !== 'neutral' && (
									<li className={`toolbox-status-${status}`}>{status} {actionByOn}.</li>
								)}
							</ul>
						</div>
					)}
					<ThingReports
						userReports={userReports}
						modReports={modReports}
						ignoreReports={!!c.ignore_reports}
						userReportClass="toolbox-comment-user-report"
					/>
					<div
						className="toolbox-comment-buttons"
						style={collapsed ? {display: 'none',} : undefined}
					>
						<a className="toolbox-comment-button toolbox-comment-button-permalink" href={permalink}>
							permalink
						</a>
						{options.parentLink && (
							<a className="toolbox-comment-button toolbox-comment-button-parent" href={parentLink}>
								parent
							</a>
						)}
						{options.contextLink && (
							<a
								className="toolbox-comment-button toolbox-comment-button-context"
								href={`${permalink}?context=3`}
							>
								context
							</a>
						)}
						{options.contextPopup && (() => {
							const onContextPopup = typeof options.contextPopup === 'function'
								? options.contextPopup
								: undefined
							return (
								<a
									className="toolbox-comment-button toolbox-comment-context-popup"
									data-comment-id={c.name}
									data-context-permalink={permalink}
									onClick={onContextPopup
										? (e,) => onContextPopup(c.name, permalink, e.nativeEvent,)
										: undefined}
								>
									context-popup
								</a>
							)
						})()}
						{options.fullCommentsLink && (
							<a
								className="toolbox-comment-button toolbox-comment-button-fullcomments"
								href={threadPermalink}
							>
								full comments
							</a>
						)}
						{canMod && (status === 'approved' || status === 'neutral') && (
							<>
								<a
									className="toolbox-comment-button toolbox-comment-button-spam"
									data-fullname={c.name}
								>
									spam
								</a>
								<a
									className="toolbox-comment-button toolbox-comment-button-remove"
									data-fullname={c.name}
								>
									remove
								</a>
							</>
						)}
						{canMod && (status === 'removed' || status === 'spammed' || status === 'neutral') && (
							<a
								className="toolbox-comment-button toolbox-comment-button-approve"
								data-fullname={c.name}
							>
								approve
							</a>
						)}
						{canMod && filteredFromQueue && (
							<>
								<a
									className="toolbox-comment-button toolbox-comment-button-spam"
									data-fullname={c.name}
								>
									spam
								</a>
								<a
									className="toolbox-comment-button toolbox-comment-button-remove"
									data-fullname={c.name}
								>
									remove
								</a>
							</>
						)}
					</div>
					<div className="toolbox-comment-slot"></div>
				</div>
			</div>
			{childReplies && childReplies.length > 0 && !collapsed && (
				<TBCommentChildren
					items={childReplies}
					options={options}
					subredditColorSalt={subredditColorSalt}
				/>
			)}
		</div>
	)
}

/** Props for the TBCommentChildren component. */
interface TBCommentChildrenProps {
	/** Array of Reddit API comment/more objects. */
	items: any[]
	options?: CommentOptions | undefined
	subredditColorSalt: string
}

/** Renders a list of child comment items, recursing into TBComment or showing a "load more" link. */
export function TBCommentChildren ({items, options, subredditColorSalt,}: TBCommentChildrenProps,) {
	return (
		<div className="toolbox-comment-children">
			{items.map((item, i,) => {
				if (item.kind === 't1') {
					return (
						<TBComment
							key={item.data?.name || i}
							comment={item}
							options={options}
							subredditColorSalt={subredditColorSalt}
						/>
					)
				}
				if (item.kind === 'more') {
					const count = item.data.count
					const ids = item.data.children.toString()
					return (
						<span key={`more-${i}`} className="toolbox-more-comments">
							<a
								className="toolbox-load-more-comments"
								data-ids={ids}
							>
								load more comments
							</a>{' '}
							({count} replies)
						</span>
					)
				}
				return null
			},)}
		</div>
	)
}
