/**
 * Adds "mod save" and "mod save + sticky" buttons to the old-Reddit comment reply form,
 * which save and distinguish (and optionally sticky) a moderator comment in one click.
 */
import {createElement, Fragment,} from 'react'

import {provideLocation, renderAtLocation,} from '../../../dom/uiLocations'
import createLogger from '../../../util/infra/logging'
import {RedditPlatform,} from '../../../util/infra/platform'

const log = createLogger('BButtons',)

/**
 * Creates the mod-save buttons and their click handlers.
 *
 * Uses vanilla DOM because the buttons proxy-click Reddit's own save/distinguish forms,
 * and a MutationObserver watches for the newly inserted comment node to trigger distinguish.
 *
 * @returns Handlers `handleModSaveClick`, `handleStickySaveClick`, and a `cleanup` function.
 */
export function createModSaveHandlers () {
	log.debug('Adding mod save buttons',)

	// Raw MutationObserver is permitted here: this factory manages its entire lifetime via the
	// returned cleanup() function, which index.ts passes to lifecycle.mount(). The cleanups array
	// is populated once during initialization (never touched by the click handlers), so teardown
	// order is deterministic.
	const cleanups: Array<() => void> = []
	let shouldSticky = false
	const commentObserver = new MutationObserver((mutations,) => {
		mutations.forEach((mutation,) => {
			for (let i = 0; i < mutation.addedNodes.length; ++i) {
				const item = mutation.addedNodes[i] as Element
				if (item.nodeType === 1 && item.matches('div.comment',)) {
					log.debug('Clicking distinguish button',)
					const things = item.querySelectorAll<HTMLElement>(
						'form[action="/post/distinguish"] > .option > a',
					)
					// The distinguish form must expose both the "distinguish" and the
					// "distinguish & sticky" links; without them the proxy-click is a
					// silent no-op, so warn rather than fail invisibly.
					if (things.length < 2) {
						log.warn('Distinguish form had fewer than 2 buttons; cannot mod-save',)
						commentObserver.disconnect()
						return
					}
					if (shouldSticky) {
						things[1]?.click()
						shouldSticky = false
					} else {
						things[0]?.click()
					}

					commentObserver.disconnect()
					return
				}
			}
		},)
	},)

	const usertextButtons = document.querySelector('.moderator .usertext-edit .usertext-buttons',)
	const saveButton = usertextButtons?.querySelector('.save',)
	if (saveButton) {
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
				return createElement(
					Fragment,
					null,
					createElement('button', {className: 'save-mod',}, 'mod save',),
					createElement('button', {className: 'save-sticky',}, 'mod save + sticky',),
				)
			},),
		)
	}

	return {
		handleModSaveClick (element: Element,) {
			log.debug('Mod save clicked!',)
			commentObserver.observe(document.body, {
				childList: true,
				subtree: true,
				attributes: false,
				characterData: false,
			},)
			element.closest('.usertext-buttons',)?.querySelector<HTMLButtonElement>('button.save',)?.click()
		},
		handleStickySaveClick (element: Element,) {
			log.debug('Mod save + sticky clicked!',)
			commentObserver.observe(document.body, {
				childList: true,
				subtree: true,
				attributes: false,
				characterData: false,
			},)
			shouldSticky = true
			element.closest('.usertext-buttons',)?.querySelector<HTMLButtonElement>('button.save',)?.click()
		},
		cleanup () {
			commentObserver.disconnect()
			while (cleanups.length) {
				cleanups.pop()!()
			}
		},
	}
}
