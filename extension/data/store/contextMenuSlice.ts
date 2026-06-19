/**
 * Redux slice managing the Toolbox context menu.
 * State shape: a list of menu items and an optional `attentionId` for the most
 * recently added item that requested attention.
 */

import {createSlice, PayloadAction,} from '@reduxjs/toolkit'

import type {icons,} from '../util/ui/icons'

/** A single item rendered in the Toolbox context menu. */
export interface ContextMenuItem {
	/** Stable unique identifier, also used as the element `id`. */
	id: string
	text: string
	/** Icon name from the `icons` map. */
	icon: keyof typeof icons
	title?: string | undefined
	/** Additional `data-*` attributes set on the `<li>` element. */
	dataAttributes?: Record<string, string> | undefined
	/**
	 * Sort position for this item. Lower numbers appear first. Items without an
	 * order are sorted to the end in insertion order.
	 */
	order?: number | undefined
}

interface ContextMenuState {
	items: ContextMenuItem[]
	attentionId: string | null
}

const initialState: ContextMenuState = {
	items: [],
	attentionId: null,
}

interface AddItemPayload extends ContextMenuItem {
	attention?: boolean
}

const slice = createSlice({
	name: 'contextMenu',
	initialState,
	reducers: {
		addItem (state, action: PayloadAction<AddItemPayload>,) {
			const {attention, ...item} = action.payload
			const index = state.items.findIndex((i,) => i.id === item.id)
			if (index >= 0) {
				state.items[index] = item
			} else {
				state.items.push(item,)
			}
			// Keep items sorted by explicit order; items with no order stay at the
			// end in insertion order (stable sort preserves their relative positions).
			state.items.sort((a, b,) => {
				const ao = a.order ?? Number.MAX_SAFE_INTEGER
				const bo = b.order ?? Number.MAX_SAFE_INTEGER
				return ao - bo
			},)
			if (attention) {
				state.attentionId = item.id
			}
		},
		removeItem (state, action: PayloadAction<string>,) {
			state.items = state.items.filter((i,) => i.id !== action.payload)
			if (state.attentionId === action.payload) {
				state.attentionId = null
			}
		},
		clearAttention (state,) {
			state.attentionId = null
		},
	},
},)

export const {addItem, removeItem, clearAttention,} = slice.actions
export default slice.reducer
