/** User Overview tab for the ModButtonPopup: account info, flair, bans, and removed content. */

import {type ChangeEvent, useEffect, useId, useRef, useState,} from 'react'

import {getFlairSelector,} from '../../../api/resources/flair'
import type {FlairSelectorResponse,} from '../../../api/resources/flair'
import {getAllModNotes,} from '../../../api/resources/modnotes'
import {getInfoBulk, type RedditThing,} from '../../../api/resources/things'
import {aboutUser,} from '../../../api/resources/users'
import type {UserAbout,} from '../../../api/resources/users'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {SelectInput,} from '../../../shared/controls/SelectInput'
import {Timestamp,} from '../../../shared/controls/Timestamp'
import createLogger from '../../../util/infra/logging'
import {link,} from '../../../util/reddit/pageContext'

import type {SubStatus,} from '../schema'
import {
	type BanEntry,
	classifyContent,
	type ContentClassification,
	type ModNotesSummary,
	recentRemovalLimit,
	type RemovalEntry,
	removalPageSize,
	removalScanLimit,
	type RemovalSummary,
	summarizeBans,
	summarizeModNotes,
	truncateText,
} from './UserOverviewTab.helpers'
import css from './UserOverviewTab.module.css'

const log = createLogger('UserOverviewTab',)

const previewMaxLength = 300

/** Fields needed from /api/info for a removed comment or post. */
interface PreviewData {
	// Required by getInfoBulk's Record<string, unknown> constraint
	[key: string]: unknown
	name: string
	author: string
	banned_by?: string | boolean | null
	permalink: string
	/** Comment body; absent on posts. */
	body?: string
	/** Post title; absent on comments. */
	title?: string
}

/** A removed comment or post, ready to render. */
interface ContentPreview {
	permalink: string
	classification: ContentClassification
	text: string
}

/** State of a single async request. */
type LoadState<T,> =
	| {status: 'loading'}
	| {status: 'loaded'; value: T}
	| {status: 'error'; message: string}

/** Mod notes state; while `scanning`, `summary` holds partial results and is not yet complete. */
type NotesState =
	| {status: 'scanning'; summary: ModNotesSummary}
	| {status: 'complete'; summary: ModNotesSummary}
	| {status: 'error'; message: string}

const emptySummary: ModNotesSummary = {
	comments: {total: 0, removals: [],},
	posts: {total: 0, removals: [],},
	capped: false,
}

const unavailableLabels: Record<Exclude<ContentClassification, 'available'>, string> = {
	'deleted': '[deleted by user]',
	'removed-by-reddit': '[removed by Reddit]',
}

/** How many removals of each type are previewed; "Show more" raises it a page at a time. */
interface ShownRemovals {
	comments: number
	posts: number
}

const initialShownRemovals: ShownRemovals = {comments: recentRemovalLimit, posts: recentRemovalLimit,}

/** Props for the UserOverviewTab component. */
interface Props {
	user: string
	/** Subreddit to show by default; becomes the initial value of the sub selector. */
	defaultSub: string
	/** All subreddits the current user moderates, for the sub selector dropdown. */
	modSubs: string[]
	/** Live per-subreddit status map from the popup, used to derive current ban state. */
	subStatuses: Map<string, SubStatus>
	/** Called when a subreddit is selected, so the popup can load its status into `subStatuses`. */
	onSubredditSelect: (subreddit: string,) => void
}

/**
 * Renders an overview of a user: account info, current flair, ban history, and recent removed content.
 * @param props Component props.
 */
