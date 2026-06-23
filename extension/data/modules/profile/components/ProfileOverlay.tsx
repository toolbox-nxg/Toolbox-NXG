/** Full-page profile overlay that lets moderators browse, filter, and search a user's Reddit activity. */
import {useEffect, useRef, useState,} from 'react'

import {getUserListingPage,} from '../../../api/resources/users'
import {FullPageDialog,} from '../../../shared/window/FullPageDialog'
import {TabBar,} from '../../../shared/window/TabBar'
import {negativeTextFeedback, neutralTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import createLogger from '../../../util/infra/logging'
import {mountPopup,} from '../../../util/ui/reactMount'
import {ListingTab,} from './ProfileListingTab'
import {
	computeRepostGroups,
	defaultTabState,
	fetchEntireListing,
	type ProfileCacheStore,
	type ProfileListing,
	type RepostData,
	type TabState,
} from './ProfileOverlay.helpers'
import css from './ProfileOverlay.module.css'
import {UserSidebar,} from './UserSidebar'

const log = createLogger('Profile',)

/** Props for the ProfileOverlay component. */
interface ProfileOverlayProps {
	/** Reddit username whose activity is displayed. */
	user: string
	/** Which listing tab is shown first. */
	initialListing: ProfileListing
	/** Optional URL-parameter-driven initial state for the active tab. */
	initialOptions?: {
		/** Default sort order for the listing. */
		sort?: string
		/** When true, pre-populate and activate the search form. */
		search?: boolean
		/** Initial subreddit filter value. */
		subreddit?: string
		/** Initial content filter value. */
		content?: string
	}
	/** Whether to apply per-subreddit color accents to listing entries. */
	subredditColor: boolean
	onClose: () => void
}

function ProfileOverlay ({user, initialListing, initialOptions, subredditColor, onClose,}: ProfileOverlayProps,) {
	const [activeTab, setActiveTab,] = useState<ProfileListing>(initialListing,)
	const [filterModThings, setFilterModThings,] = useState(false,)
	const [hideModActions, setHideModActions,] = useState(false,)
	const [highlightReposts, setHighlightReposts,] = useState(false,)
	const [repostData, setRepostData,] = useState<RepostData | null>(null,)
	const [repostStatus, setRepostStatus,] = useState<'idle' | 'loading' | 'ready'>('idle',)
	const [activeRepostGroup, setActiveRepostGroup,] = useState<string | null>(null,)
	const [showOnlyReposts, setShowOnlyReposts,] = useState(false,)
	const [tabStates, setTabStates,] = useState<Record<ProfileListing, TabState>>({
		overview: {...defaultTabState, sort: initialOptions?.sort || 'new',},
		submitted: {...defaultTabState, sort: initialOptions?.sort || 'new',},
		comments: {...defaultTabState, sort: initialOptions?.sort || 'new',},
	},)

	const cancelSearchRef = useRef(false,)
	const pageCacheRef = useRef<ProfileCacheStore>({},)
	// Tracks whether the overlay is still mounted so the async repost fetch can bail out.
	const mountedRef = useRef(true,)
	useEffect(() => () => {
		mountedRef.current = false
	}, [],)

	/**
	 * Toggles repost highlighting. The first time it is enabled, the user's full
	 * `overview` history is fetched and scanned for duplicate links/text; the result
	 * is cached so subsequent toggles are instant.
	 * @param next The desired enabled state.
	 */
	async function toggleHighlightReposts (next: boolean,) {
		setHighlightReposts(next,)
		if (!next) {
			setActiveRepostGroup(null,)
			setShowOnlyReposts(false,)
			return
		}
		if (repostData || repostStatus === 'loading') { return }

		setRepostStatus('loading',)
		neutralTextFeedback('Fetching full history for repost detection...',)
		try {
			const items = await fetchEntireListing(
				getUserListingPage,
				user,
				'overview',
				'new',
				pageCacheRef.current,
				(pageCount, itemCount,) =>
					neutralTextFeedback(
						`Scanned ${itemCount} items across ${pageCount} page${pageCount === 1 ? '' : 's'}...`,
					),
				() => !mountedRef.current,
			)
			if (!mountedRef.current) { return }
			setRepostData(computeRepostGroups(items,),)
			setRepostStatus('ready',)
			positiveTextFeedback(`Repost detection ready - scanned ${items.length} items`,)
		} catch (error) {
			if (!mountedRef.current) { return }
			setRepostStatus('idle',)
			log.error('Could not fetch full history for repost detection:', error,)
			negativeTextFeedback('Could not fetch full history for repost detection.',)
		}
	}

	function updateTab (tab: ProfileListing, patch: Partial<TabState>,) {
		setTabStates((prev,) => ({...prev, [tab]: {...prev[tab], ...patch,},}))
	}

	// Apply search/filter params from initialOptions on mount
	useEffect(() => {
		if (initialOptions?.search) {
			updateTab(initialListing, {
				searchActive: true,
				searchSubreddit: initialOptions.subreddit || '',
				searchContent: initialOptions.content || '',
			},)
		}
	}, [],)

	return (
		<FullPageDialog title={`Toolbox profile for /u/${user}`} className={css.window} onClose={onClose}>
			<div className={`${css.body} toolbox-profile-overlay`}>
				<div className={css.mainColumn}>
					<div className={css.profileHeader}>
						<div className={css.tabs}>
							<TabBar
								ariaLabel="Profile listing"
								tabs={(['overview', 'submitted', 'comments',] as ProfileListing[]).map((t,) => ({
									id: t,
									label: t,
								}))}
								activeTab={activeTab}
								onTabChange={(t,) => {
									cancelSearchRef.current = true
									setActiveTab(t as ProfileListing,)
								}}
							/>
						</div>
						<div className={css.headerControls}>
							<label
								className={css.switch}
								title="Hide posts and comments from subreddits where you are not a moderator"
							>
								<input
									type="checkbox"
									checked={filterModThings}
									onChange={(event,) => setFilterModThings(event.target.checked,)}
								/>
								<span className={css.switchTrack} aria-hidden="true">
									<span className={css.switchThumb} />
								</span>
								<span>Hide unmoddable</span>
							</label>
							<label
								className={css.switch}
								title="Hide posts and comments where the user was distinguished as a moderator (the green M badge)"
							>
								<input
									type="checkbox"
									checked={hideModActions}
									onChange={(event,) => setHideModActions(event.target.checked,)}
								/>
								<span className={css.switchTrack} aria-hidden="true">
									<span className={css.switchThumb} />
								</span>
								<span>Hide mod actions</span>
							</label>
							<label
								className={css.switch}
								title="Fetch the user's full history and highlight reposted links and duplicated text. Click a Repost badge to show only that group."
							>
								<input
									type="checkbox"
									checked={highlightReposts}
									disabled={repostStatus === 'loading'}
									onChange={(event,) => void toggleHighlightReposts(event.target.checked,)}
								/>
								<span className={css.switchTrack} aria-hidden="true">
									<span className={css.switchThumb} />
								</span>
								<span>{repostStatus === 'loading' ? 'Highlight reposts...' : 'Highlight reposts'}</span>
							</label>
							{highlightReposts && repostStatus === 'ready' && (
								<button
									type="button"
									className={css.chipButton}
									title="Hide every entry that is not a detected repost"
									onClick={() => setShowOnlyReposts((prev,) => !prev)}
								>
									{showOnlyReposts ? 'Show all entries' : 'Show only reposts'}
								</button>
							)}
							{highlightReposts && activeRepostGroup && (
								<span className={css.chip}>
									Showing one repost group
									<button
										type="button"
										className={css.chipButton}
										onClick={() => setActiveRepostGroup(null,)}
									>
										Show all
									</button>
								</span>
							)}
						</div>
					</div>
					<div className={css.tabContent}>
						{(['overview', 'submitted', 'comments',] as ProfileListing[]).map((t,) => (
							<div key={t} style={{display: activeTab === t ? '' : 'none',}}>
								<ListingTab
									user={user}
									listing={t}
									active={activeTab === t}
									state={tabStates[t]}
									update={(patch,) => updateTab(t, patch,)}
									filterModThings={filterModThings}
									hideModActions={hideModActions}
									highlightReposts={highlightReposts}
									repostData={repostData}
									activeRepostGroup={activeRepostGroup}
									setActiveRepostGroup={setActiveRepostGroup}
									showOnlyReposts={showOnlyReposts}
									subredditColor={subredditColor}
									cancelSearchRef={cancelSearchRef}
									pageCacheRef={pageCacheRef}
								/>
							</div>
						))}
					</div>
				</div>
				<UserSidebar user={user} />
			</div>
		</FullPageDialog>
	)
}

let currentCleanup: (() => void) | null = null

/**
 * Mounts the ProfileOverlay into the page, closing any previously open instance first.
 * @param props Overlay props (without `onClose`, which is managed internally).
 * @returns A cleanup function that unmounts the overlay.
 */
export function showProfileOverlay (props: Omit<ProfileOverlayProps, 'onClose'>,) {
	if (currentCleanup) {
		currentCleanup()
		currentCleanup = null
	}
	const cleanup = mountPopup(
		(onClose,) => <ProfileOverlay {...props} onClose={onClose} />,
		() => {
			currentCleanup = null
		},
	)
	currentCleanup = cleanup
	return cleanup
}
