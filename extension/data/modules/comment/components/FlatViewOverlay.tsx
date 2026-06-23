/**
 * Full-page overlay that fetches all comments for a thread and displays them in a flat,
 * chronological list with real-time name/content filtering.
 */
import {useEffect, useRef, useState,} from 'react'

import {getCommentsPageListing,} from '../../../api/resources/comments'
import type {CommentData, RedditThing,} from '../../../api/resources/things'
import {Backdrop,} from '../../../shared/window/Backdrop'
import {Window,} from '../../../shared/window/Window'
import store from '../../../store'
import {neutralTextFeedback,} from '../../../store/feedback'
import {startSpinner, stopSpinner,} from '../../../store/spinnerSlice'
import {saneSortDescending,} from '../../../util/data/array'
import {forEachChunkedDynamic,} from '../../../util/data/iter'
import createLogger from '../../../util/infra/logging'
import {mountPopup,} from '../../../util/ui/reactMount'
import {colorSaltReady, makeSingleComment, tbRedditEvent,} from '../../../util/ui/redditElementsInit'

import css from './FlatViewOverlay.module.css'

const log = createLogger('Comments',)

/** Callback invoked when the user requests a context popup for a specific comment. */
type ContextPopupHandler = (commentId: string, permalink: string, event: MouseEvent,) => void

/** Props for the FlatViewOverlay component. */
interface FlatViewOverlayProps {
	/**
	 * Handler to open a context popup when a comment's context link is clicked,
	 * or `false` to disable context popups.
	 */
	openContextInPopup: ContextPopupHandler | false
	/** Called when the overlay is closed. */
	onClose: () => void
}

function FlatViewOverlay ({openContextInPopup, onClose,}: FlatViewOverlayProps,) {
	const sitetableRef = useRef<HTMLDivElement>(null,)
	const [searchName, setSearchName,] = useState('',)
	const [searchContent, setSearchContent,] = useState('',)
	const [visibleCount, setVisibleCount,] = useState(0,)
	const [totalCount, setTotalCount,] = useState(0,)

	useEffect(() => {
		const sitetable = sitetableRef.current
		if (!sitetable) { return }

		const flatListing: Record<string, RedditThing<CommentData>> = {}
		let idListing: string[] = []

		// Recursive walk over heterogeneous comment-tree nodes (Listing / t1 / more) that also
		// deep-clones and reads dynamic fields; `RedditThing.kind` being a broad string makes a
		// typed discriminated walk impractical here.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped recursive JSON walk
		function parseComments (object: any,) {
			switch (object.kind) {
				case 'Listing':
					for (let i = 0; i < object.data.children.length; i++) {
						parseComments(object.data.children[i],)
					}
					break
				case 't1': {
					const cloned = JSON.parse(JSON.stringify(object,),)
					flatListing[object.data.id] = cloned
					idListing.push(object.data.id,)
					if (
						Object.prototype.hasOwnProperty.call(cloned.data, 'replies',)
						&& cloned.data.replies
						&& typeof cloned.data.replies === 'object'
					) {
						parseComments(object.data.replies,)
					}
					break
				}
			}
		}

		let cancelled = false
		let finishTimeoutId: ReturnType<typeof setTimeout> | null = null
		store.dispatch(startSpinner(),)
		neutralTextFeedback('Fetching comment data.',)
		// The fetched listing is augmented in place (`isreply`) before the recursive parse, so it is
		// consumed as `any` rather than the read-only RedditCommentPageListing[] return type.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- listing is mutated before parsing
		getCommentsPageListing(location.pathname,).then(async (data: any,) => {
			if (cancelled) { return }
			if (!data?.[1]) { return }
			data[1].isreply = false
			parseComments(data[1],)
			idListing = saneSortDescending(idListing,)

			const commentOptions = {
				parentLink: true,
				contextLink: true,
				fullCommentsLink: true,
				noOddEven: true,
				contextPopup: openContextInPopup || false,
			}
			let count = 0
			await colorSaltReady
			await forEachChunkedDynamic(idListing, (id: string,) => {
				if (cancelled || !sitetableRef.current) { return }
				count++
				neutralTextFeedback(`Building comment ${count}/${idListing.length}`,)
				const item = flatListing[id]
				if (!item) { return }
				// Strip nested replies so each comment is rendered standalone in
				// the flat list (replies appear as their own entries via idListing).
				item.data.replies = ''
				const comment = makeSingleComment(item, commentOptions,)
				sitetableRef.current.appendChild(comment,)
			},)
			if (cancelled) { return }
			setTotalCount(count,)
			setVisibleCount(count,)
			finishTimeoutId = setTimeout(() => {
				finishTimeoutId = null
				if (sitetableRef.current) { tbRedditEvent(sitetableRef.current,) }
				store.dispatch(stopSpinner(),)
			}, 1000,)
		},).catch((error: unknown,) => log.error(error,))

		return () => {
			cancelled = true
			if (finishTimeoutId != null) { clearTimeout(finishTimeoutId,) }
			store.dispatch(stopSpinner(),)
		}
		// Mount-once: this effect owns a per-run `cancelled` flag and rebuilds the entire sitetable.
		// `openContextInPopup` is a fixed setting for the overlay's lifetime, so re-running on it would
		// only race a fresh build against the prior chain's stale flags.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [],)

	useEffect(() => {
		log.debug('typing', searchName, searchContent,)
		const sitetable = sitetableRef.current
		if (!sitetable) { return }
		const nameUpper = searchName.toUpperCase()
		const contentUpper = searchContent.toUpperCase()
		let visible = 0
		sitetable.querySelectorAll('.toolbox-comment',).forEach((comment,) => {
			const flatUserName = comment.querySelector('.toolbox-tagline a.toolbox-comment-author',)?.textContent || ''
			const flatContent = comment.querySelector('.toolbox-comment-body .md',)?.textContent || ''
			const hide = flatUserName.toUpperCase().indexOf(nameUpper,) < 0
				|| flatContent.toUpperCase().indexOf(contentUpper,) < 0
			;(comment as HTMLElement).style.display = hide ? 'none' : ''
			if (!hide) { visible += 1 }
		},)
		setVisibleCount(visible,)
	}, [searchName, searchContent, totalCount,],)

	return (
		<Backdrop onClickOutside={onClose}>
			<Window title="Flatview" className={css.window} onClose={onClose}>
				<div className={css.search}>
					Filter by name:{' '}
					<input
						type="text"
						className={`toolbox-input ${css.input}`}
						placeholder="start typing..."
						value={searchName}
						onChange={(event,) => setSearchName(event.target.value,)}
					/>
					Filter by content:{' '}
					<input
						type="text"
						className={`toolbox-input ${css.input}`}
						placeholder="start typing..."
						value={searchContent}
						onChange={(event,) => setSearchContent(event.target.value,)}
					/>
					<span className={css.count}>{visibleCount}</span>
				</div>
				<div ref={sitetableRef} className={css.sitetable}></div>
			</Window>
		</Backdrop>
	)
}

/**
 * Mounts a `FlatViewOverlay` into the page body and returns a handle to close it.
 * @param openContextInPopup Handler for context popup clicks, or `false` to disable.
 */
export function showFlatViewOverlay (openContextInPopup: ContextPopupHandler | false,) {
	return mountPopup((onClose,) => <FlatViewOverlay openContextInPopup={openContextInPopup} onClose={onClose} />)
}
