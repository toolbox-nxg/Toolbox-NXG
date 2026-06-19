/**
 * Structured editor for a removal reason's named select definitions.
 *
 * Each definition is a card with a slug-safe name, an optional prompt, and a
 * dynamic list of option textareas (options are multi-line markdown). The
 * reason's message text references a definition as `{select:name}`; the
 * builder offers a one-click insert of that reference at the message cursor.
 *
 * Empty option rows are kept while editing (so a mod can add a row and type
 * into it without it vanishing) and filtered out by the reason form at save
 * time. Name problems - empty or duplicated within the reason - are surfaced
 * as inline warnings rather than blocking input.
 */

import {useRef, useState,} from 'react'

import {ActionButton,} from '../../../shared/controls/ActionButton'
import {Icon,} from '../../../shared/controls/Icon'
import {TextInput,} from '../../../shared/controls/NormalInput'
import {TextareaInput,} from '../../../shared/controls/TextareaInput'
import type {SelectDefinition,} from '../../../util/wiki/schemas/shared/tokens'
import css from './SelectBuilder.module.css'

/** One definition row with stable React ids for itself and its option rows. */
interface DefinitionRow {
	id: number
	name: string
	prompt: string
	options: Array<{id: number; text: string}>
}

/** Props for the {@link SelectBuilder} component. */
export interface SelectBuilderProps {
	/** The reason's current select definitions. */
	value: SelectDefinition[]
	/** Called with the updated definitions on every edit (empty options included; the save path filters them). */
	onChange: (selects: SelectDefinition[],) => void
	/** Inserts a `{select:name}` reference into the reason's message text. */
	onInsertReference: (name: string,) => void
	/** Prefix applied to HTML `id` attributes to avoid collisions when two forms are visible. */
	idPrefix: string
}

/** Strips characters that aren't valid in a select definition name (`[\w-]`). */
function sanitizeName (name: string,): string {
	return name.replace(/[^\w-]/g, '',)
}

/** Returns the first `select-N` name not present in the given set. */
function nextFreeName (taken: Set<string>,): string {
	let counter = 0
	let name: string
	do {
		name = `select-${++counter}`
	} while (taken.has(name,))
	return name
}

/** Converts a local editing row back to the stored definition shape. */
function rowToDefinition (row: DefinitionRow,): SelectDefinition {
	return {
		name: row.name,
		...(row.prompt ? {prompt: row.prompt,} : {}),
		options: row.options.map((option,) => option.text),
	}
}

/** Structured add/edit UI for a reason's named select definitions. */
export function SelectBuilder ({value, onChange, onInsertReference, idPrefix,}: SelectBuilderProps,) {
	// Stable numeric ids let React keep DOM/state association as rows are
	// added and removed (same pattern as ListInput).
	const nextId = useRef(0,)
	const [rows, setRows,] = useState<DefinitionRow[]>(() =>
		value.map((definition,) => ({
			id: nextId.current++,
			name: definition.name,
			prompt: definition.prompt ?? '',
			// Start with one empty option row so a fresh definition is editable.
			options: (definition.options.length > 0 ? definition.options : ['',]).map((text,) => ({
				id: nextId.current++,
				text,
			})),
		}))
	)

	const update = (newRows: DefinitionRow[],) => {
		setRows(newRows,)
		onChange(newRows.map(rowToDefinition,),)
	}

	const updateRow = (index: number, change: Partial<DefinitionRow>,) => {
		update(rows.map((row, i,) => i === index ? {...row, ...change,} : row),)
	}

	const addDefinition = () => {
		update([...rows, {
			id: nextId.current++,
			name: nextFreeName(new Set(rows.map((row,) => row.name),),),
			prompt: '',
			options: [{id: nextId.current++, text: '',}, {id: nextId.current++, text: '',},],
		},],)
	}

	return (
		<div className={css.builder}>
			{rows.map((row, rowIndex,) => {
				const duplicate = rows.some((other, i,) => i !== rowIndex && other.name === row.name && row.name !== '')
				return (
					<div key={row.id} className={css.definitionCard}>
						<div className={css.definitionField}>
							<label className={css.definitionLabel} htmlFor={`${idPrefix}-select-${row.id}-name`}>
								Name
							</label>
							<div className={css.nameRow}>
								<TextInput
									id={`${idPrefix}-select-${row.id}-name`}
									type="text"
									placeholder="Select name"
									value={row.name}
									onChange={(e,) => updateRow(rowIndex, {name: sanitizeName(e.target.value,),},)}
								/>
								<ActionButton
									type="button"
									title="Insert this select into the message text at the cursor"
									disabled={!row.name}
									onClick={() => onInsertReference(row.name,)}
								>
									Insert {`{select:${row.name}}`}
								</ActionButton>
								<button
									type="button"
									className={css.iconButton}
									onClick={() => update(rows.filter((_, i,) => i !== rowIndex),)}
									title="Delete select"
								>
									<Icon icon="delete" mood="negative" />
								</button>
							</div>
							{row.name === ''
								&& <span className={css.warning}>A select needs a name to be usable.</span>}
							{duplicate
								&& <span className={css.warning}>
									Another select in this reason already uses this name.
								</span>}
						</div>
						<div className={css.definitionField}>
							<label className={css.definitionLabel} htmlFor={`${idPrefix}-select-${row.id}-prompt`}>
								Prompt (optional)
							</label>
							<TextInput
								id={`${idPrefix}-select-${row.id}-prompt`}
								type="text"
								placeholder="Shown above the choices"
								value={row.prompt}
								onChange={(e,) => updateRow(rowIndex, {prompt: e.target.value,},)}
							/>
						</div>
						<div className={css.definitionField}>
							<span className={css.definitionLabel}>Options</span>
							{row.options.map((option, optionIndex,) => (
								<div key={option.id} className={css.optionRow}>
									<TextareaInput
										rows={2}
										placeholder="Option text (markdown)"
										value={option.text}
										onChange={(e,) =>
											updateRow(rowIndex, {
												options: row.options.map((o, i,) =>
													i === optionIndex ? {...o, text: e.target.value,} : o
												),
											},)}
									/>
									<button
										type="button"
										className={css.iconButton}
										onClick={() =>
											updateRow(rowIndex, {
												options: row.options.filter((_, i,) => i !== optionIndex),
											},)}
										title="Remove option"
									>
										<Icon icon="delete" mood="negative" />
									</button>
								</div>
							))}
							<button
								type="button"
								className={css.iconButton}
								onClick={() =>
									updateRow(rowIndex, {
										options: [...row.options, {id: nextId.current++, text: '',},],
									},)}
								title="Add option"
							>
								<Icon icon="addBox" mood="positive" />
							</button>
						</div>
					</div>
				)
			},)}
			<div>
				<ActionButton type="button" onClick={addDefinition}>Add select</ActionButton>
			</div>
		</div>
	)
}
