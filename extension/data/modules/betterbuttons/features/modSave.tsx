/**
 * Adds "distinguish" and "distinguish + sticky" toggles to the old-Reddit comment reply form, so a
 * moderator can mark a reply as distinguished (and optionally stickied) as part of saving it.
 *
 * The action runs through the proposals gateway rather than by proxy-clicking Reddit's own
 * distinguish menu. Old Reddit no longer renders a "distinguish and sticky" option at all - its
 * menu is now only yes/no/help - so there is nothing left to click, and the API is the only way to
 * sticky a comment. Routing through the gateway also means training mode and the second-opinion flow
 * capture the action, which the previous proxy-click quietly bypassed.
 *
 * Reddit clones the top-level reply form for every inline reply box, so the controls are rendered
 * once into that template and everything else is document-delegated: a clone keeps the class names
 * but not any React state, and `checked` lives on the cloned DOM node itself.
 */
import {getThingFullname, getThingSubreddit, getThingSubredditName,} from '../../../dom/oldReddit/things'
import {provideLocation, renderAtLocation,} from '../../../dom/uiLocations'
import createLogger from '../../../util/infra/logging'
import {RedditPlatform,} from '../../../util/infra/platform'
import {classes,} from '../../../util/ui/reactMount'
import {proposeOrDistinguish,} from '../../shared/proposals/gateway'
import css from './modSave.module.css'

const log = createLogger('BButtons',)

/**
 * Stable global class names. These drive the delegated handlers and the top-level-only visibility
 * rule in `toolbox-buttons.css`, so they must not be CSS-module hashes: a cloned reply form is
 * matched by class, and the stylesheet has to name the sticky row too.
 */
const distinguishToggleClass = 'toolbox-mod-distinguish-toggle'
const stickyToggleClass = 'toolbox-mod-sticky-toggle'
const stickyRowClass = 'toolbox-mod-sticky-row'

/**
 * Whether the thread already has a stickied comment, so the sticky toggle can warn that using it
 * replaces that comment. Scoped to `.comment` because a stickied *post* also carries `stickied`.
 */
function hasStickiedComment (): boolean {
	return document.querySelector('.commentarea div.thing.comment.stickied',) !== null
}

/**
 * Creates the mod-save toggles and their handlers.
 *
 * @returns Handlers `handleToggleChange` and `handleSaveClick` for `index.ts` to delegate, plus a
 *   `cleanup` function to pass to `lifecycle.mount`.
 */
