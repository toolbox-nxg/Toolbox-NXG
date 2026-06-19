/** Editable key->value mapping control rendered as a two-column table. */

import {useRef, useState,} from 'react'
import {tbDecode,} from '../../util/data/encoding'
import {Icon,} from './Icon'
import css from './MapInput.module.css'

/**
 * Renders a table of key/value text inputs with add and remove row buttons.
 * Keys and values are stored as `encodeURIComponent`-encoded strings in the onChange output.
 * @param props Component properties.
 * @param labels Column header labels for [key, value].
 * @param value Current mapping as a `Record<string, string>` of encoded strings.
 * @param onChange Called with the updated record whenever any row changes.
 */
export const MapInput = ({
	labels,
	value,
	onChange,
}: {
	labels: [string, string,]
	value: Record<string, string>
	onChange: (value: Record<string, string>,) => void
},) => {
	// Stable numeric IDs let React correctly associate DOM nodes with rows when rows are added/removed
	const nextId = useRef(0,)
	const [rows, setRows,] = useState<Array<{id: number; key: string; value: string}>>(() =>
		Object.entries(value,).map(([k, v,],) => ({id: nextId.current++, key: tbDecode(k,), value: tbDecode(v,),}))
	)

	const update = (newRows: typeof rows,) => {
		setRows(newRows,)
		const newValue: Record<string, string> = {}
		for (const row of newRows) {
			const k = encodeURIComponent(row.key.trim(),)
			const v = encodeURIComponent(row.value.trim(),)
			// Only rows with a non-empty key are serialized; a keyless row has no
			// place in a map and would otherwise collide under the empty-string key.
			if (k) { newValue[k] = v }
		}
		onChange(newValue,)
	}

	const lastRow = rows[rows.length - 1]
	const canAddRow = rows.length === 0 || (lastRow!.key.trim() !== '' && lastRow!.value.trim() !== '')

	const addRow = () => update([...rows, {id: nextId.current++, key: '', value: '',},],)

	const removeRow = (index: number,) => update(rows.filter((_, i,) => i !== index),)

	const updateRow = (index: number, field: 'key' | 'value', newVal: string,) => {
		const newRows = rows.map((r, i,) => i === index ? {...r, [field]: newVal,} : r)
		update(newRows,)
	}

	return (
		<div className={css.wrapper}>
			<table className={css.table}>
				<thead>
					<tr>
						<th>{labels[0]}</th>
						<th>{labels[1]}</th>
						<th className={css.removeCol}>remove</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row, i,) => (
						<tr key={row.id}>
							<td>
								<input
									type="text"
									className={css.input}
									value={row.key}
									onChange={(event,) => updateRow(i, 'key', event.target.value,)}
								/>
							</td>
							<td>
								<input
									type="text"
									className={css.input}
									value={row.value}
									onChange={(event,) => updateRow(i, 'value', event.target.value,)}
								/>
							</td>
							<td className={css.removeCol}>
								<button
									type="button"
									className={css.removeBtn}
									aria-label="Remove row"
									onClick={() => removeRow(i,)}
								>
									<Icon icon="delete" mood="negative" />
								</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<button type="button" className={css.addBtn} aria-label="Add row" onClick={addRow} disabled={!canAddRow}>
				<Icon icon="addBox" mood="positive" />
			</button>
		</div>
	)
}
