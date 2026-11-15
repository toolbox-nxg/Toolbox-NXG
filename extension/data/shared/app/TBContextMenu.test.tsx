/** Tests for TBContextMenu's attention highlight. */

import {configureStore,} from '@reduxjs/toolkit'
import {act,} from 'react'
import {createRoot, type Root,} from 'react-dom/client'
import {Provider,} from 'react-redux'
import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

vi.mock('webextension-polyfill', () => ({
	default: {
		runtime: {sendMessage: vi.fn().mockResolvedValue({},), getURL: vi.fn((path: string,) => path),},
		storage: {local: {get: vi.fn().mockResolvedValue({},),},},
	},
}),)
// Settings at their defaults: the menu on the left, opening on hover, highlighting with "open".
vi.mock(
	'../../util/ui/hooks',
	() => ({useSetting: (_module: string, _setting: string, fallback: unknown,) => fallback,}),
)

import contextMenu, {addItem, removeItem,} from '../../store/contextMenuSlice'
import {TBContextMenu,} from './TBContextMenu'
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let store: ReturnType<typeof makeStore>

const makeStore = () => configureStore({reducer: {contextMenu,},},)

beforeEach(() => {
	vi.useFakeTimers()
	store = makeStore()
	const host = document.createElement('div',)
	document.body.appendChild(host,)
	root = createRoot(host,)
	act(() =>
		root.render(
			<Provider store={store}>
				<TBContextMenu />
			</Provider>,
		)
	)
},)

afterEach(() => {
	act(() => root.unmount())
	document.body.innerHTML = ''
	vi.useRealTimers()
},)

const menuClasses = () => document.getElementById('toolbox-context-menu',)?.className.split(' ',) ?? []
const item = (id: string,) => ({id, text: id, icon: 'add' as const,})

describe('TBContextMenu attention', () => {
	it('highlights the menu when an item asks for attention, until the highlight times out', () => {
		act(() => store.dispatch(addItem({...item('quiet',),},),))
		expect(menuClasses(),).not.toContain('open',)

		act(() => store.dispatch(addItem({...item('loud',), attention: true,},),))
		expect(menuClasses(),).toContain('open',)

		act(() => vi.advanceTimersByTime(1000,))
		expect(menuClasses(),).not.toContain('open',)
		expect(store.getState().contextMenu.attentionId,).toBeNull()
	})

	it('drops the highlight when the item that asked for it is removed', () => {
		act(() => store.dispatch(addItem({...item('quiet',),},),))
		act(() => store.dispatch(addItem({...item('loud',), attention: true,},),))
		expect(menuClasses(),).toContain('open',)

		act(() => store.dispatch(removeItem('loud',),))
		expect(menuClasses(),).not.toContain('open',)
	})
})
