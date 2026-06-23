/** Dropdown panel for toggling individual moderators in or out of the matrix view. */

import {useEffect, useRef, useState,} from 'react'
import {classes,} from '../../../util/ui/reactMount'
import {isFilterItemChecked, toggleFilterItem,} from '../filterUtils'
import css from '../modmatrix.module.css'
import {Toggle,} from './Toggle'

/** Props for the {@link ModeratorFilter} component. */
interface Props {
	/** Full list of moderator usernames present in the subreddit. */
	moderators: string[]
	/** Active filter: `null` means all moderators are shown; an array restricts to those usernames. */
	modFilter: string[] | null
	/** Called when the selection changes. */
	onChange: (filter: string[] | null,) => void
}

/**
 * Renders a button that opens a floating panel with a toggle for each moderator.
 * The button label shows the active filter count when not all moderators are selected.
 */
export function ModeratorFilter ({moderators, modFilter, onChange,}: Props,) {
	const [open, setOpen,] = useState(false,)
	const [pos, setPos,] = useState({top: 0, left: 0,},)
	const btnRef = useRef<HTMLButtonElement>(null,)
	const panelRef = useRef<HTMLDivElement>(null,)

	useEffect(() => {
		if (!open) { return }
		function handleDown (e: MouseEvent,) {
			const target = e.composedPath()[0] as Node
			if (
				!panelRef.current?.contains(target,)
				&& !btnRef.current?.contains(target,)
			) {
				setOpen(false,)
			}
		}
		document.addEventListener('mousedown', handleDown,)
		return () => document.removeEventListener('mousedown', handleDown,)
	}, [open,],)

	function handleButtonClick () {
		if (!open && btnRef.current) {
			const rect = btnRef.current.getBoundingClientRect()
			setPos({top: rect.bottom + 3, left: rect.left,},)
		}
		setOpen((o,) => !o)
	}

	const isFiltered = modFilter !== null && modFilter.length < moderators.length
	const label = isFiltered
		? `Mods (${modFilter.length}/${moderators.length})`
		: 'Mods'

	function isChecked (mod: string,) {
		return isFilterItemChecked(modFilter, mod,)
	}

	function handleAllChange (checked: boolean,) {
		onChange(checked ? null : [],)
	}

	function handleModChange (mod: string, checked: boolean,) {
		onChange(toggleFilterItem(modFilter, moderators, mod, checked,),)
	}

	return (
		<div className={css.filterControl}>
			<button
				ref={btnRef}
				type="button"
				className={classes(css.filterButton, isFiltered && css.filterButtonActive,)}
				aria-expanded={open}
				onClick={handleButtonClick}
			>
				{label} ▾
			</button>
			{open && (
				<div
					ref={panelRef}
					className={css.filterPopover}
					style={{top: pos.top, left: pos.left,}}
				>
					<div className={css.filterPopoverItems}>
						<Toggle
							id="mm-modfilter-all"
							checked={modFilter === null}
							onChange={handleAllChange}
							label="Show/Hide All"
						/>
						{moderators.map((mod,) => (
							<Toggle
								key={mod}
								id={`mm-modfilter-${mod}`}
								checked={isChecked(mod,)}
								onChange={(checked,) => handleModChange(mod, checked,)}
								label={mod}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	)
}
