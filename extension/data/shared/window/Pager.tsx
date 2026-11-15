/** Paged content viewer: displays one page of an iterable at a time with
 * navigation controls. */

import {type ReactNode, useEffect, useEffectEvent, useMemo, useRef, useState,} from 'react'
import type {MaybeAsyncIterable,} from '../../util/data/iter'
import createLogger from '../../util/infra/logging'
import {classes,} from '../../util/ui/reactMount'
import {GeneralButton,} from '../controls/GeneralButton'
import css from './Pager.module.css'

const log = createLogger('Pager',)

type PageIterator = AsyncIterator<ReactNode, void> | Iterator<ReactNode, void>

/** Everything the pager knows about one iterator. A new iterator starts from a fresh state. */
interface PagerState {
	iterator: PageIterator
	/** Pages read from the iterator so far. */
	pages: ReactNode[]
	/** Whether the iterator has finished (or failed). */
	done: boolean
	/** The page being viewed; one past the cache while "load more" fetches it. */
	index: number
	/** The page that was showing when `index` was requested, kept on screen while it loads. */
	fallbackIndex: number
	/**
	 * The page the previous iterator was showing, kept on screen until this iterator's first page
	 * arrives, so switching sources doesn't flash a loading state.
	 */
	carriedPage: ReactNode
}

/** The state for an iterator nothing has been read from yet. */
function initialPagerState (iterator: PageIterator,): PagerState {
	return {iterator, pages: [], done: false, index: 0, fallbackIndex: 0, carriedPage: null,}
}

/** The index actually displayed: `index`, or `fallbackIndex` while `index` is still loading. */
function displayedIndex (state: PagerState,): number {
	return state.index < state.pages.length ? state.index : state.fallbackIndex
}

/** The page on screen for `state`, if any. */
function displayedPage (state: PagerState,): ReactNode {
	return state.pages[displayedIndex(state,)] ?? state.carriedPage
}

/**
 * Displays one page at a time from an iterable of sequential content pages,
 * with a button row for navigating between them.
 */
