/**
 * Scans comment threads for removed/spammed comments, injects approve/spam/remove action buttons,
 * and adds a modbar toggle that shows or hides removed comments.
 */
import {useEffect, useState,} from 'react'

import {renderAtLocation,} from '../../../dom/uiLocations'
import {createLifecycle,} from '../../../framework/lifecycle'
import {Icon,} from '../../../shared/controls/Icon'
import {forEachChunkedDynamic,} from '../../../util/data/iter'
import createLogger from '../../../util/infra/logging'
import {getThingInfo,} from '../../../util/reddit/thingInfo'
import {modbarExists,} from '../../modbar'
import {type CommentModuleAdapter,} from '../platformInterface'

const log = createLogger('Comments',)

/** Props for the SpamToggleButton component. */
interface SpamToggleButtonProps {
	/**
	 * Called on mount with a setter function so the parent handler can update the displayed count
	 * before the component has rendered.
	 */
	onMount: (setter: (n: number,) => void,) => void
}

/**
 * Renders a modbar button showing the count of removed comments.
 * Clicking the button toggles visibility of removed comments; the button is hidden when count is 0.
 */
function SpamToggleButton ({onMount,}: SpamToggleButtonProps,) {
	const [count, setCount,] = useState(0,)

	useEffect(() => {
		onMount(setCount,)
	}, [],)

	if (count < 1) { return null }

	return (
		<a id="toolbox-toggle-removed" title="Toggle hide/view removed comments">
			<Icon icon="comments" />
			{`[${count}]`}
		</a>
	)
}

/** Options controlling which features of the spam-toggle handler are active. */
interface SpamToggleOptions {
	/** Hide removed comments by default on page load. */
	hideRemoved: boolean
	/** Inject an approve button on comments that have not been approved. */
	approveComments: boolean
	/** Inject a spam button on comments removed as ham. */
	spamRemoved: boolean
	/** Inject a remove button on comments removed as spam. */
	hamSpammed: boolean
}

/**
 * Creates the spam-toggle handlers: registers the modbar button, scans for removed comments,
 * and injects action buttons.
 * @param options Feature flags controlling which actions are enabled.
 * @param adapter Platform adapter used for all DOM operations.
 * @returns Handlers `run`, `cleanup`, `handleToggleRemoved`, and `handleExpandoClick`.
 */
export function createSpamToggleHandlers (
	{hideRemoved, approveComments, spamRemoved, hamSpammed,}: SpamToggleOptions,
	adapter: CommentModuleAdapter,
) {
	const lifecycle = createLifecycle()
	let setCount: ((n: number,) => void) | null = null
	let pendingCount = 0

	const handleMount = (setter: (n: number,) => void,) => {
		setCount = setter
		setter(pendingCount,)
	}

	const unregister = renderAtLocation(
		'modbar',
		{id: 'comment.spamToggle', order: 2,},
		() => <SpamToggleButton onMount={handleMount} />,
	)

	async function run () {
		await modbarExists

		let removedCounter = 0

		adapter.getSpammedCommentEntries().forEach((entry,) => {
			adapter.markEntryAsSpam(entry,)
			removedCounter += 1
		},)

		log.debug(removedCounter,)

		if (setCount) {
			setCount(removedCounter,)
		} else {
			pendingCount = removedCounter
		}

		if (hideRemoved) {
			adapter.getMarkedSpamEntries().forEach((element,) => {
				adapter.setElementVisible(element, false,)
			},)
			adapter.getActionReasonElements().forEach((element,) => {
				adapter.setElementVisible(element, false,)
			},)
		}

		if (approveComments || spamRemoved || hamSpammed) {
			forEachChunkedDynamic(adapter.getUncheckedCommentThings(), async (item,) => {
				adapter.markThingChecked(item,)

				const thing = await getThingInfo(item as HTMLElement, true,)

				if (approveComments && thing.subreddit && !thing.approved_by) {
					const anchor = adapter.getApproveAnchor(item,)
					if (anchor) {
						adapter.insertActionButton(anchor, 'afterend', {
							className: 'toolbox-comment-button toolbox-comment-button-approve',
							text: 'approve',
							fullname: thing.fullname,
						},)
					}
				}

				if (spamRemoved && thing.subreddit && thing.ham) {
					const anchor = adapter.getSpamButtonAnchor(item,)
					if (anchor) {
						adapter.insertActionButton(anchor, 'beforebegin', {
							className: 'toolbox-comment-button toolbox-big-button toolbox-comment-button-spam',
							text: 'spam',
							fullname: thing.fullname,
						},)
					}
				}

				if (hamSpammed && thing.subreddit && thing.spam) {
					const anchor = adapter.getHamButtonAnchor(item,)
					if (anchor) {
						adapter.insertActionButton(anchor, 'beforebegin', {
							className: 'toolbox-comment-button toolbox-big-button toolbox-comment-button-remove',
							text: 'remove',
							fullname: thing.fullname,
						},)
					}
				}
			},)
		}
	}

	return {
		run,
		cleanup () {
			unregister()
			setCount = null
			pendingCount = 0
			return lifecycle.cleanup()
		},
		handleToggleRemoved () {
			const commentSpam = adapter.getMarkedSpamEntries()
			const firstSpam = commentSpam[0]
			const hide = firstSpam != null && getComputedStyle(firstSpam,).display !== 'none'
			commentSpam.forEach((element,) => {
				adapter.setElementVisible(element, !hide,)
			},)
			adapter.getActionReasonElements().forEach((element,) => {
				adapter.setElementVisible(element, !hide,)
			},)
		},
		handleExpandoClick () {
			lifecycle.timeout(run, 1000,)
		},
	}
}
