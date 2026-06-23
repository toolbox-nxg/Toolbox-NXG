/** Paged content viewer: displays one page of an iterable at a time with
 * navigation controls. */

import {type ReactNode, useEffect, useMemo, useState,} from 'react'
import type {MaybeAsyncIterable,} from '../../util/data/iter'
import {classes,} from '../../util/ui/reactMount'
import {GeneralButton,} from '../controls/GeneralButton'
import css from './Pager.module.css'

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
	const iterator = useMemo((): AsyncIterator<ReactNode, void> | Iterator<ReactNode, void> => {
		if (Symbol.asyncIterator in pages) {
			return pages[Symbol.asyncIterator]()
		}
		return pages[Symbol.iterator]()
	}, [pages,],)

	// Store the pages we've read from the iterator
	const [cachedPages, setCachedPages,] = useState([] as ReactNode[],)
	// Keep track of whether the iterator has finished
	const [pagesDone, setPagesDone,] = useState(false,)
	// The page we're currently looking at
	const [currentPageIndex, setCurrentPageIndex,] = useState(0,)

	// Reset our page cache and start over from the first page if we ever end up
	// working with a different iterator
	useEffect(() => {
		setCachedPages([],)
		setPagesDone(false,)
		setCurrentPageIndex(0,)
	}, [iterator,],)

	// Keep track of whether we're already loading a page so we don't attempt to
	// load two pages at the same time
	const [awaitingNextPage, setAwaitingNextPage,] = useState(false,)

	// Hold on to the last page we successfully rendered so we can show it
	// while the next page is loading, rather than flashing a loading state
	const [lastRenderedPage, setLastRenderedPage,] = useState<ReactNode>(null,)
	useEffect(() => {
		if (currentPageIndex < cachedPages.length) {
			setLastRenderedPage(cachedPages[currentPageIndex],)
		}
	}, [cachedPages, currentPageIndex,],)

	/** Loads the next value from the iterator into our page cache. */
	async function cacheNextPage () {
		if (pagesDone) {
			return
		}
		if (awaitingNextPage) {
			return
		}

		setAwaitingNextPage(true,)
		const {value, done,} = await iterator.next()
		if (done) {
			setPagesDone(true,)
		} else {
			setCachedPages((pages,) => [...pages, value,])
		}
		setAwaitingNextPage(false,)
	}

	// Pull new pages off our iterator as needed
	useEffect(() => {
		// if we're not lazy, gotta cache 'em all
		if (!lazy && !pagesDone) {
			void cacheNextPage()
			return
		}

		if (currentPageIndex >= cachedPages.length) {
			// We're looking at a page we don't have cached
			if (pagesDone) {
				// There are no more pages to load, so we can never see this
				// page; snap back to the last available page (if we have *no*
				// pages then we go to page 0 and display the `emptyContent`)
				setCurrentPageIndex(Math.max(0, cachedPages.length - 1,),)
			} else {
				// Cache additional pages until we get the one we want
				void cacheNextPage()
			}
		}
	}, [lazy, cachedPages, pagesDone, currentPageIndex,],)

	// Render the current page
	const currentPage = useMemo(() => {
		// if we've already received this page, display it - easy
		if (currentPageIndex < cachedPages.length) {
			return cachedPages[currentPageIndex]
		}

		if (pagesDone) {
			if (!cachedPages.length) {
				// if there are *no* pages to show, display the `emptyContent`
				return emptyContent
			}

			// if we don't have this page and can't get more, display an error.
			// this should basically never be seen since we immediately set the
			// index back to the last page in the effect above, but shrug
			return <p>Error: there is no {currentPageIndex}th page</p>
		}

		// if we *can* get more pages, show the last rendered page while we
		// work to avoid a flash; fall back to a loading state on first load
		return lastRenderedPage ?? <p>Loading...</p>
	}, [cachedPages, pagesDone, currentPageIndex, lastRenderedPage, emptyContent,],)

	// Render the controls
	const controls = (
		<div className={css.controls}>
			{/* a button for each page we've already loaded */}
			{cachedPages.map((_page, i,) => (
				<GeneralButton
					key={i}
					className={classes(
						css.control,
						currentPageIndex === i && css.active,
					)}
					onClick={() => setCurrentPageIndex(i,)}
				>
					{i + 1}
				</GeneralButton>
			))}
			{/* if we can still try to load more pages, a "load more" button to do that */}
			{pagesDone || (
				<GeneralButton
					className={css.control}
					disabled={awaitingNextPage}
					onClick={() => setCurrentPageIndex(cachedPages.length,)}
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