export function UserOverviewTab ({user, defaultSub, modSubs, subStatuses, onSubredditSelect,}: Props,) {
	const selectId = useId()
	const [selectedSub, setSelectedSub,] = useState(defaultSub,)
	const [account, setAccount,] = useState<LoadState<UserAbout['data']>>({status: 'loading',},)
	const [flair, setFlair,] = useState<LoadState<FlairSelectorResponse['current']>>({status: 'loading',},)
	const [notes, setNotes,] = useState<NotesState>({status: 'scanning', summary: emptySummary,},)
	const [bans, setBans,] = useState<LoadState<BanEntry[]>>({status: 'loading',},)
	// Subreddits where the mod asked to count past removalScanLimit (the "Count all" button)
	const [countAllSubs, setCountAllSubs,] = useState<ReadonlySet<string>>(new Set(),)
	const countAll = countAllSubs.has(selectedSub,)
	const [shownRemovals, setShownRemovals,] = useState(initialShownRemovals,)
	// Keyed by fullname; null means /api/info did not return the item
	const [previews, setPreviews,] = useState<ReadonlyMap<string, ContentPreview | null>>(new Map(),)

	// The caches live for the life of the popup, so switching back to a subreddit is instant
	const notesCacheRef = useRef(new Map<string, ModNotesSummary>(),)
	const bansCacheRef = useRef(new Map<string, BanEntry[]>(),)
	const requestedPreviewIdsRef = useRef(new Set<string>(),)

	useEffect(() => {
		let cancelled = false
		setAccount({status: 'loading',},)
		void (async () => {
			try {
				const result = await aboutUser(user,)
				if (!cancelled) { setAccount({status: 'loaded', value: result.data,},) }
			} catch (error) {
				log.error('Failed to load account info:', error,)
				if (!cancelled) { setAccount({status: 'error', message: errorMessage(error,),},) }
			}
		})()
		return () => {
			cancelled = true
		}
	}, [user,],)

	useEffect(() => {
		let cancelled = false
		setFlair({status: 'loading',},)
		void (async () => {
			try {
				const result = await getFlairSelector(selectedSub, user,)
				if (!cancelled) { setFlair({status: 'loaded', value: result.current,},) }
			} catch (error) {
				log.error('Failed to load flair:', error,)
				if (!cancelled) { setFlair({status: 'error', message: errorMessage(error,),},) }
			}
		})()
		return () => {
			cancelled = true
		}
	}, [user, selectedSub,],)

	useEffect(() => {
		const cached = notesCacheRef.current.get(selectedSub,)
		// A capped result is final unless the mod asked to count everything.
		if (cached && !(countAll && cached.capped)) {
			setNotes({status: 'complete', summary: cached,},)
			return
		}
		// While counting everything, keep showing the capped result's previews.
		setNotes({status: 'scanning', summary: cached ?? emptySummary,},)
		const controller = new AbortController()
		void (async () => {
			try {
				// The walk stops after removalScanLimit mod actions unless the mod asked to count
				// all of them; partial results are published as they arrive so previews show
				// before it finishes (a full count already has them from the capped result).
				const summary = await summarizeModNotes(
					getAllModNotes(selectedSub, user, 'MOD_ACTION',),
					controller.signal,
					(partial,) => {
						if (!cached) { setNotes({status: 'scanning', summary: partial,},) }
					},
					countAll ? Infinity : removalScanLimit,
				)
				if (!summary) { return }
				notesCacheRef.current.set(selectedSub, summary,)
				setNotes({status: 'complete', summary,},)
			} catch (error) {
				if (controller.signal.aborted) { return }
				log.error('Failed to load mod notes:', error,)
				setNotes({status: 'error', message: errorMessage(error,),},)
			}
		})()
		return () => controller.abort()
	}, [user, selectedSub, countAll,],)

	// Bans are read on their own, with the BAN filter, so the ban history is complete and does
	// not wait on (or get cut off by) the capped removal walk.
	useEffect(() => {
		const cached = bansCacheRef.current.get(selectedSub,)
		if (cached) {
			setBans({status: 'loaded', value: cached,},)
			return
		}
		setBans({status: 'loading',},)
		const controller = new AbortController()
		void (async () => {
			try {
				const result = await summarizeBans(getAllModNotes(selectedSub, user, 'BAN',), controller.signal,)
				if (!result) { return }
				bansCacheRef.current.set(selectedSub, result,)
				setBans({status: 'loaded', value: result,},)
			} catch (error) {
				if (controller.signal.aborted) { return }
				log.error('Failed to load ban history:', error,)
				setBans({status: 'error', message: errorMessage(error,),},)
			}
		})()
		return () => controller.abort()
	}, [user, selectedSub,],)

	useEffect(() => {
		if (notes.status === 'error') { return }
		const {comments, posts,} = notes.summary
		const missingIds = [
			...comments.removals.slice(0, shownRemovals.comments,),
			...posts.removals.slice(0, shownRemovals.posts,),
		]
			.map((removal,) => removal.redditId)
			.filter((redditId,) => !requestedPreviewIdsRef.current.has(redditId,))
		if (missingIds.length === 0) { return }
		for (const redditId of missingIds) {
			requestedPreviewIdsRef.current.add(redditId,)
		}
		void (async () => {
			let things: RedditThing<PreviewData>[] = []
			try {
				things = await getInfoBulk<PreviewData>(missingIds,)
			} catch (error) {
				log.error('Failed to load removed content previews:', error,)
			}
			setPreviews((previous,) => {
				const next = new Map(previous,)
				for (const redditId of missingIds) {
					next.set(redditId, null,)
				}
				for (const {data,} of things) {
					next.set(data.name, toContentPreview(data,),)
				}
				return next
			},)
		})()
	}, [notes, shownRemovals,],)

	const handleCountAll = () => {
		setCountAllSubs((previous,) => new Set(previous,).add(selectedSub,))
	}

	const handleShowMore = (kind: keyof ShownRemovals,) => {
		setShownRemovals((previous,) => ({...previous, [kind]: previous[kind] + removalPageSize,}))
	}

	const handleSubredditChange = (event: ChangeEvent<HTMLSelectElement>,) => {
		setShownRemovals(initialShownRemovals,)
		setSelectedSub(event.target.value,)
		onSubredditSelect(event.target.value,)
	}

	const subStatus = subStatuses.get(selectedSub,)
	const currentlyBanned = subStatus !== undefined && !subStatus.loading && subStatus.banned

	return (
		<div className={css.container}>
			<div className={css.subSelector}>
				<label htmlFor={selectId}>Viewing:</label>
				<SelectInput id={selectId} value={selectedSub} onChange={handleSubredditChange}>
					{modSubs.map((subreddit,) => <option key={subreddit} value={subreddit}>{subreddit}</option>)}
				</SelectInput>
			</div>

			<section className={css.section}>
				{account.status === 'loaded'
					? <AccountHeader user={user} info={account.value} />
					: account.status === 'error'
					? <p className={css.errorText}>{account.message}</p>
					: <p className={css.loadingText}>Loading...</p>}
			</section>

			<section className={css.section}>
				<p className={css.flairRow}>
					<span className={css.flairLabel}>Flair:</span>
					{flair.status === 'loading'
						? <span className={css.loadingText}>Loading...</span>
						: flair.status === 'error'
						? <span className={css.errorText}>{flair.message}</span>
						: flair.value?.flair_text || <span className={css.mutedText}>Not set</span>}
				</p>
			</section>

			<BanSection bans={bans} currentlyBanned={currentlyBanned} />

			{notes.status === 'error'
				? <p className={css.errorText}>{notes.message}</p>
				: (
					<>
						<RemovalSection
							heading="Removed Comments"
							contentLabel="comments"
							summary={notes.summary.comments}
							shown={shownRemovals.comments}
							onShowMore={() => handleShowMore('comments',)}
							complete={notes.status === 'complete'}
							capped={notes.summary.capped}
							onCountAll={handleCountAll}
							previews={previews}
						/>
						<RemovalSection
							heading="Removed Posts"
							contentLabel="posts"
							summary={notes.summary.posts}
							shown={shownRemovals.posts}
							onShowMore={() => handleShowMore('posts',)}
							complete={notes.status === 'complete'}
							capped={notes.summary.capped}
							onCountAll={handleCountAll}
							previews={previews}
						/>
					</>
				)}
		</div>
	)
}

