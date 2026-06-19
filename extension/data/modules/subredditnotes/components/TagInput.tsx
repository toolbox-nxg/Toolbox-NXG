/** Tag pill input with autocomplete for selecting tags from an existing set. */
import {useEffect, useRef, useState,} from 'react'

import {classes,} from '../../../util/ui/reactMount'
import css from './TagInput.module.css'

/**
 * Displays existing tags as removable pills and provides a text input with
 * autocomplete for adding new tags. Pressing Enter or comma commits the
 * current input; Backspace on an empty input removes the last pill.
 */
export function TagInput ({
	tags,
	suggestions,
	disabled = false,
	onChange,
	className,
	'aria-label': ariaLabel,
}: {
	'tags': string[]
	/** Existing tags from the note index, used to populate the autocomplete dropdown. */
	'suggestions': string[]
	'disabled'?: boolean
	'onChange': (tags: string[],) => void
	'className'?: string | undefined
	'aria-label'?: string | undefined
},) {
	const [inputValue, setInputValue,] = useState('',)
	const [showDropdown, setShowDropdown,] = useState(false,)
	const [activeIndex, setActiveIndex,] = useState(-1,)
	const inputRef = useRef<HTMLInputElement>(null,)
	const containerRef = useRef<HTMLDivElement>(null,)

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent,) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node,)) {
				setShowDropdown(false,)
			}
		}
		document.addEventListener('mousedown', handleClickOutside,)
		return () => document.removeEventListener('mousedown', handleClickOutside,)
	}, [],)

	const tagsLower = tags.map((t,) => t.toLowerCase())

	const filteredSuggestions = suggestions
		.filter((s,) => !tagsLower.includes(s.toLowerCase(),))
		.filter((s,) => !inputValue.trim() || s.toLowerCase().includes(inputValue.trim().toLowerCase(),))
		.slice(0, 8,)

	const addTag = (raw: string,) => {
		const trimmed = raw.trim()
		if (!trimmed || tagsLower.includes(trimmed.toLowerCase(),)) {
			setInputValue('',)
			return
		}
		onChange([...tags, trimmed,],)
		setInputValue('',)
		setActiveIndex(-1,)
	}

	const removeTag = (index: number,) => {
		onChange(tags.filter((_, i,) => i !== index),)
	}

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>,) => {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault()
			if (activeIndex >= 0 && filteredSuggestions[activeIndex]) {
				addTag(filteredSuggestions[activeIndex],)
			} else {
				addTag(inputValue,)
			}
			setShowDropdown(false,)
		} else if (e.key === 'ArrowDown') {
			e.preventDefault()
			setActiveIndex((i,) => Math.min(i + 1, filteredSuggestions.length - 1,))
		} else if (e.key === 'ArrowUp') {
			e.preventDefault()
			setActiveIndex((i,) => Math.max(i - 1, -1,))
		} else if (e.key === 'Escape') {
			setShowDropdown(false,)
			setActiveIndex(-1,)
		} else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
			removeTag(tags.length - 1,)
		}
	}

	return (
		<div
			ref={containerRef}
			className={classes(css.container, disabled && css.disabled, className,)}
			onClick={() => !disabled && inputRef.current?.focus()}
		>
			{tags.map((tag, i,) => (
				<span key={tag} className={css.pill}>
					{tag}
					<button
						type="button"
						className={css.pillRemove}
						aria-label={`Remove tag ${tag}`}
						tabIndex={-1}
						onClick={(e,) => {
							e.stopPropagation()
							removeTag(i,)
						}}
					>
						×
					</button>
				</span>
			))}
			<input
				ref={inputRef}
				aria-label={ariaLabel}
				className={css.input}
				value={inputValue}
				placeholder={tags.length === 0 ? 'Add tags...' : ''}
				disabled={disabled}
				onChange={(e,) => {
					const val = e.target.value.replace(/,/g, '',)
					setInputValue(val,)
					setShowDropdown(true,)
					setActiveIndex(-1,)
				}}
				onKeyDown={handleKeyDown}
				onFocus={() => setShowDropdown(true,)}
			/>
			{showDropdown && filteredSuggestions.length > 0 && (
				<ul className={css.dropdown} role="listbox" aria-label="Tag suggestions">
					{filteredSuggestions.map((s, i,) => (
						<li
							key={s}
							role="option"
							aria-selected={i === activeIndex}
							className={classes(css.suggestion, i === activeIndex && css.suggestionActive,)}
							onMouseDown={(e,) => {
								e.preventDefault()
								addTag(s,)
								setShowDropdown(false,)
							}}
						>
							{s}
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
