/**
 * Adds a "sticky" shortcut link to top-level comments, and auto-confirms Reddit's own distinguish
 * toggle so distinguishing takes one click instead of two.
 *
 * Stickying runs through the proposals gateway rather than by proxy-clicking Reddit's menu. Old
 * Reddit no longer renders a "distinguish and sticky" option - the menu is now only yes/no/help - so
 * there is nothing left to click, and the API is the only remaining way to sticky a comment. It also
 * means training mode and the second-opinion flow capture the action, which a proxy-click bypassed.
 */
import {useEffect, useState,} from 'react'

import {getNestedCommentDistinguishToggles,} from '../../../dom/oldReddit/page'
import {
	getThingFromDescendant,
	getThingFullname,
	getThingSubreddit,
	getThingSubredditName,
} from '../../../dom/oldReddit/things'
import {provideLocation, renderAtLocation,} from '../../../dom/uiLocations'
import {createLifecycle,} from '../../../framework/lifecycle'
import createLogger from '../../../util/infra/logging'
import {RedditPlatform,} from '../../../util/infra/platform'
import {notifyNewThings,} from '../../../util/ui/listener'
import {proposeOrDistinguish,} from '../../shared/proposals/gateway'
import {publishDistinguishState, subscribeDistinguishState,} from '../store'

const log = createLogger('BButtons',)

/**
 * Matches Reddit's distinguish form by the tail of its action. Reddit renders this as an absolute
 * URL (`https://www.reddit.com/post/distinguish`), so an exact `[action="/post/distinguish"]` match
 * silently finds nothing; the suffix match works for both that and a relative action.
 */
export const distinguishFormSelector = 'form[action$="/post/distinguish"]'

/** Interaction state for the sticky link. */
type StickyState = 'idle' | 'pending' | 'success' | 'error'

/** Props for the StickyToggle component. */
interface StickyToggleProps {
	/** Fullname of the comment thing this toggle acts on. */
	thingId: string
	/** Subreddit the comment belongs to (no `r/` prefix). */
	subreddit: string
}

/**
 * Renders a "sticky" action link next to a comment's distinguish toggle.
 * Hides itself once the comment becomes distinguished (since stickying implies distinguishing).
 */
function StickyToggle ({thingId, subreddit,}: StickyToggleProps,) {
	const [isDistinguished, setIsDistinguished,] = useState(false,)
	const [state, setState,] = useState<StickyState>('idle',)

	useEffect(() => subscribeDistinguishState(thingId, setIsDistinguished,), [thingId,],)

	// Terminal feedback wins over the distinguished check: stickying also distinguishes, so publishing
	// that state would otherwise blank the link out and leave no confirmation that anything happened.
	if (state === 'success') { return <span className="success">stickied</span> }
	if (state === 'error') { return <span className="error">failed to sticky</span> }
	if (isDistinguished) { return null }

	/** Distinguishes and stickies the comment in one call (Reddit stickies via distinguish). */
	async function onClick () {
		if (state === 'pending') { return }
		setState('pending',)
		try {
			const result = await proposeOrDistinguish({subreddit, itemId: thingId, itemKind: 'comment',}, true,)
			// A captured (trainee) action changed nothing on Reddit, so leave the link in place.
			if (result === 'captured') {
				setState('idle',)
				return
			}
			setState('success',)
			publishDistinguishState(thingId, true,)
		} catch (error) {
			log.error('Sticky comment failed:', error,)
			setState('error',)
		}
	}

	return (
		<a className="toolbox-sticky-comment" style={{cursor: 'pointer',}} onClick={() => void onClick()}>
			sticky
		</a>
	)
}

/**
 * Creates handlers for the distinguish-toggle feature.
 * @returns `addSticky` (inject sticky links), `distinguishClicked` (auto-confirm distinguish clicks),
 *   and `cleanup` (dispose the factory's timer and unmount every injected sticky link) to pass to
 *   `lifecycle.mount` in `index.ts`.
 */
export function createDistinguishToggleHandlers () {
	const lifecycle = createLifecycle()
	let newThingRunning = false

	// Render the sticky link into the dedicated slot each injected <li> provides below.
	// Props flow through the slot context rather than a direct root.render.
	renderAtLocation(
		'commentDistinguishControls',
		{id: 'betterbuttons.sticky', lifecycle,},
		({context,},) => {
			if (!context.thingId || !context.subreddit) { return null }
			return <StickyToggle thingId={context.thingId} subreddit={context.subreddit} />
		},
	)

	/** Reads distinguished state from the DOM: Reddit marks a distinguished author `.moderator`. */
	function getDomDistinguishState (thing: Element | null,): boolean {
		const author = thing?.querySelector('a.author',)
		return author?.classList.contains('moderator',) ?? false
	}

	function addSticky () {
		getNestedCommentDistinguishToggles().forEach((toggle,) => {
			// The distinguish form is Reddit's own signal that this comment is distinguishable by the
			// viewer (i.e. it is theirs); without it there is nothing to offer.
			if (!toggle.querySelector(distinguishFormSelector,)) { return }
			const parentComment = toggle.closest('.comment',)
			if (!parentComment || parentComment.classList.contains('toolbox-sticky-processed',)) { return }
			const thing = getThingFromDescendant(toggle,)
			if (getDomDistinguishState(thing,)) { return }
			if (!thing) { return }
			const thingId = getThingFullname(thing,)
			const subreddit = getThingSubreddit(thing,) ?? getThingSubredditName(thing,)
			if (!thingId || !subreddit) { return }

			const li = document.createElement('li',)
			li.className = 'toggle'
			toggle.insertAdjacentElement('afterend', li,)
			const removeProvided = provideLocation('commentDistinguishControls', li, {
				platform: RedditPlatform.Old,
				kind: 'comment',
				thingId,
				subreddit,
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

	/**
	 * Skips Reddit's confirmation step: clicking the distinguish toggle opens a "yes / no" menu, so
	 * this confirms it immediately by clicking the first option.
	 */
	function distinguishClicked (element: Element, event: Event,) {
		// Only a real click on the toggle itself should auto-confirm. Ignoring untrusted events and
		// clicks already inside the menu keeps the synthetic confirm click below from re-entering this
		// handler and looping.
		if (!(event as MouseEvent).isTrusted) { return }
		if ((event.target as Element | null)?.closest('.option',)) { return }

		const parentComment = getThingFromDescendant(element,)
		if (!parentComment) { return }

		const currentlyDistinguished = getDomDistinguishState(parentComment,)
		const thingId = getThingFullname(parentComment,)

		// The menu's first option confirms whichever action the toggle offers (distinguish or
		// undistinguish); bail loudly rather than silently doing nothing if Reddit's markup moves.
		const confirmButton = element.querySelector<HTMLElement>('.option > a:first-child',)
		if (!confirmButton) {
			log.warn('Distinguish menu had no confirm option; leaving Reddit\'s own flow alone',)
			return
		}
		confirmButton.click()
		if (thingId) { publishDistinguishState(thingId, !currentlyDistinguished,) }

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