export const Pager = ({
	lazy = true,
	controlPosition = 'top',
	emptyContent,
	pages,
}: {
	/**
	 * If true, not all pages will be pulled from the iterable at once. The
	 * final page count won't be known; a "load more" button will be displayed
	 * to attempt to load the next page. Good for asynchronous iterators where
	 * computing the next page is expensive and not all pages will be needed.
	 */
	lazy?: boolean
	/** Where the controls are displayed relative to the page content. */
	controlPosition: 'top' | 'bottom'
	/** Content to display in case the given iterable returns no pages. */
	emptyContent: ReactNode
	/** An iterable of pages to be displayed. */
	pages: MaybeAsyncIterable<ReactNode>
},) => {
	// Extract the iterator from the iterable we're passed in. Annotate the union
	// explicitly: indexing a `MaybeAsyncIterable` by its iterator symbol otherwise
	// widens the result to `any`, which would taint every page value read below.
	const iterator = useMemo((): PageIterator => {
		if (Symbol.asyncIterator in pages) {
			return pages[Symbol.asyncIterator]()
		}
		return pages[Symbol.iterator]()
	}, [pages,],)

	const [storedState, setStoredState,] = useState(() => initialPagerState(iterator,))
	// A different iterator starts over from its first page. Derived during render rather than
	// reset in an effect, so the old iterator's pages never render against the new one.
	const freshState = useMemo(() => initialPagerState(iterator,), [iterator,],)
	const state = storedState.iterator === iterator
		? storedState
		: {...freshState, carriedPage: displayedPage(storedState,),}
	const {pages: cachedPages, done: pagesDone,} = state

	/** Updates the current iterator's state (from a handler or effect of the latest render). */
	const update = (change: (current: PagerState,) => Partial<PagerState>,) => {
		setStoredState((prev,) => {
			const base = prev.iterator === iterator ? prev : {...freshState, carriedPage: displayedPage(prev,),}
			return {...base, ...change(base,),}
		},)
	}

	// Past the last page of a finished iterator there is nothing to load: show the last page
	// instead (or page 0, the empty state, when there are no pages at all).
	const currentPageIndex = pagesDone && state.index >= cachedPages.length
		? Math.max(0, cachedPages.length - 1,)
		: state.index

	// A page is needed when the viewed one isn't cached yet (or, when not lazy, until all are), and
	// one is being read exactly then: the effect below starts the read. Derived rather than flagged
	// when a read starts, so it can never get out of step with the read itself.
	const awaitingNextPage = !pagesDone && (!lazy || currentPageIndex >= cachedPages.length)

	// The iterator the latest render is showing, so a read that settles after the source changed
	// can tell it is stale; and the iterator being read, so two reads never run at once.
	const currentIteratorRef = useRef(iterator,)
	const readingRef = useRef<PageIterator | null>(null,)
	useEffect(() => {
		currentIteratorRef.current = iterator
	}, [iterator,],)

	/** Reads the next value from the iterator into our page cache. */
	async function cacheNextPage () {
		const forIterator = iterator
		if (pagesDone || readingRef.current === forIterator) {
			return
		}
		readingRef.current = forIterator

		/** Applies a read's result, unless the pager has moved on to another source. */
		const commit = (change: (current: PagerState,) => Partial<PagerState>,) => {
			if (currentIteratorRef.current !== forIterator) { return }
			setStoredState((prev,) => {
				const base = prev.iterator === forIterator ? prev : {...freshState, carriedPage: displayedPage(prev,),}
				return {...base, ...change(base,),}
			},)
		}
		try {
			const {value, done,} = await forIterator.next()
			commit((current,) => done ? {done: true,} : {pages: [...current.pages, value,],})
		} catch (error: unknown) {
			// A failed page fetch must not wedge the pager: marking paging done stops a tight retry
			// loop for what is almost always a persistent error (there's nothing more to load).
			log.error('Failed to load next page', error,)
			commit(() => ({done: true,}))
		} finally {
			if (readingRef.current === forIterator) { readingRef.current = null }
		}
	}

	// Effect event so the effect below re-runs only on paging state, not on each new cacheNextPage closure
	const requestNextPage = useEffectEvent(() => void cacheNextPage())

	// Pull new pages off our iterator as needed: all of them when not lazy, otherwise until the
	// page being viewed is cached.
	useEffect(() => {
		if (!pagesDone && (!lazy || currentPageIndex >= cachedPages.length)) {
			requestNextPage()
		}
	}, [lazy, cachedPages, pagesDone, currentPageIndex,],)

	// Render the current page
	const currentPage = useMemo(() => {
		// if we've already received this page, display it - easy
		if (currentPageIndex < cachedPages.length) {
			return cachedPages[currentPageIndex]
		}
		// a finished iterator with nothing at the (clamped) index has no pages at all
		if (pagesDone) {
			return emptyContent
		}
		// if we *can* get more pages, keep showing the page we came from while we
		// work to avoid a flash; fall back to a loading state on first load
		return cachedPages[state.fallbackIndex] ?? state.carriedPage ?? <p>Loading...</p>
	}, [cachedPages, pagesDone, currentPageIndex, state.fallbackIndex, state.carriedPage, emptyContent,],)

	/** Moves to page `index`, remembering the page on screen to show while it loads. */
	const goToPage = (index: number,) => {
		update((current,) => ({index, fallbackIndex: displayedIndex(current,),}))
	}

	// Render the controls
	const controls = (
		<div className={css.controls}>
			{/* a button for each page we've already loaded */}
			{cachedPages.map((_page, i,) => (
				<GeneralButton
					// oxlint-disable-next-line react/no-array-index-key -- the index is the page number, which is the button's identity
					key={i}
					className={classes(
						css.control,
						currentPageIndex === i && css.active,
					)}
					onClick={() => goToPage(i,)}
				>
					{i + 1}
				</GeneralButton>
			))}
			{/* if we can still try to load more pages, a "load more" button to do that */}
			{pagesDone || (
				<GeneralButton
					className={css.control}
					disabled={awaitingNextPage}
					onClick={() => goToPage(cachedPages.length,)}
				>
					{awaitingNextPage ? 'loading...' : 'load more...'}
				</GeneralButton>
			)}
		</div>
	)

	return (
		<div>
			{controlPosition === 'top' && controls}
			<div className={css.content}>
				{currentPage}
			</div>
			{controlPosition === 'bottom' && controls}
		</div>
	)
}
