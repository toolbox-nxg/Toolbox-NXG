/** Popup window that displays comment context for a specific comment thread in a floating overlay. */
import {useLayoutEffect, useMemo, useRef,} from 'react'

import type {CommentData, RedditMoreChildren, RedditThing,} from '../../../api/resources/things'
import {getCommentEntryByCommentId,} from '../../../dom/shreddit/comments'
import {Window,} from '../../../shared/window/Window'
import {purifyObject,} from '../../../util/data/purify'
import {mountPopup,} from '../../../util/ui/reactMount'
import {getSubredditColorSalt, tbRedditEvent,} from '../../../util/ui/redditElementsInit'
import {TBCommentChildren,} from '../../shared/redditElements/TBComment'

import css from './ContextPopup.module.css'

/** Props for the ContextPopup component. */
interface ContextPopupProps {
	/** Window title shown in the popup header. */
	title: string
	/** Initial screen position of the popup. */
	initialPosition: {top: number; left: number}
	/** Raw Reddit API comment/more child objects to render (forwarded to `TBCommentChildren`). */
	commentsData: (RedditThing<CommentData> | RedditMoreChildren)[]
	/** If provided, the comment with this ID will be highlighted. */
	highlightCommentId?: string
	/** Called when the popup is closed. */
	onClose: () => void
}

const commentOptions = {
	parentLink: true,
	contextLink: true,
	fullCommentsLink: true,
}

function ContextPopup (
	{title, initialPosition, commentsData, highlightCommentId, onClose,}: ContextPopupProps,
) {
	const containerRef = useRef<HTMLDivElement>(null,)

	const purifiedData = useMemo(() =>
		commentsData.map((item,) => {
			purifyObject(item,)
			return item
		},), [commentsData,],)

	useLayoutEffect(() => {
		if (!containerRef.current) { return }
		tbRedditEvent(containerRef.current,)
		if (highlightCommentId) {
			const entry = getCommentEntryByCommentId(containerRef.current, highlightCommentId,)
			if (entry) {
				;(entry as HTMLElement).style.setProperty('background-color', 'var(--toolbox-highlight-bg)',)
			}
		}
	}, [purifiedData, highlightCommentId,],)

	return (
		<Window
			title={title}
			draggable
			initialPosition={initialPosition}
			className={`context-button-popup ${css.window}`}
			onClose={onClose}
		>
			<div ref={containerRef} className={css.content}>
				<TBCommentChildren
					items={purifiedData}
					options={commentOptions}
					subredditColorSalt={getSubredditColorSalt()}
				/>
			</div>
		</Window>
	)
}

/**
 * Mounts a `ContextPopup` into the page body and returns a handle to close it.
 * @param props All `ContextPopupProps` except `onClose`, which is managed internally.
 */
export function showContextPopup (props: Omit<ContextPopupProps, 'onClose'>,) {
	// Per-target by the highlighted comment (falling back to the window title), so
	// re-clicking the same context button reveals the existing popup rather than stacking.
	return mountPopup(
		(onClose,) => <ContextPopup {...props} onClose={onClose} />,
		undefined,
		`context:${props.highlightCommentId ?? props.title}`,
	)
}
