/** Developer tool for rendering Reddit comment/thread/listing UI elements and testing in-page notifications. */
import {useRef, useState,} from 'react'

import type {RedditListing,} from '../../../api/resources/subreddits'
import type {CommentData, RedditContentThing, RedditMoreChildren, RedditThing,} from '../../../api/resources/things'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {Backdrop,} from '../../../shared/window/Backdrop'
import {Window,} from '../../../shared/window/Window'
import {forEachChunkedDynamic,} from '../../../util/data/iter'
import {notification,} from '../../../util/ui/notifications'
import {
	makeCommentThread,
	makeSingleComment,
	makeSubmissionEntry,
	tbRedditEvent,
} from '../../../util/ui/redditElementsInit'

import css from './CommentUITester.module.css'

/** Props for the CommentUITester component. */
export interface CommentUITesterProps {
	onClose: () => void
	/**
	 * Fetches a Reddit JSON listing for the given path (or absolute URL when `absolute` is true).
	 * Returns `any` because this devtools tester fetches arbitrary dev-entered URLs whose response
	 * shape varies with the URL and the selected render mode.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary dev-entered listing JSON
	fetchListing: (url: string, absolute: boolean,) => Promise<any>
}

export function CommentUITester ({onClose, fetchListing,}: CommentUITesterProps,) {
	const siteTableRef = useRef<HTMLDivElement>(null,)
	const [url, setUrl,] = useState('',)
	const [absolute, setAbsolute,] = useState(false,)
	const [notifTitle, setNotifTitle,] = useState('',)
	const [notifBody, setNotifBody,] = useState('',)
	const [notifPath, setNotifPath,] = useState('',)

	async function fetchAndRender (mode: 'single' | 'thread' | 'listing',) {
		if (!siteTableRef.current) { return }
		siteTableRef.current.replaceChildren()
		if (!url) { return }
		const data: unknown = await fetchListing(url, absolute,)
		const commentOptions = {
			parentLink: true,
			contextLink: true,
			fullCommentsLink: true,
		}
		if (mode === 'thread') {
			const thread = data as [unknown, RedditListing<RedditThing<CommentData> | RedditMoreChildren>,]
			const comments = makeCommentThread(thread[1].data.children, commentOptions,)
			siteTableRef.current.appendChild(comments,)
			tbRedditEvent(comments,)
		} else if (mode === 'single') {
			const thread = data as [unknown, RedditListing<RedditThing<CommentData>>,]
			const comment = makeSingleComment(thread[1].data.children[0]!, commentOptions,)
			siteTableRef.current.appendChild(comment,)
			tbRedditEvent(comment,)
		} else {
			const listing = data as RedditListing<RedditContentThing>
			await forEachChunkedDynamic(listing.data.children, (entry: RedditContentThing,) => {
				if (entry.kind === 't3' && siteTableRef.current) {
					const submission = makeSubmissionEntry(entry,)
					siteTableRef.current.appendChild(submission,)
				}
			},)
			if (siteTableRef.current) { tbRedditEvent(siteTableRef.current,) }
		}
	}

	function fireNotification () {
		void notification(notifTitle, notifBody, notifPath,)
	}

	return (
		<Backdrop onClickOutside={onClose}>
			<Window
				title="Comment UI tester"
				className={css.window}
				onClose={onClose}
			>
				<div className={css.content}>
					<div ref={siteTableRef} className={css.siteTable}></div>
					<div className={css.inputs}>
						<input
							type="text"
							placeholder="json url or path"
							className="toolbox-input"
							value={url}
							onChange={(event,) => setUrl(event.target.value,)}
						/>
						<label className={css.absoluteLabel}>
							<input
								type="checkbox"
								checked={absolute}
								onChange={(event,) => setAbsolute(event.target.checked,)}
							/>
							absolute URL
						</label>
						<ActionButton onClick={() => void fetchAndRender('single',)}>fetch single</ActionButton>
						<ActionButton onClick={() => void fetchAndRender('thread',)}>fetch thread</ActionButton>
						<ActionButton onClick={() => void fetchAndRender('listing',)}>
							fetch submission listing
						</ActionButton>
					</div>
					<div className={css.notifSection}>
						<h1>Notification tester</h1>
						<code>notification = function (title, body, path)</code>
						<hr />
						<input
							type="text"
							placeholder="title"
							className="toolbox-input"
							value={notifTitle}
							onChange={(event,) => setNotifTitle(event.target.value,)}
						/>
						<br />
						<input
							type="text"
							placeholder="body"
							className="toolbox-input"
							value={notifBody}
							onChange={(event,) => setNotifBody(event.target.value,)}
						/>
						<br />
						<input
							type="text"
							placeholder="path"
							className="toolbox-input"
							value={notifPath}
							onChange={(event,) => setNotifPath(event.target.value,)}
						/>
						<br />
						<ActionButton onClick={fireNotification}>notification</ActionButton>
					</div>
				</div>
			</Window>
		</Backdrop>
	)
}
