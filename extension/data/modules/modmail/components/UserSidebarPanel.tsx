/** Stacked, scrollable replacement for the native modmail user-sidebar tabs. */

import {useEffect, useState,} from 'react'

import {getModmailParticipant,} from '../../../api/resources/modmail'
import {RelativeTime,} from '../../../shared/controls/RelativeTime'
import createLogger from '../../../util/infra/logging'
import {ModNotesPager,} from '../../shared/modnotes/ModNotesPager'
import {normalizeRecentActivity, SidebarActivityItem,} from '../schema'
import css from './UserSidebarPanel.module.css'

const log = createLogger('modmail',)

/** Props for {@link UserSidebarPanel}. */
interface UserSidebarPanelProps {
	/** Subreddit the modmail conversation belongs to. */
	subreddit: string
	/** Participant whose activity is shown. */
	user: string
	/** Conversation id used to fetch participant info. */
	conversationId: string
}

/** Normalized activity lists derived from a single participant fetch. */
interface ActivityData {
	posts: SidebarActivityItem[]
	comments: SidebarActivityItem[]
	convos: SidebarActivityItem[]
}

/** Load state for the one participant request that feeds the Posts/Comments/Recent Modmail sections. */
type LoadState =
	| {status: 'loading'}
	| {status: 'error'}
	| {status: 'ready'; data: ActivityData}

/**
 * Renders the participant's Posts, Comments, Recent Modmail, and Log sections stacked in a single
 * scrollable column, fetching the first three from the modmail conversation `/user` endpoint in one
 * request and delegating Log to the shared {@link ModNotesPager}.
 */
export function UserSidebarPanel ({subreddit, user, conversationId,}: UserSidebarPanelProps,) {
	const [state, setState,] = useState<LoadState>({status: 'loading',},)

	useEffect(() => {
		let active = true
		setState({status: 'loading',},)

		void (async () => {
			try {
				const participant = await getModmailParticipant(conversationId,)
				if (!active) { return }
				setState({
					status: 'ready',
					data: {
						posts: normalizeRecentActivity(participant.recentPosts, 'post',),
						comments: normalizeRecentActivity(participant.recentComments, 'comment',),
						convos: normalizeRecentActivity(participant.recentConvos, 'convo',),
					},
				},)
			} catch (error) {
				if (!active) { return }
				log.error('Failed to load modmail participant info:', error,)
				setState({status: 'error',},)
			}
		})()

		return () => {
			active = false
		}
	}, [conversationId,],)

	return (
		<div className={css.panel}>
			<ActivitySection title="Posts" state={state} pick={(data,) => data.posts} />
			<ActivitySection title="Comments" state={state} pick={(data,) => data.comments} />
			<ActivitySection title="Recent Modmail" state={state} pick={(data,) => data.convos} />
			<section className={css.section}>
				<h3 className={css.heading}>Log</h3>
				<ModNotesPager user={user} subreddit={subreddit} filter="MOD_ACTION" layout="card" />
			</section>
		</div>
	)
}

/** A single titled section backed by the shared participant load state. */
function ActivitySection ({title, state, pick,}: {
	title: string
	state: LoadState
	pick: (data: ActivityData,) => SidebarActivityItem[]
},) {
	return (
		<section className={css.section}>
			<h3 className={css.heading}>{title}</h3>
			{state.status === 'loading' && <p className={css.muted}>Loading...</p>}
			{state.status === 'error' && <p className={css.muted}>Could not load {title.toLowerCase()}.</p>}
			{state.status === 'ready' && <ActivityList items={pick(state.data,)} emptyLabel={title.toLowerCase()} />}
		</section>
	)
}

/** Renders one section's rows, or an empty-state line when there are none. */
function ActivityList ({items, emptyLabel,}: {
	items: SidebarActivityItem[]
	emptyLabel: string
},) {
	if (items.length === 0) {
		return <p className={css.muted}>No {emptyLabel}.</p>
	}

	return (
		<ul className={css.list}>
			{items.map((item,) => (
				<li key={item.id} className={css.item}>
					<a className={css.itemTitle} href={item.permalink} target="_blank" rel="noreferrer">
						{item.title}
					</a>
					{item.body && <p className={css.itemBody}>{item.body}</p>}
					<div className={css.itemMeta}>
						{item.subreddit && <span>r/{item.subreddit}</span>}
						{item.date && <RelativeTime date={item.date} />}
					</div>
				</li>
			))}
		</ul>
	)
}
