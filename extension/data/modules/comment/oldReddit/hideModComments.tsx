/** Registers a button in the comment-thread controls area that hides all moderator-action comments on the page. */
import {useEffect, useState,} from 'react'

import {renderAtLocation,} from '../../../dom/uiLocations'
import {GeneralButton,} from '../../../shared/controls/GeneralButton'
import createLogger from '../../../util/infra/logging'
import {type CommentModuleAdapter,} from '../platformInterface'

const log = createLogger('Comments',)

/** Props for the HideModCommentsButton component. */
interface HideModCommentsButtonProps {
	/** Adapter used to find and hide moderator-action comment containers. */
	adapter: CommentModuleAdapter
}

/**
 * Renders a button that hides all moderator-action comments on the page.
 * The button only appears once at least one mod-action comment is present, and re-applies
 * the hide operation as new things load while it is active.
 */
function HideModCommentsButton ({adapter,}: HideModCommentsButtonProps,) {
	const [hasModActions, setHasModActions,] = useState(() => adapter.getModeratorActionElements().length > 0)
	const [hidden, setHidden,] = useState(false,)

	function hideActions () {
		adapter.getModeratorActionElements().forEach((action,) => {
			const container = adapter.getCommentContainerForAction(action,)
			if (container) { adapter.hideCommentContainer(container,) }
		},)
	}

	function showActions () {
		adapter.getModeratorActionElements().forEach((action,) => {
			const container = adapter.getCommentContainerForAction(action,)
			if (container) { adapter.setElementVisible(container, true,) }
		},)
	}

	// These TBNewThings listeners are intentionally managed by React (useEffect + cleanup return)
	// rather than the module lifecycle. Both are conditional on React state (hasModActions, hidden)
	// and drive state updates; binding them at module level would require a callback indirection
	// with no benefit. The useEffect cleanup correctly removes them on state change or unmount.

	// Show the button once mod actions appear on the page.
	useEffect(() => {
		if (hasModActions) { return }
		const check = () => {
			if (adapter.getModeratorActionElements().length > 0) { setHasModActions(true,) }
		}
		window.addEventListener('TBNewThings', check,)
		return () => window.removeEventListener('TBNewThings', check,)
	}, [hasModActions,],)

	// Re-hide mod actions as new things load after the button is clicked.
	useEffect(() => {
		if (!hidden) { return }
		const apply = () => hideActions()
		window.addEventListener('TBNewThings', apply,)
		return () => window.removeEventListener('TBNewThings', apply,)
	}, [hidden,],)

	if (!hasModActions) { return null }

	return (
		<GeneralButton
			className="toolbox-hide-mod-comments"
			onClick={() => {
				if (hidden) {
					log.debug('showing mod actions',)
					showActions()
					setHidden(false,)
				} else {
					log.debug('hiding mod actions',)
					hideActions()
					setHidden(true,)
				}
			}}
		>
			{hidden ? 'show mod actions' : 'hide mod actions'}
		</GeneralButton>
	)
}

/**
 * Creates handlers for the hide-mod-comments button in the `commentThreadControls` UI location.
 * The button is only shown on pages without extra context (i.e. not on user pages with raw detail).
 * Call `lifecycle.mount(handlers.cleanup)` in `index.ts`.
 * @param adapter The platform adapter used to find and hide mod-action comments.
 * @returns `{cleanup}` - unregisters the renderer on module cleanup.
 */
export function createHideModCommentsHandlers (adapter: CommentModuleAdapter,): {cleanup: () => void} {
	const cleanup = renderAtLocation('commentThreadControls', {id: 'comment.hideMod',}, ({context,},) => {
		if (context.rawDetail != null) { return null }
		return <HideModCommentsButton adapter={adapter} />
	},)
	return {cleanup,}
}
