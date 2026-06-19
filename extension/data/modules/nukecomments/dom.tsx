/** DOM-level rendering logic for the Comment Nuke module, including the nuke button UI. */

import {useState,} from 'react'

import {renderAtLocation,} from '../../dom/uiLocations'
import {AuthorButton,} from '../../shared/controls/AuthorButton'
import {GeneralButton,} from '../../shared/controls/GeneralButton'
import {IsModGuard,} from '../../shared/controls/IsModGuard'
import {negativeTextFeedback,} from '../../store/feedback'
import createLogger from '../../util/infra/logging'
import {RedditPlatform,} from '../../util/infra/platform'
import {pageDetails,} from '../../util/reddit/pageContext'
import {drawPosition,} from '../../util/ui/drawPosition'
import {showNukeCommentsPopup,} from './components/NukeCommentsPopup'
import type {ExecutionType,} from './schema'
import type {NukeCommentsSettings,} from './settings'

const log = createLogger('CommentNuke',)

/**
 * Renders a button that opens the {@link NukeCommentsPopup} for the given comment chain.
 * Only one popup can be open at a time; clicking while one is open shows a warning.
 */
function NukeButton (
	{commentID, postID, subreddit, label, ignoreDistinguished, executionType, author = false, className,}: {
		/** Base-36 comment ID (without `t1_` prefix). */
		commentID: string
		/** Base-36 post ID (without `t3_` prefix). */
		postID: string
		subreddit: string
		/** Button text (e.g. "Nuke" on old Reddit, "R" on Shreddit). */
		label: string
		ignoreDistinguished: boolean
		executionType: ExecutionType
		author?: boolean
		className?: string
	},
) {
	const [isOpen, setIsOpen,] = useState(false,)

	const handleClick = (event: React.MouseEvent<HTMLElement>,) => {
		log.debug('nuke button clicked.',)
		if (isOpen) {
			negativeTextFeedback('Nuke popup is already open.',)
			return
		}
		setIsOpen(true,)
		const positions = drawPosition(event.nativeEvent,)
		showNukeCommentsPopup({
			commentID,
			postID,
			subreddit,
			defaultIgnoreDistinguished: ignoreDistinguished,
			defaultExecutionType: executionType,
			initialPosition: {top: positions.topPosition, left: positions.leftPosition,},
			onClose: () => {
				setIsOpen(false,)
			},
		},)
	}

	const Button = author ? AuthorButton : GeneralButton
	return (
		<Button
			type="button"
			className={className}
			title="Remove comment chain starting with this comment"
			onClick={handleClick}
		>
			{label}
		</Button>
	)
}

/**
 * Registers the nuke button at the appropriate UI locations based on the current settings.
 * The button appears either under each comment's action row or next to the author's username,
 * depending on `showNextToUser`.
 *
 * @returns A cleanup function that unregisters both renderers.
 */
export function createNukeCommentsHandlers (
	{ignoreDistinguished, showNextToUser, executionType,}: NukeCommentsSettings,
): () => void {
	function isOnCommentsPage () {
		const pageType = pageDetails.pageType
		return pageType === 'subredditCommentsPage' || pageType === 'subredditCommentPermalink'
	}

	const unregisterThing = renderAtLocation('thingActions', {id: 'nukecomments.thing',}, ({context,},) => {
		if (showNextToUser) { return null }
		if (context.kind !== 'comment') { return null }
		if (!isOnCommentsPage()) { return null }
		const {thingId, postId, subreddit,} = context
		if (!thingId || !postId || !subreddit) { return null }
		return (
			<IsModGuard subreddit={subreddit}>
				<NukeButton
					commentID={thingId.substring(3,)}
					postID={postId.substring(3,)}
					subreddit={subreddit}
					label={context.platform === RedditPlatform.Old ? 'Nuke' : 'R'}
					ignoreDistinguished={ignoreDistinguished}
					executionType={executionType}
					className="toolbox-nuke-button"
				/>
			</IsModGuard>
		)
	},)

	const unregisterAuthor = renderAtLocation(
		'authorActions',
		{id: 'nukecomments.author', order: 50,},
		({context,},) => {
			if (!showNextToUser) { return null }
			if (!isOnCommentsPage()) { return null }
			const {thingId, postId, subreddit,} = context
			if (!thingId?.startsWith('t1_',) || !postId || !subreddit) { return null }
			return (
				<IsModGuard subreddit={subreddit}>
					<NukeButton
						commentID={thingId.substring(3,)}
						postID={postId.substring(3,)}
						subreddit={subreddit}
						label="R"
						ignoreDistinguished={ignoreDistinguished}
						executionType={executionType}
						author
						className="toolbox-nuke-button"
					/>
				</IsModGuard>
			)
		},
	)

	return () => {
		unregisterThing()
		unregisterAuthor()
	}
}
