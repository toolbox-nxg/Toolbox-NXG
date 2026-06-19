/** Editable ordered list control where each item is a free-text string. */

import {useRef, useState,} from 'react'
import {Icon,} from './Icon'
import css from './ListInput.module.css'

/**
 * Renders a dynamic list of text inputs with add and remove buttons.
 * @param props Component properties.
 * @param value Current array of strings.
 * @param onChange Called with the updated array whenever any item changes (empty strings are filtered out).
 * @param placeholder Optional placeholder text for each input.
 */
export const ListInput = ({
	value,
	onChange,
	placeholder,
}: {
	value: string[]
	onChange: (value: string[],) => void
	placeholder?: string
},) => {
	// Stable numeric IDs let React correctly associate DOM nodes with items when rows are added/removed
	const nextId = useRef(0,)
	const [items, setItems,] = useState<Array<{id: number; value: string}>>(() =>
		value.map((v,) => ({id: nextId.current++, value: v,}))
	)

	const update = (newItems: typeof items,) => {
		setItems(newItems,)
		onChange(newItems.map((item,) => item.value).filter(Boolean,),)
	}

	const updateItem = (index: number, newVal: string,) => {
		update(items.map((item, i,) => i === index ? {...item, value: newVal,} : item),)
	}

	const addItem = () => update([...items, {id: nextId.current++, value: '',},],)

	const removeItem = (index: number,) => update(items.filter((_, i,) => i !== index),)

	return (
		<div className={css.wrapper}>
			{items.map((item, i,) => (
				<div key={item.id} className={css.row}>
					<input
						type="text"
						className={css.input}
						value={item.value}
						placeholder={placeholder}
						onChange={(event,) => updateItem(i, event.target.value,)}
					/>
					<button
						type="button"
						className={css.removeBtn}
						aria-label="Remove item"
						onClick={() => removeItem(i,)}
					>
						<Icon icon="delete" mood="negative" />
					</button>
				</div>
			))}
			<button type="button" className={css.addBtn} onClick={addItem}>
				<Icon icon="addBox" mood="positive" />
			</button>
		</div>
	)
}
