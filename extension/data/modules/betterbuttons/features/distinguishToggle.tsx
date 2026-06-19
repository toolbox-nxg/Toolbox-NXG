/**
 * Adds a "sticky" shortcut link to top-level comments and wires up the distinguish toggle so that
 * clicking it also stickies or unstickies the comment without a confirmation step.
 */
import {useEffect, useState,} from 'react'

import {getNestedCommentDistinguishToggles,} from '../../../dom/oldReddit/page'
import {getThingFromDescendant, getThingFullname,} from '../../../dom/oldReddit/things'
import {provideLocation, renderAtLocation,} from '../../../dom/uiLocations'
import {createLifecycle,} from '../../../framework/lifecycle'
import createLogger from '../../../util/infra/logging'
import {RedditPlatform,} from '../../../util/infra/platform'
import {notifyNewThings,} from '../../../util/ui/listener'
import {publishDistinguishState, subscribeDistinguishState,} from '../store'

const log = createLogger('BButtons',)

/** Props for the StickyToggle component. */
interface StickyToggleProps {
	/** Fullname of the comment thing this toggle acts on. */
	thingId: string
	/** The old-Reddit distinguish toggle element whose "distinguish" form will be clicked. */
	distinguishToggle: Element
}

/**
 * Renders a "sticky" action link next to a comment's distinguish toggle.
 * Hides itself once the comment becomes distinguished (since stickying implies distinguishing).
 */
function StickyToggle ({thingId, distinguishToggle,}: StickyToggleProps,) {
	const [isDistinguished, setIsDistinguished,] = useState(false,)

	useEffect(() => subscribeDistinguishState(thingId, setIsDistinguished,), [thingId,],)

	if (isDistinguished) { return null }

	return (
		<a
			className="toolbox-sticky-comment"
			// Intentional silent no-op: if the distinguish form isn't present on this toggle the
			// sticky link simply does nothing, which is the correct fallback for this edge case.
			onClick={() => distinguishToggle.querySelector<HTMLElement>('form[action="/post/distinguish"]',)?.click()}
		>
			sticky
		</a>
	)
}

/**
 * Creates handlers for the distinguish-toggle feature.
 * @returns `addSticky` (inject sticky links), `distinguishClicked` (handle distinguish clicks),
 *   and `cleanup` (dispose the factory's timer and unmount every injected sticky link) to pass to
 *   `lifecycle.mount` in `index.ts`.
 */
export function createDistinguishToggleHandlers () {
	const lifecycle = createLifecycle()
	let newThingRunning = false

	// Render the sticky link into the dedicated slot each injected <li> provides below.
	// Props flow through the slot context's rawDetail rather than a direct root.render.
	renderAtLocation(
		'commentDistinguishControls',
		{id: 'betterbuttons.sticky', lifecycle,},
		({context,},) => {
			const detail = context.rawDetail as {toggle: Element} | undefined
			if (!detail?.toggle) { return null }
			return <StickyToggle thingId={context.thingId ?? ''} distinguishToggle={detail.toggle} />
		},
	)

	function getDomDistinguishState (thing: Element | null,): boolean {
		const author = thing?.querySelector('a.author',)
		return author?.classList.contains('moderator',) ?? false
	}

	function addSticky () {
		getNestedCommentDistinguishToggles().forEach((toggle,) => {
			if (!toggle.querySelector('form[action="/post/distinguish"]',)) { return }
			const parentComment = toggle.closest('.comment',)
			if (!parentComment || parentComment.classList.contains('toolbox-sticky-processed',)) { return }
			const thing = getThingFromDescendant(toggle,)
			if (getDomDistinguishState(thing,)) { return }
			const thingId = getThingFullname(thing!,)
			if (!thingId) { return }

			const li = document.createElement('li',)
			li.className = 'toggle'
			toggle.insertAdjacentElement('afterend', li,)
			const removeProvided = provideLocation('commentDistinguishControls', li, {
				platform: RedditPlatform.Old,
				kind: 'comment',
				thingId,
				rawDetail: {toggle,},
			}, {shadow: false, hostTag: 'span',},)
			parentComment.classList.add('toolbox-sticky-processed',)
			// provideLocation only removes the host it mounts inside `li`; dispose that, the
			// injected <li>, and the processed marker on cleanup so the module leaves no orphaned
			// UI and re-injects the link after a re-init.
			lifecycle.mount(() => {
				removeProvided()
				li.remove()
				parentComment.classList.remove('toolbox-sticky-processed',)
			},)
		},)
	}

	function distinguishClicked (element: Element, event: Event,) {
		const parentPost = getThingFromDescendant(element,)
		if (!parentPost) { return }

		const currentlyDistinguished = getDomDistinguishState(parentPost,)
		const thingId = getThingFullname(parentPost,)

		const firstDistinguishButton = element.querySelector<HTMLElement>('.option > a:first-child',)
		// Reddit's distinguish menu exposes two options ("distinguish" + "distinguish & sticky").
		// The robot-driven path needs the second; bail loudly if the expected DOM is missing.
		const distinguishButtons = element.querySelectorAll<HTMLElement>('.option > a',)
		const secondDistinguishButton = distinguishButtons.length > 1 ? distinguishButtons[1] : null

		if ((event as MouseEvent).isTrusted) {
			log.debug('Top level comment distinguish has been clicked and it is the real deal!',)
			firstDistinguishButton?.click()
			if (thingId) { publishDistinguishState(thingId, !currentlyDistinguished,) }
		} else {
			log.debug('Top level comment distinguish has been clicked by a robot!',)
			if (!secondDistinguishButton) {
				log.warn('Expected a second distinguish button but found fewer than 2; skipping',)
				return
			}
			secondDistinguishButton.click()
			if (thingId) { publishDistinguishState(thingId, true,) }
		}

		if (!newThingRunning) {
			newThingRunning = true
			lifecycle.timeout(() => {
				newThingRunning = false
				notifyNewThings()
			}, 1000,)
		}
	}

	log.debug('Adding distinguish toggle events',)

	return {addSticky, distinguishClicked, cleanup: lifecycle.cleanup,}
}
