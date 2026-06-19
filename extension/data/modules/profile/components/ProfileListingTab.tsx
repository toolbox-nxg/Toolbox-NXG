/** One listing tab (overview/submitted/comments) of the profile overlay: fetching, filtering, search, and rendering. */
import {useEffect, useRef, useState,} from 'react'

import {getModSubs,} from '../../../api/resources/modSubs'
import {BanState, getBanState,} from '../../../api/resources/relationships'
import {getUserListingPage,} from '../../../api/resources/users'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {neutralTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import {forEachChunkedDynamic,} from '../../../util/data/iter'
import createLogger from '../../../util/infra/logging'
import {highlight,} from '../../../util/ui/highlight'
import {
	colorSaltReady,
	makeSingleComment,
	makeSubmissionEntry,
	tbRedditEvent,
} from '../../../util/ui/redditElementsInit'
import {openCommentContextPopup,} from '../../comment/dom'
import {BulkRemovePanel,} from './BulkRemovePanel'
import {
	applyProfileEntryFilters,
	applyRepostHighlights,
	cacheListingPage,
	compileProfileSearch,
	dedupByFullname,
	entryBelongsToListing,
	getOrCreatePageCache,
	getProfileThings,
	type ProfileCacheStore,
	type ProfileListing,
	profileListingEntryMatches,
	type ProfilePageCache,
	type RepostData,
	type TabState,
} from './ProfileOverlay.helpers'
import css from './ProfileOverlay.module.css'

const log = createLogger('Profile',)

/** Props for the ListingTab component. */
interface ListingTabProps {
	user: string
	listing: ProfileListing
	/** Whether this tab is currently the active/visible one. */
	active: boolean
	state: TabState
	/** Merges a partial patch into this tab's state. */
	update: (patch: Partial<TabState>,) => void
	filterModThings: boolean
	hideModActions: boolean
	/** When true, repost borders/badges are applied to entries found in `repostData`. */
	highlightReposts: boolean
	/** Computed repost annotations and group membership, or null until detection has run. */
	repostData: RepostData | null
	/** Signature key of the currently isolated repost group, or null when none. */
	activeRepostGroup: string | null
	/** Sets (or clears) the isolated repost group when a badge is clicked. */
	setActiveRepostGroup: (group: string | null,) => void
	/** When true, entries that are not detected reposts are hidden. */
	showOnlyReposts: boolean
	subredditColor: boolean
	/** Shared ref - set to `true` to abort any in-flight search loop. */
	cancelSearchRef: React.MutableRefObject<boolean>
	/** Shared ref holding fetched page data keyed by `"listing:sort"`. */
	pageCacheRef: React.MutableRefObject<ProfileCacheStore>
}

export function ListingTab ({
	user,
	listing,
	active,
	state,
	update,
	filterModThings,
	hideModActions,
	highlightReposts,
	repostData,
	activeRepostGroup,
	setActiveRepostGroup,
	showOnlyReposts,
	subredditColor,
	cancelSearchRef,
	pageCacheRef,
}: ListingTabProps,) {
	const sitetableRef = useRef<HTMLDivElement>(null,)
	// Guards async fetch callbacks (below) from updating state or touching the DOM after the tab
	// has unmounted - closing the profile or switching tabs mid-fetch would otherwise warn / leak.
	const mountedRef = useRef(true,)
	const feedPanelRef = useRef<HTMLDivElement>(null,)
	const sentinelRef = useRef<HTMLDivElement>(null,)
	const afterRef = useRef<string | false>(state.after,)
	// Always points at the current-render `loadPage` so the mount-time
	// IntersectionObserver invokes the latest closure (current filters,
	// modSubsList, sort, etc.) rather than the stale one captured at mount.
	const loadPageRef = useRef<(after: string | undefined,) => void>(() => {},)
	const subInputRef = useRef<HTMLInputElement>(null,)
	const [searchSubInput, setSearchSubInput,] = useState(state.searchSubreddit,)
	const [searchContentInput, setSearchContentInput,] = useState(state.searchContent,)
	const [searchRegexInput, setSearchRegexInput,] = useState(state.searchRegex,)
	const [errorMsg, setErrorMsg,] = useState<string | undefined>(state.error,)
	const [suggestOpen, setSuggestOpen,] = useState(false,)
	const [modSubsList, setModSubsList,] = useState<string[]>([],)
	const [showBulkRemove, setShowBulkRemove,] = useState(false,)
	const [isFetching, setIsFetching,] = useState(false,)
	// undefined = not a mod subreddit or not yet fetched; null = fetched, not banned; BanState = fetched, banned
	const [subBanState, setSubBanState,] = useState<BanState | null | undefined>(undefined,)

	useEffect(() => () => {
		mountedRef.current = false
	}, [],)

	useEffect(() => {
		getModSubs(false,).then((subs: string[],) => {
			if (mountedRef.current) { setModSubsList(subs || [],) }
		},)
	}, [],)

	afterRef.current = state.after
	// `loadPage` is a hoisted function declaration, so it is safe to reference here.
	loadPageRef.current = loadPage

	useEffect(() => {
		setSearchSubInput(state.searchSubreddit,)
		setSearchContentInput(state.searchContent,)
		setSearchRegexInput(state.searchRegex,)
	}, [state.searchSubreddit, state.searchContent, state.searchRegex,],)

	useEffect(() => {
		const sentinel = sentinelRef.current
		const root = feedPanelRef.current
		if (!sentinel || !root) { return }
		const observer = new IntersectionObserver(
			(entries,) => {
				if (entries[0]?.isIntersecting && afterRef.current) {
					loadPageRef.current(afterRef.current as string,)
				}
			},
			{root, threshold: 0,},
		)
		observer.observe(sentinel,)
		return () => observer.disconnect()
		// The observer reads only refs (afterRef, loadPageRef), which always hold
		// the latest values, so it is set up once and never needs to re-run.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [],)

	useEffect(() => {
		setSubBanState(undefined,)
		setShowBulkRemove(false,)
		if (
			!state.searchSubreddit || !modSubsList.some((s,) => s.toLowerCase() === state.searchSubreddit.toLowerCase())
		) {
			return
		}
		getBanState(state.searchSubreddit, user,).then((ban,) => {
			setSubBanState(ban ?? null,)
		},).catch(() => setSubBanState(null,))
	}, [state.searchSubreddit, user, modSubsList,],)

	async function appendItems (items: any[],) {
		if (!sitetableRef.current) { return }
		const rendered = new Set(
			Array.from(sitetableRef.current.querySelectorAll('.toolbox-thing[data-fullname]',),)
				.map((element,) => element.getAttribute('data-fullname',))
				.filter((name,): name is string => Boolean(name,)),
		)
		const uniqueItems = dedupByFullname(items, rendered,)
		const commentOptions: any = {
			parentLink: true,
			contextLink: true,
			contextPopup: openCommentContextPopup,
			fullCommentsLink: true,
			overviewData: true,
		}
		const submissionOptions: any = {}
		if (subredditColor) {
			commentOptions.subredditColor = true
			submissionOptions.subredditColor = true
		}
		submissionOptions.showPostFlair = true
		await colorSaltReady
		const promise = forEachChunkedDynamic(uniqueItems, (entry: any,) => {
			if (!sitetableRef.current) { return }
			if (entry.kind === 't1') {
				const comment = makeSingleComment(entry, commentOptions,)
				if (entry.highlight) {
					comment.querySelectorAll('.md',).forEach((element: Element,) =>
						highlight(element, entry.highlight, false, true,)
					)
				}
				sitetableRef.current.appendChild(comment,)
			} else if (entry.kind === 't3') {
				const submission = makeSubmissionEntry(entry, submissionOptions,)
				if (entry.highlight) {
					submission.querySelectorAll('.toolbox-title, .md',).forEach((element: Element,) =>
						highlight(element, entry.highlight, false, true,)
					)
				}
				sitetableRef.current.appendChild(submission,)
			}
		},)
		promise?.then(() => {
			// The chunked build can resolve after the tab unmounts; don't schedule work against
			// torn-down DOM/state.
			if (!mountedRef.current) { return }
			setTimeout(() => {
				if (!mountedRef.current) { return }
				if (sitetableRef.current) { tbRedditEvent(sitetableRef.current,) }
				applyFilters()
				applyReposts()
			}, 200,)
		},)
	}

	function clearSitetable () {
		if (sitetableRef.current) { sitetableRef.current.replaceChildren() }
	}

	function getPageCache (sort: string, cacheListing = listing,): ProfilePageCache {
		return getOrCreatePageCache(pageCacheRef.current, cacheListing, sort,)
	}

	function cachePage (sort: string, items: any[], after: string | false,) {
		return cacheListingPage(pageCacheRef.current, listing, sort, items, after,)
	}

	function getCachedListingItems (sort: string,) {
		const ownItems = getPageCache(sort,).items
		if (listing === 'overview') { return ownItems }

		const seen = new Set<string>(ownItems.map((item,) => item.data?.name).filter(Boolean,),)
		const overviewItems = dedupByFullname(
			getPageCache(sort, 'overview',).items.filter((item,) => entryBelongsToListing(item, listing,)),
			seen,
		)

		return [...ownItems, ...overviewItems,]
	}

	function getCachedListingSlice (sort: string, offset: number, limit: number,): {
		items: any[]
		after: string | false
	} {
		const cache = getPageCache(sort,)
		const itemsForListing = getCachedListingItems(sort,)
		const nextOffset = offset + limit
		const items = itemsForListing.slice(offset, nextOffset,)
		let after: string | false = false
		if (itemsForListing.length > nextOffset) {
			after = `cache:${nextOffset}`
		} else if (!cache.exhausted) {
			after = cache.after || 'fetch'
		}
		return {items, after,}
	}

	function renderEntryForSearch (entry: any, highlightText: string | RegExp | null,) {
		const next = {...entry,}
		delete next.highlight
		if (highlightText) { next.highlight = highlightText }
		return next
	}

	function applyFilters () {
		if (!sitetableRef.current) { return }
		applyProfileEntryFilters(sitetableRef.current, {
			filterModThings,
			hideModActions,
			moderatedSubreddits: modSubsList,
		},)
	}

	function applyReposts () {
		if (!sitetableRef.current) { return }
		applyRepostHighlights(
			sitetableRef.current,
			repostData?.byFullname ?? new Map(),
			repostData?.groups ?? new Map(),
			highlightReposts && !!repostData,
			activeRepostGroup,
			showOnlyReposts,
		)
	}

	useEffect(() => {
		applyFilters()
	}, [filterModThings, hideModActions, modSubsList,],)

	// When repost highlighting is on, render the tab's *entire* fetched history into
	// the DOM (not just the lazily-paginated slice). Detection runs over the full
	// history, so reposts - and every member of an isolated group - must be present
	// in the DOM to be highlighted and acted on. appendItems deduplicates, so this
	// only appends the items that are not already rendered.
	useEffect(() => {
		if (active && highlightReposts && repostData && state.loaded && !state.searchActive) {
			appendItems(getCachedListingItems(state.sort,),)
		}
	}, [active, highlightReposts, repostData, state.loaded, state.searchActive, state.sort,],)

	useEffect(() => {
		applyReposts()
	}, [highlightReposts, repostData, activeRepostGroup, showOnlyReposts,],)

	// Badges are injected into the DOM (not React), so use a single delegated
	// click handler on the feed panel to isolate the clicked repost group.
	useEffect(() => {
		const panel = feedPanelRef.current
		if (!panel) { return }
		function handleBadgeClick (event: MouseEvent,) {
			const badge = (event.target as HTMLElement | null)?.closest('.toolbox-repost-badge',)
			if (!badge) { return }
			event.preventDefault()
			event.stopPropagation()
			const group = badge.getAttribute('data-repost-group',)
			if (!group) { return }
			setActiveRepostGroup(activeRepostGroup === group ? null : group,)
		}
		panel.addEventListener('click', handleBadgeClick,)
		return () => panel.removeEventListener('click', handleBadgeClick,)
	}, [activeRepostGroup, setActiveRepostGroup,],)

	// Initial load when the tab becomes active
	useEffect(() => {
		if (!active || state.loaded) { return }
		if (state.searchActive) {
			runSearch({
				subreddit: state.searchSubreddit,
				content: state.searchContent,
				regex: state.searchRegex,
			},)
		} else {
			loadPage(undefined,)
		}
	}, [active, state.loaded, state.searchActive,],)

	function loadPage (after: string | undefined,) {
		cancelSearchRef.current = true
		const cacheOffset = after?.startsWith('cache:',) ? Number(after.slice(6,),) : null
		if (cacheOffset != null && Number.isFinite(cacheOffset,)) {
			const cached = getCachedListingSlice(state.sort, cacheOffset, 25,)
			appendItems(cached.items,)
			update({loaded: true, after: cached.after, error: undefined, searchRunning: false,},)
			setErrorMsg(undefined,)
			return
		}

		if (!after) {
			const cached = getCachedListingSlice(state.sort, 0, 25,)
			if (cached.items.length > 0) {
				clearSitetable()
				appendItems(cached.items,)
				update({loaded: true, after: cached.after, error: undefined, searchRunning: false,},)
				setErrorMsg(undefined,)
				return
			}
		}

		setIsFetching(true,)
		getUserListingPage(user, listing, {
			raw_json: '1',
			after: after === 'fetch' ? '' : after || '',
			sort: state.sort,
			limit: '25',
			t: 'all',
		},).then((data: any,) => {
			if (!mountedRef.current) { return }
			const nextAfter = data.data.after || false
			const newItems = cachePage(state.sort, data.data.children, nextAfter,)
			if (!after) { clearSitetable() }
			appendItems(newItems,)
			update({loaded: true, after: nextAfter, error: undefined, searchRunning: false,},)
			setErrorMsg(undefined,)
			setIsFetching(false,)
		},).catch((error: unknown,) => {
			if (!mountedRef.current) { return }
			log.error('Error fetching profile activity:', error,)
			setErrorMsg('No activity found. Reddit doesn\'t seem to have anything for this account.',)
			update({loaded: true, error: 'No activity found.',},)
			setIsFetching(false,)
		},)
	}

	function changeSort (newSort: string,) {
		cancelSearchRef.current = true
		update({
			sort: newSort,
			loaded: false,
			after: false,
			items: [],
			searchActive: false,
			searchRunning: false,
		},)
		clearSitetable()
		getUserListingPage(user, listing, {raw_json: '1', sort: newSort, limit: '25', t: 'all',},).then(
			(data: any,) => {
				if (!mountedRef.current) { return }
				cachePage(newSort, data.data.children, data.data.after || false,)
				appendItems(data.data.children,)
				update({loaded: true, after: data.data.after || false, error: undefined,},)
			},
		).catch((error: unknown,) => {
			if (!mountedRef.current) { return }
			log.error('Error sorting:', error,)
		},)
	}

	async function runSearch (overrides?: {
		subreddit: string
		content: string
		regex: boolean
	},) {
		const searchSubreddit = overrides?.subreddit ?? searchSubInput
		const searchContent = overrides?.content ?? searchContentInput
		const searchRegex = overrides?.regex ?? searchRegexInput
		const compiledSearch = compileProfileSearch({
			subreddit: searchSubreddit,
			content: searchContent,
			regex: searchRegex,
		},)

		if (compiledSearch.error) {
			setErrorMsg(compiledSearch.error,)
			update({error: compiledSearch.error, searchRunning: false,},)
			return
		}

		if (!compiledSearch.subredditPattern && !compiledSearch.contentPattern) {
			clearSearch()
			return
		}

		clearSitetable()
		update({
			searchActive: true,
			searchSubreddit,
			searchContent,
			searchRegex,
			searchRunning: true,
			searchPageCount: 0,
			searchResultCount: 0,
			after: false,
			error: undefined,
		},)
		setErrorMsg(undefined,)
		cancelSearchRef.current = false

		const sortMethod = state.sort
		let after: string | undefined = undefined
		let pageCount = 0
		let resultCount = 0
		let hits = false

		try {
			const cache = getPageCache(sortMethod,)
			const cachedItems = getCachedListingItems(sortMethod,)
			const cachedResults = cachedItems
				.filter((value,) => profileListingEntryMatches(value, compiledSearch,))
				.map((value,) =>
					renderEntryForSearch(
						value,
						compiledSearch.contentPattern ?? null,
					)
				)

			if (cachedResults.length > 0) {
				appendItems(cachedResults,)
				resultCount = cachedResults.length
				hits = true
			}

			pageCount = cache.pageCount
			after = cache.after || undefined
			update({searchPageCount: pageCount, searchResultCount: resultCount,},)
			if (cachedItems.length > 0) {
				neutralTextFeedback(`Searched ${cachedItems.length} cached profile items`,)
			}

			while (!cancelSearchRef.current) {
				if (cache.exhausted) { break }
				pageCount += 1
				// eslint-disable-next-line no-await-in-loop
				const data: any = await getUserListingPage(user, listing, {
					raw_json: '1',
					after: after || '',
					sort: sortMethod,
					limit: '100',
					t: 'all',
				},)
				if (cancelSearchRef.current) { break }
				cachePage(sortMethod, data.data.children, data.data.after || false,)
				neutralTextFeedback(`Searching profile page ${pageCount} with ${data.data.children.length} items`,)
				const results: any[] = []
				data.data.children.forEach((value: any,) => {
					if (profileListingEntryMatches(value, compiledSearch,)) {
						results.push(renderEntryForSearch(
							value,
							compiledSearch.contentPattern ?? null,
						),)
						hits = true
					}
				},)
				if (results.length > 0) {
					appendItems(results,)
					resultCount += results.length
					update({searchPageCount: pageCount, searchResultCount: resultCount,},)
				} else {
					update({searchPageCount: pageCount,},)
				}
				if (!data.data.after) { break }
				after = data.data.after
			}

			if (!hits && sitetableRef.current && !getProfileThings(sitetableRef.current,).length) {
				setErrorMsg(undefined,)
			}
			if (cancelSearchRef.current) {
				neutralTextFeedback('Search canceled',)
			} else {
				positiveTextFeedback('Search complete',)
			}
		} catch (error) {
			log.error('Error searching profile activity:', error,)
			setErrorMsg('Search failed. Reddit did not return more profile activity.',)
			update({error: 'Search failed. Reddit did not return more profile activity.',},)
		} finally {
			update({
				loaded: true,
				searchRunning: false,
				searchPageCount: pageCount,
				searchResultCount: resultCount,
			},)
		}
	}

	function cancelSearch () {
		cancelSearchRef.current = true
		neutralTextFeedback('Canceling search',)
	}

	function clearSearch () {
		cancelSearchRef.current = true
		setSearchSubInput('',)
		setSearchContentInput('',)
		setSearchRegexInput(false,)
		setErrorMsg(undefined,)
		update({
			searchActive: false,
			searchSubreddit: '',
			searchContent: '',
			searchRegex: false,
			searchRunning: false,
			searchPageCount: 0,
			searchResultCount: 0,
			after: false,
			error: undefined,
		},)
		clearSitetable()
		loadPage(undefined,)
	}

	const showNoSearchResults = !errorMsg
		&& state.loaded
		&& !state.after
		&& !state.searchRunning
		&& state.searchActive
		&& state.searchResultCount === 0

	return (
		<div className={css.listing}>
			<div className={css.toolbar}>
				<form
					className={css.searchForm}
					onSubmit={(event,) => {
						event.preventDefault()
						runSearch()
					}}
				>
					<label className={css.field}>
						<span>Sort</span>
						<select
							className={css.select}
							value={state.sort}
							onChange={(event,) => changeSort(event.target.value,)}
						>
							<option value="new">new</option>
							<option value="top">top</option>
							<option value="controversial">controversial</option>
							<option value="hot">hot</option>
						</select>
					</label>
					<label className={css.field}>
						<span>Subreddit</span>
						<span className={css.suggestWrap}>
							<input
								ref={subInputRef}
								type="text"
								placeholder="subreddit"
								className={css.searchInput}
								value={searchSubInput}
								onChange={(event,) => setSearchSubInput(event.target.value,)}
								onFocus={() => setSuggestOpen(true,)}
								onBlur={() => setTimeout(() => setSuggestOpen(false,), 150,)}
							/>
							{suggestOpen && modSubsList.length > 0 && (
								<div className={css.suggest}>
									<table>
										<tbody>
											{modSubsList
												.filter((subreddit,) =>
													subreddit.toUpperCase().includes(searchSubInput.toUpperCase(),)
												)
												.slice(0, 50,)
												.map((subreddit,) => (
													<tr
														key={subreddit}
														onMouseDown={(event,) => {
															event.preventDefault()
															setSearchSubInput(subreddit,)
															setSuggestOpen(false,)
														}}
													>
														<td>{subreddit}</td>
													</tr>
												))}
										</tbody>
									</table>
								</div>
							)}
						</span>
					</label>
					<label className={css.field}>
						<span>Content</span>
						<input
							type="text"
							placeholder="content (optional)"
							className={css.searchInput}
							value={searchContentInput}
							onChange={(event,) => setSearchContentInput(event.target.value,)}
						/>
					</label>
					<label
						className={css.switch}
						title="Treat subreddit and content fields as regular expressions"
					>
						<input
							type="checkbox"
							checked={searchRegexInput}
							onChange={(event,) => setSearchRegexInput(event.target.checked,)}
						/>
						<span className={css.switchTrack} aria-hidden="true">
							<span className={css.switchThumb} />
						</span>
						<span>Regex</span>
					</label>
					<ActionButton type="submit" primary disabled={state.searchRunning}>Search</ActionButton>
					{(state.searchActive || searchSubInput || searchContentInput) && (
						<ActionButton type="button" onClick={clearSearch}>Clear search</ActionButton>
					)}
					{state.searchActive && state.searchSubreddit && !state.searchRunning
						&& subBanState !== undefined && subBanState !== null && subBanState.days_left === null && (
							<ActionButton
								type="button"
								onClick={() => setShowBulkRemove(true,)}
							>
								Remove all from /r/{state.searchSubreddit}
							</ActionButton>
						)}
				</form>
				<div className={css.statusRow}>
					{state.searchActive && state.searchSubreddit && (
						<span className={css.chip}>/r/{state.searchSubreddit}</span>
					)}
					{state.searchActive && state.searchSubreddit && subBanState !== undefined && (
						<span className={css.chip}>
							{subBanState === null
								? 'Not banned'
								: subBanState.days_left === null
								? `Permanently banned${subBanState.note ? `: ${subBanState.note}` : ''}`
								: `Temporarily banned (${subBanState.days_left} day${
									subBanState.days_left === 1 ? '' : 's'
								} remaining)${subBanState.note ? `: ${subBanState.note}` : ''}`}
						</span>
					)}
					{state.searchActive && state.searchContent && (
						<span className={css.chip}>
							{state.searchRegex ? 'regex' : 'text'}: {state.searchContent}
						</span>
					)}
					{state.searchRunning && (
						<span className={css.searchStatus}>
							Searching page {state.searchPageCount + 1}
						</span>
					)}
					{state.searchActive && !state.searchRunning && state.searchPageCount > 0 && (
						<span className={css.searchStatus}>
							{state.searchResultCount} result{state.searchResultCount === 1 ? '' : 's'} across{' '}
							{state.searchPageCount} page{state.searchPageCount === 1 ? '' : 's'}
						</span>
					)}
					{state.searchRunning && (
						<ActionButton onClick={cancelSearch}>Cancel search</ActionButton>
					)}
				</div>
			</div>
			{showBulkRemove && state.searchSubreddit
				&& subBanState !== undefined && subBanState !== null && subBanState.days_left === null && (
					<BulkRemovePanel
						user={user}
						subreddit={state.searchSubreddit}
						onClose={() => setShowBulkRemove(false,)}
					/>
				)}
			<div ref={feedPanelRef} className={css.feedPanel}>
				{errorMsg && <div className={css.error}>{errorMsg}</div>}
				{!errorMsg && !state.loaded && !state.searchRunning && (
					<div className={css.emptyState}>Loading profile activity...</div>
				)}
				{showNoSearchResults && (
					<div className={css.emptyState}>No profile entries match the current search.</div>
				)}
				<div ref={sitetableRef} className={`toolbox-sitetable ${css.sitetable}`} />
				{isFetching && state.loaded && (
					<div className={css.loadingMore}>Loading...</div>
				)}
				<div ref={sentinelRef} />
			</div>
		</div>
	)
}
