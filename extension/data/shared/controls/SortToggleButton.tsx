/** Footer toggle button and wiring for card-list sort mode (collapse-to-headers reordering). */

import {useEffect, useState,} from 'react'

import {ActionButton,} from './ActionButton'
import {Icon,} from './Icon'

/**
 * Two-slot ref connecting a card list to its footer's Reorder toggle: the
 * list assigns `toggle`, the footer assigns `onChange` to be told the new
 * sort-mode state whenever it flips.
 */
export interface SortModeRef {
	toggle: (() => void) | null
	onChange: ((sorting: boolean,) => void) | null
}

/**
 * List-side hook for {@link SortModeRef}: exposes the toggle to the footer
 * button and reports flips back so the footer can update its label.
 * @returns Whether sort mode is currently active.
 */
export function useSortMode (sortRef?: SortModeRef,): boolean {
	const [sorting, setSorting,] = useState(false,)

	useEffect(() => {
		if (!sortRef) { return }
		sortRef.toggle = () => setSorting((prev,) => !prev)
		return () => {
			sortRef.toggle = null
		}
	}, [],)
	useEffect(() => {
		sortRef?.onChange?.(sorting,)
	}, [sorting,],)

	return sorting
}

/**
 * Footer button that toggles a card list's compact sort view through a
 * {@link SortModeRef}, flipping its label between "Collapse for sorting" and
 * "Expand cards" as the list reports state changes. (Cards can be dragged in
 * either view; collapsing just makes large shuffles easier.)
 */
export function SortToggleButton ({sortRef,}: {sortRef: SortModeRef},) {
	const [sorting, setSorting,] = useState(false,)
	useEffect(() => {
		sortRef.onChange = setSorting
		return () => {
			sortRef.onChange = null
		}
	}, [],)

	return (
		<ActionButton
			type="button"
			title="Collapse the cards to headers for easy drag reordering"
			onClick={() => sortRef.toggle?.()}
		>
			<Icon icon={sorting ? 'close' : 'dragHandle'} />
			{sorting ? 'Expand cards' : 'Collapse for sorting'}
		</ActionButton>
	)
}
