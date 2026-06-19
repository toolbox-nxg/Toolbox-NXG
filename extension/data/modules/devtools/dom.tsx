/** DOM registration for the DevTools module: API info buttons and the comment UI tester context menu entry. */
import {getAbsoluteRedditJson, getRedditEndpointJson,} from '../../api/resources/listings'
import {renderAtLocation,} from '../../dom/uiLocations'
import {createLifecycle,} from '../../framework/lifecycle'
import {addContextItem,} from '../../store/contextMenu'
import {mountPopup,} from '../../util/ui/reactMount'
import {ApiInfoButton,} from './components/ApiInfoButton'
import {CommentUITester,} from './components/CommentUITester'

/**
 * Registers "api info" buttons next to authors and things at their respective UI locations.
 * @returns A cleanup function to pass to `lifecycle.mount` in `index.ts`.
 */
export function registerApiInfoButtons () {
	const lifecycle = createLifecycle()
	renderAtLocation('authorActions', {id: 'devtools.author', order: 60, lifecycle,}, ({context,},) => (
		<ApiInfoButton context={context} author className="toolbox-show-api-info" />
	),)
	renderAtLocation('thingActions', {id: 'devtools.thing', lifecycle,}, ({context,},) => (
		<ApiInfoButton context={context} className="toolbox-show-api-info" />
	),)
	return lifecycle.cleanup
}

/** Adds the "Show ze overlay!" entry to the toolbox context menu for opening the comment UI tester. */
export function addCommentTesterContextItem (): void {
	addContextItem('toolbox-testCommentUI-link', {
		text: 'Show ze overlay!',
		icon: 'overlay',
	},)
}

/** Mounts the CommentUITester as a managed popup overlay, injecting the Reddit JSON fetch. */
export function showCommentUITester () {
	// Single-instance tester: re-running the context item reveals the existing
	// overlay instead of stacking another copy.
	return mountPopup(
		(onClose,) => (
			<CommentUITester
				onClose={onClose}
				fetchListing={(url, absolute,) => absolute ? getAbsoluteRedditJson(url,) : getRedditEndpointJson(url,)}
			/>
		),
		undefined,
		'comment-ui-tester',
	)
}