/** Props for AccountHeader. */
interface AccountHeaderProps {
	user: string
	info: UserAbout['data']
}

/** Username link, account creation date, and suspension badge. */
function AccountHeader ({user, info,}: AccountHeaderProps,) {
	const created = new Date(info.created_utc * 1000,)
	return (
		<div className={css.accountHeader}>
			<a href={userLink(user,)}>/u/{user}</a>
			<span className={css.accountMeta}>
				{'- Account created '}
				<Timestamp date={created} />
			</span>
			{info.is_suspended && <span className={`${css.badge} ${css.errorBadge}`}>SUSPENDED</span>}
		</div>
	)
}

/** Props for BanSection. */
interface BanSectionProps {
	/** Every ban in the user's modlog, read with the BAN filter. */
	bans: LoadState<BanEntry[]>
	currentlyBanned: boolean
}

/** Ban history table with a "Currently banned" badge. */
function BanSection ({bans, currentlyBanned,}: BanSectionProps,) {
	return (
		<section className={css.section}>
			<h3 className={css.sectionHeading}>
				Bans
				{currentlyBanned && <span className={`${css.badge} ${css.cautionBadge}`}>Currently banned</span>}
			</h3>
			{bans.status === 'loading'
				? <p className={css.loadingText}>Loading ban history...</p>
				: bans.status === 'error'
				? <p className={css.errorText}>{bans.message}</p>
				: bans.value.length === 0
				? <p className={css.mutedText}>No Bans in User Modlog</p>
				: (
					<>
						<p className={css.count}>Banned {bans.value.length} time{bans.value.length === 1 ? '' : 's'}</p>
						<div className={css.scrollList}>
							<table className={css.table}>
								<tbody>
									{bans.value.map((ban,) => (
										<tr key={ban.id}>
											<td className={css.banDuration}>{ban.duration}</td>
											<td className={css.banDate}>
												<Timestamp date={ban.date} />
											</td>
											<td className={css.banModerator}>
												<a href={userLink(ban.moderator,)}>/u/{ban.moderator}</a>
											</td>
											<td className={css.banReason}>{ban.reason}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</>
				)}
		</section>
	)
}

/** Props for RemovalSection. */
interface RemovalSectionProps {
	heading: string
	/** Plural content noun used in the summary text (e.g. "comments"). */
	contentLabel: string
	summary: RemovalSummary
	/** How many of the newest removals to preview. */
	shown: number
	/** Previews the next page of removals. */
	onShowMore: () => void
	/** False while the modlog is still being read, so `summary.total` is not final. */
	complete: boolean
	/** True when only the latest `removalScanLimit` mod actions were read, so the total is a lower bound. */
	capped: boolean
	/** Reads the rest of the history past `removalScanLimit`, for an exact total. */
	onCountAll: () => void
	previews: ReadonlyMap<string, ContentPreview | null>
}

/** Total removal count and previews of the most recent removals for one content type, a page at a time. */
function RemovalSection (
	{heading, contentLabel, summary, shown, onShowMore, complete, capped, onCountAll, previews,}: RemovalSectionProps,
) {
	const listRef = useRef<HTMLDivElement>(null,)
	const shownBefore = useRef(shown,)
	// After "Show more", scroll the list to the first new row, which would otherwise sit below
	// the list's fold. Only the list scrolls, never the popup or the page.
	useEffect(() => {
		const previous = shownBefore.current
		shownBefore.current = shown
		const list = listRef.current
		const firstNew = list?.querySelectorAll('tr',).item(previous,)
		if (shown <= previous || !list || !firstNew) { return }
		list.scrollTop += firstNew.getBoundingClientRect().top - list.getBoundingClientRect().top
	}, [shown,],)

	if (complete && summary.total === 0) {
		return (
			<section className={css.section}>
				<h3 className={css.sectionHeading}>{heading}</h3>
				<p className={css.mutedText}>
					{capped
						? `No removed ${contentLabel} in the latest ${removalScanLimit} mod actions`
						: `No removed ${contentLabel} in User Modlog`}
					{capped && <CountAllButton onClick={onCountAll} />}
				</p>
			</section>
		)
	}
	const visible = summary.removals.slice(0, shown,)
	const remaining = summary.removals.length - visible.length
	return (
		<section className={css.section}>
			<h3 className={css.sectionHeading}>{heading}</h3>
			<p className={css.count}>
				{complete
					? formatRemovalCount(summary.total, visible.length, capped,)
					: <span className={css.loadingText}>Counting...</span>}
				{complete && capped && <CountAllButton onClick={onCountAll} />}
			</p>
			{visible.length > 0 && (
				<div ref={listRef} className={css.scrollList}>
					<table className={css.table}>
						<tbody>
							{visible.map((removal,) => (
								<RemovalRow
									key={removal.redditId}
									removal={removal}
									preview={previews.get(removal.redditId,)}
								/>
							))}
						</tbody>
					</table>
				</div>
			)}
			{complete && remaining > 0 && (
				<ActionButton type="button" inline onClick={onShowMore}>
					Show {Math.min(remaining, removalPageSize,)} more
				</ActionButton>
			)}
		</section>
	)
}

/** Props for CountAllButton. */
interface CountAllButtonProps {
	/** Starts the uncapped count. */
	onClick: () => void
}

/** Starts a full count of the user's removals; offered only when the total was capped. */
function CountAllButton ({onClick,}: CountAllButtonProps,) {
	return (
		<>
			{' '}
			<ActionButton type="button" inline onClick={onClick}>Count all</ActionButton>
		</>
	)
}

/** Props for RemovalRow. */
interface RemovalRowProps {
	removal: RemovalEntry
	/** Undefined while loading; null when Reddit did not return the item. */
	preview: ContentPreview | null | undefined
}

/** One removed comment or post: when it was removed and a link to it. */
function RemovalRow ({removal, preview,}: RemovalRowProps,) {
	return (
		<tr>
			<td className={css.previewDate}>
				<Timestamp date={removal.date} />
			</td>
			<td className={css.previewBody}>
				{preview === undefined
					? <span className={css.loadingText}>Loading...</span>
					: preview === null
					? <span className={css.mutedText}>[unavailable]</span>
					: (
						<a className={css.previewLink} href={link(preview.permalink,)}>
							{preview.classification === 'available'
								? `"${preview.text}"`
								: <span className={css.mutedText}>{unavailableLabels[preview.classification]}</span>}
						</a>
					)}
			</td>
		</tr>
	)
}

/** Converts /api/info data into a renderable preview. */
function toContentPreview (data: PreviewData,): ContentPreview {
	const text = data.body ?? data.title ?? ''
	return {
		permalink: data.permalink,
		classification: classifyContent({text, author: data.author, bannedBy: data.banned_by,},),
		text: truncateText(text, previewMaxLength,),
	}
}

/**
 * Formats a removal total, noting when only the most recent removals are shown and when the
 * total is a lower bound (e.g. "12+ removed in the latest 500 mod actions, most recent 3 shown").
 */
function formatRemovalCount (total: number, shown: number, capped: boolean,): string {
	const count = capped ? `${total}+ removed in the latest ${removalScanLimit} mod actions` : `${total} removed`
	return total > shown ? `${count}, most recent ${shown} shown` : count
}

/** Builds a link to a user's profile. */
function userLink (user: string,): string {
	return link(`/user/${encodeURIComponent(user,)}`,)
}

/** Extracts a displayable message from an unknown thrown value. */
function errorMessage (error: unknown,): string {
	return error instanceof Error ? error.message : String(error,)
}
