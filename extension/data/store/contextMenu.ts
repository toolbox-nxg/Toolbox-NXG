/** Public API for adding and removing items from the Toolbox context menu. */

import {isEmbedded,} from '../util/infra/platform'
import type {icons,} from '../util/ui/icons'
import store from '.'
import {addItem, removeItem,} from './contextMenuSlice'

/** Options for adding a context menu item. */
export interface AddContextItemOptions {
	/** Display text for the menu item. */
	text: string
	/** Icon name from the `icons` map. */
	icon: keyof typeof icons
	/** Tooltip shown on hover. */
	title?: string
	/** Additional `data-*` attributes set on the `<li>` element. */
	dataAttributes?: Record<string, string>
	/** When true, briefly highlights the menu to draw the user's attention. */
	attention?: boolean
	/**
	 * Sort position for this item. Lower numbers appear first. Items without an
	 * order are sorted to the end in insertion order.
	 */
	order?: number
}

/**
 * Adds or updates an item in the Toolbox context menu.
 * No-ops when the page is running in an embedded frame.
 * @param id Stable identifier for this item; used for deduplication and removal.
 * @param options The menu item's content and behaviour (see `AddContextItemOptions`).
 */
export function addContextItem (id: string, options: AddContextItemOptions,) {
	if (isEmbedded) {
		return
	}
	store.dispatch(addItem({
		id,
		text: options.text,
		icon: options.icon,
		title: options.title,
		dataAttributes: options.dataAttributes,
		order: options.order,
		...(options.attention && {attention: true,}),
	},),)
}

/**
 * Removes the context menu item with the given id.
 * No-ops when the page is running in an embedded frame.
 */
export function removeContextItem (id: string,) {
	if (isEmbedded) {
		return
	}
	store.dispatch(removeItem(id,),)
}
