/**
 * Injects extra spam/remove action buttons on submissions whose removal state differs
 * from what the moderator expects (e.g. spam button on ham-removed posts, remove button on spam posts).
 */
import {getThingBigModButtons, getUncheckedLinkThings,} from '../../../dom/oldReddit/things'
import {provideLocation, renderAtLocation,} from '../../../dom/uiLocations'
import {createLifecycle,} from '../../../framework/lifecycle'
import {forEachChunkedDynamic,} from '../../../util/data/iter'
import {RedditPlatform,} from '../../../util/infra/platform'
import {getThingInfo,} from '../../../util/reddit/thingInfo'
import {createDisposalGuard,} from './disposalGuard'

/** Options controlling which extra buttons are shown. */
interface RemoveButtonsOptions {
	/** Show a "spam" button on submissions removed as ham (not spam). */
	spamRemoved: boolean
	/** Show a "remove" button on submissions removed as spam. */
	hamSpammed: boolean
}

interface ReplacementActionDetail {
	className: string
	fullname: string
	text: string
	type: 'removeButtonReplacement'
}

/**
 * Creates the remove-buttons feature handler.
 * @returns `run` (scans unchecked link things and injects buttons) and `cleanup` (unregisters the
 *   renderer, unmounts every injected button, and clears the checked markers); pass `cleanup` to
 *   `lifecycle.mount` in `index.ts`.
 */
export function createRemoveButtonsHandlers ({spamRemoved, hamSpammed,}: RemoveButtonsOptions,) {
	const scope = createLifecycle()
	// Clears every `.toolbox-removebuttons-checked` marker on teardown so a re-init re-scans.
	const guard = createDisposalGuard(scope, 'toolbox-removebuttons-checked',)

	renderAtLocation(
		'thingNativeActionReplacement',
		{id: 'betterbuttons.removeButtons', lifecycle: scope,},
		({context,},) => {
			const detail = context.rawDetail as ReplacementActionDetail | undefined
			if (detail?.type !== 'removeButtonReplacement') { return null }
			return (
				<a
					className={detail.className}
					data-fullname={detail.fullname}
				>
					{detail.text}
				</a>
			)
		},
	)

	function provideReplacementAction (anchor: Element, detail: ReplacementActionDetail,) {
		const slot = document.createElement('li',)
		slot.className = 'toolbox-replacement'
		anchor.insertAdjacentElement('beforebegin', slot,)
		const removeProvided = provideLocation('thingNativeActionReplacement', slot, {
			platform: RedditPlatform.Old,
			kind: 'thingNativeAction',
			thingId: detail.fullname,
			rawDetail: detail,
		}, {shadow: false, hostTag: 'span',},)
		// provideLocation only removes the host it mounts inside `slot`; dispose that and the
		// outer <li> we injected here.
		scope.mount(() => {
			removeProvided()
			slot.remove()
		},)
	}

	function run () {
		forEachChunkedDynamic(getUncheckedLinkThings('toolbox-removebuttons-checked',), async (item,) => {
			if (guard.isDisposed()) { return }
			item.classList.add('toolbox-removebuttons-checked',)

			const thing = await getThingInfo(item as HTMLElement, true,)
			if (guard.isDisposed()) { return }

			if (spamRemoved && thing.subreddit && thing.ham) {
				const bigModButtons = getThingBigModButtons(item,)
				if (bigModButtons && !bigModButtons.querySelector('.negative',)) {
					provideReplacementAction(bigModButtons, {
						className: 'toolbox-comment-button toolbox-big-button toolbox-comment-button-spam',
						fullname: thing.fullname,
						text: 'spam',
						type: 'removeButtonReplacement',
					},)
				}
			}

			if (hamSpammed && thing.subreddit && thing.spam) {
				const bigModButtons = getThingBigModButtons(item,)
				if (bigModButtons && !bigModButtons.querySelector('.neutral',)) {
					provideReplacementAction(bigModButtons, {
						className: 'toolbox-comment-button toolbox-big-button toolbox-comment-button-remove',
						fullname: thing.fullname,
						text: 'remove',
						type: 'removeButtonReplacement',
					},)
				}
			}
		},)
	}
	return {run, cleanup: scope.cleanup,}
}