export function createModSaveHandlers () {
	log.debug('Adding mod save toggles',)

	// Raw MutationObserver is permitted here: this factory manages its entire lifetime via the
	// returned cleanup() function, which index.ts passes to lifecycle.mount(). The cleanups array
	// is populated once during initialization (never touched by the handlers), so teardown order
	// is deterministic.
	const cleanups: Array<() => void> = []
	// Whether the save currently in flight asked for a sticky. Set on the save click and read once
	// the new comment lands, since the action can only run after Reddit assigns it a fullname.
	let pendingSticky = false

	const commentObserver = new MutationObserver((mutations,) => {
		for (const mutation of mutations) {
			for (const node of Array.from(mutation.addedNodes,)) {
				if (!(node instanceof Element) || !node.matches('div.comment',)) { continue }
				commentObserver.disconnect()
				void applyModAction(node, pendingSticky,)
				return
			}
		}
	},)

	/** Distinguishes (and optionally stickies) the freshly saved comment via the gateway. */
	async function applyModAction (comment: Element, sticky: boolean,) {
		const itemId = getThingFullname(comment,)
		const subreddit = getThingSubreddit(comment,) ?? getThingSubredditName(comment,)
		// Without a fullname or subreddit there is nothing to act on; warn rather than fail silently.
		if (!itemId || !subreddit) {
			log.warn('Could not resolve the saved comment; skipping the distinguish',)
			return
		}
		try {
			await proposeOrDistinguish({subreddit, itemId, itemKind: 'comment',}, sticky,)
		} catch (error) {
			log.error('mod save distinguish failed:', error,)
		}
	}

	const usertextButtons = document.querySelector(
		// Scope to the comment composer rather than the first editable usertext on the page. On a post
		// the viewer authored, Reddit renders `editusertext` forms (the post body editor, plus one per
		// own comment) *before* the reply box, so a first-match query lands the controls inside the
		// post's edit form - which is hidden until "edit" is clicked, hiding them entirely.
		'.moderator .commentarea form.usertext.cloneable .usertext-edit .usertext-buttons',
	)
	const saveButton = usertextButtons?.querySelector('.save',)
	if (saveButton) {
		const stickyExists = hasStickiedComment()
		const slot = document.createElement('span',)
		slot.className = 'toolbox-comment-composer-controls-slot'
		saveButton.after(slot,)
		cleanups.push(() => slot.remove())
		cleanups.push(provideLocation('commentComposerControls', slot, {
			platform: RedditPlatform.Old,
			kind: 'commentComposer',
		}, {shadow: false, hostTag: 'span',},),)
		cleanups.push(
			renderAtLocation('commentComposerControls', {id: 'betterbuttons.modSave',}, ({target,},) => {
				// Only render in the slot we own; other modules (e.g. macros) also
				// provide commentComposerControls slots, and we must not inject into them.
				if (target !== slot) { return null }
				// Uncontrolled inputs on purpose: the cloned reply forms carry no React instance, so the
				// checkbox's own `checked` is the single source of truth for both clones and the original.
				return (
					<>
						<label className={css.row}>
							<input type="checkbox" className={classes(css.toggle, distinguishToggleClass,)} />
							<span>distinguish</span>
						</label>
						<label className={classes(css.row, stickyRowClass,)}>
							<input type="checkbox" className={classes(css.toggle, stickyToggleClass,)} />
							<span>distinguish + sticky</span>
							{stickyExists
								&& <span className={css.warning}>(replaces the current stickied comment)</span>}
						</label>
					</>
				)
			},),
		)
	}

	return {
		/** Keeps the two toggles mutually exclusive within their own (possibly cloned) reply form. */
		handleToggleChange (element: Element,) {
			const input = element as HTMLInputElement
			// Only the box being switched *on* clears its partner; unchecking should leave both off.
			if (!input.checked) { return }
			const isDistinguish = input.classList.contains(distinguishToggleClass,)
			const other = input.closest('form',)?.querySelector<HTMLInputElement>(
				isDistinguish ? `.${stickyToggleClass}` : `.${distinguishToggleClass}`,
			)
			if (other) { other.checked = false }
		},
		/**
		 * Notes the requested action when a reply is saved with either toggle on, then watches for the
		 * new comment node so the distinguish can be applied to it.
		 */
		handleSaveClick (element: Element,) {
			const form = element.closest('form',)
			if (!form) { return }
			const distinguish = form.querySelector<HTMLInputElement>(`.${distinguishToggleClass}`,)
			const sticky = form.querySelector<HTMLInputElement>(`.${stickyToggleClass}`,)
			// Neither toggle set: an ordinary comment save, so stay out of the way entirely.
			if (!distinguish?.checked && !sticky?.checked) { return }

			pendingSticky = sticky?.checked ?? false
			log.debug('Mod save requested; sticky:', pendingSticky,)
			// Reset so the next reply in this (cloned) form starts from a clean state.
			if (distinguish) { distinguish.checked = false }
			if (sticky) { sticky.checked = false }

			commentObserver.observe(document.body, {
				childList: true,
				subtree: true,
				attributes: false,
				characterData: false,
			},)
		},
		cleanup () {
			commentObserver.disconnect()
			while (cleanups.length) {
				cleanups.pop()!()
			}
		},
	}
}
