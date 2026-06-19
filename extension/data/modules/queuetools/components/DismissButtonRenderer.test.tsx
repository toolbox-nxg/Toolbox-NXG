/** Tests for DismissButtonRenderer: when the dismiss button shows and what clicking it does. */

import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

vi.mock('webextension-polyfill', () => ({
	default: {runtime: {getURL: (path: string,) => `chrome-extension://fake/${path}`,},},
}),)

import {DismissButtonRenderer,} from './DismissButtonRenderer'

let container: HTMLElement
let root: Root

beforeEach(() => {
	container = document.createElement('div',)
	document.body.append(container,)
	root = createRoot(container,)
},)

afterEach(() => {
	act(() => root.unmount())
	container.remove()
	document.body.innerHTML = ''
},)

/**
 * Builds a queue `.thing` with a Toolbox host slot inside it and mounts the renderer on
 * that slot, mirroring how `provideLocation('thingActions', ...)` wires things on Old Reddit.
 * @param options Configuration for the fixture thing.
 * @param options.actionedClass CSS verdict class to apply to the thing (omit for un-actioned).
 * @param options.bylineTitle `title` attribute for the `.flat-list li[title]` byline, if any.
 * @param onDismiss Callback passed to the renderer.
 * @returns The created `.thing` element.
 */
function mountWithThing (
	{actionedClass, bylineTitle,}: {actionedClass?: string; bylineTitle?: string},
	onDismiss: (thing: Element,) => void,
): Element {
	const thing = document.createElement('div',)
	thing.className = 'thing'
	if (actionedClass) { thing.classList.add(actionedClass,) }
	if (bylineTitle != null) {
		const list = document.createElement('ul',)
		list.className = 'flat-list'
		const li = document.createElement('li',)
		li.setAttribute('title', bylineTitle,)
		list.append(li,)
		thing.append(list,)
	}
	const slot = document.createElement('div',)
	thing.append(slot,)
	container.append(thing,)

	act(() => root.render(<DismissButtonRenderer target={slot} onDismiss={onDismiss} />,))
	return thing
}

/** Returns the rendered dismiss button, or `null` when it isn't shown. */
function queryButton (): HTMLButtonElement | null {
	return container.querySelector('button',)
}

describe('DismissButtonRenderer', () => {
	it('shows no button on an un-actioned item', () => {
		mountWithThing({}, vi.fn(),)
		expect(queryButton(),).toBeNull()
	})

	it('shows the button on a mod-approved item', () => {
		mountWithThing({actionedClass: 'approved',}, vi.fn(),)
		expect(queryButton()?.textContent,).toBe('dismiss',)
	})

	it.each(['removed', 'spammed', 'flaired',],)('shows the button on a %s item', (cls,) => {
		mountWithThing({actionedClass: cls,}, vi.fn(),)
		expect(queryButton(),).not.toBeNull()
	},)

	it('hides the button on an AutoModerator-removed item', () => {
		mountWithThing({actionedClass: 'removed', bylineTitle: 'removed by AutoModerator',}, vi.fn(),)
		expect(queryButton(),).toBeNull()
	})

	it('shows the button when a human mod removed the item', () => {
		mountWithThing({actionedClass: 'removed', bylineTitle: 'removed by SomeHumanMod',}, vi.fn(),)
		expect(queryButton(),).not.toBeNull()
	})

	it('calls onDismiss with the thing when clicked', () => {
		const onDismiss = vi.fn()
		const thing = mountWithThing({actionedClass: 'approved',}, onDismiss,)
		act(() => {
			queryButton()!.click()
		},)
		expect(onDismiss,).toHaveBeenCalledWith(thing,)
	})

	it('reveals the button once the item gains an actioned class', async () => {
		const thing = mountWithThing({}, vi.fn(),)
		expect(queryButton(),).toBeNull()
		await act(async () => {
			thing.classList.add('removed',)
			// Let the MutationObserver callback flush.
			await Promise.resolve()
		},)
		expect(queryButton(),).not.toBeNull()
	})
})
