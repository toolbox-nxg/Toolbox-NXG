/** DOM integration for the ModActions module - registers the inline Shreddit mod-action row. */

import {renderAtLocation,} from '../../dom/uiLocations'
import {FlatListModActions,} from './components/FlatListModActions'

/**
 * Registers the inline mod-action buttons at the `thingFlatListActions` location and returns the
 * cleanup. The location is only provided on Shreddit, so this never renders on old Reddit. `order: 10`
 * places this set after the order -10 vote arrows (commentActions.vote) and the default-order (0)
 * controls (the Second-opinion toggle and the "Add removal reason" link), and before the order 20
 * Reply / ⋯ Expand toggle (commentActions.extras); the Toolbox Spam and Remove links are emitted by
 * this set itself. Reads the NSFW state and permalink (not carried in the location context) from the
 * thing element directly.
 */
export function createModActionsSlot (): () => void {
	return renderAtLocation(
		'thingFlatListActions',
		{id: 'modactions.row', order: 10,},
		({context, target,},) => {
			const {subreddit, thingId, kind, isRemoved,} = context
			if (!subreddit || !thingId) { return null }
			if (kind !== 'post' && kind !== 'comment') { return null }

			const thing = kind === 'post'
				? target.closest('shreddit-post',)
				: target.closest('shreddit-comment',)
			// Shreddit boolean attribute: present (`nsfw=""`) means NSFW; absent means not.
			const initialNsfw = thing?.hasAttribute('nsfw',) ?? false
			// Lock/sticky seed so the toggle's first click goes the right way. Posts carry `locked` /
			// `stickied` boolean attributes; a comment has no lock attribute - Reddit adds a `<locked>`
			// badge inside the comment's own `shreddit-comment-badges` instead. Scope the comment check
			// via `:scope > [slot="commentMeta"]` so a parent isn't marked locked by a nested reply's
			// badge. Sticky is post-only. Isolated here for an easy fix if Shreddit's markup changes.
			const initialLocked = kind === 'post'
				? thing?.hasAttribute('locked',) ?? false
				: thing?.querySelector(':scope > [slot="commentMeta"] shreddit-comment-badges locked',) != null
			const initialStickied = thing?.hasAttribute('stickied',) ?? false
			const link = thing?.getAttribute('permalink',) ?? undefined
			// Comment author, used to limit Distinguish to the viewer's own comments.
			const author = thing?.getAttribute('author',) ?? undefined

			return (
				<FlatListModActions
					subreddit={subreddit}
					itemId={thingId}
					itemKind={kind}
					isRemoved={isRemoved ?? false}
					initialNsfw={initialNsfw}
					initialLocked={initialLocked}
					initialStickied={initialStickied}
					link={link}
					author={author}
				/>
			)
		},
	)
}
