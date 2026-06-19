/** Renders a single setting row inside the SettingsDialog, dispatching to the appropriate input control by type. */

import {useState,} from 'react'
import {useEffect, useRef,} from 'react'
import {syntaxThemes,} from '../../modules/syntax/syntaxThemes'
import type {SyntaxTheme,} from '../../modules/syntax/syntaxThemes'
import {sendEvent,} from '../../util/reddit/events'
import {cleanSubredditName,} from '../../util/reddit/reddit-domain'
import {createEditor,} from '../../util/ui/codemirrorSetup'
import type {EditorHandle,} from '../../util/ui/codemirrorSetup'
import {ActionButton,} from '../controls/ActionButton'
import {ActionSelect,} from '../controls/ActionSelect'
import {CheckboxInput,} from '../controls/CheckboxInput'
import {Icon,} from '../controls/Icon'
import {ListInput,} from '../controls/ListInput'
import {MapInput,} from '../controls/MapInput'
import {TextInput,} from '../controls/NormalInput'
import {NumberInput,} from '../controls/NumberInput'
import {SingleSelect,} from '../controls/SingleSelect'
import {SubredditMultiSelect,} from '../controls/SubredditMultiSelect'
import {SubredditSelect,} from '../controls/SubredditSelect'
import {TextareaInput,} from '../controls/TextareaInput'
import css from './SettingRow.module.css'

/** Represents a single setting definition from a Module's settings Map. */
interface SettingDefinition {
	id: string
	type: string
	description?: string
	default?: unknown
	debug?: boolean
	hidden?: boolean
	advanced?: boolean
	min?: number | string
	max?: number | string
	step?: number | string
	values?: string[]
	/** Optional display-text overrides for selector options, keyed by the `values` entry. */
	valueLabels?: Partial<Record<string, string>>
	labels?: [string, string,]
	event?: string
	class?: string
	/** Optional placeholder text for text/stringlist inputs. */
	placeholder?: string
	/** Optional JSX rendered below the label (e.g., an icon preview). */
	preview?: React.ReactNode
	/** Optional image URL rendered as a small preview below the label. */
	previewImageUrl?: string
	/** Map of value -> note text shown below the input when that value is selected. */
	valueNotes?: Record<string, string>
}

const exampleCss = `/* Sample stylesheet for previewing the theme */
.toolbox-window {
    color: #1a1a1b;
    border: 1px solid #ccc;
}

a:hover, button:focus {
    text-decoration: underline;
}

#sidebar {
    background: #f6f7f8;
    padding: 8px 12px;
}
`

function SyntaxThemeSetting ({value, onChange,}: {value: string; onChange: (v: string,) => void},) {
	const textareaRef = useRef<HTMLTextAreaElement>(null,)
	const editorRef = useRef<EditorHandle | null>(null,)

	useEffect(() => {
		if (textareaRef.current && !editorRef.current) {
			editorRef.current = createEditor({
				textarea: textareaRef.current,
				mimetype: 'text/css',
				theme: (value || 'dracula') as SyntaxTheme,
				readOnly: true,
			},)
		}
		return () => {
			editorRef.current?.destroy()
			editorRef.current = null
		}
	}, [],)

	useEffect(() => {
		if (editorRef.current) {
			editorRef.current.setTheme((value || 'dracula') as SyntaxTheme,)
		}
	}, [value,],)

	return (
		<div className={css.syntaxTheme}>
			<ActionSelect value={value} onChange={(e,) => onChange(e.target.value,)}>
				{(syntaxThemes as unknown as string[]).map((theme,) => (
					<option key={theme} value={theme}>{theme}</option>
				))}
			</ActionSelect>
			<textarea
				ref={textareaRef}
				defaultValue={exampleCss}
				className={css.syntaxPreview}
				readOnly
			/>
		</div>
	)
}

/**
 * Renders the label, optional shareable-link button, and appropriate input control for one setting.
 * @param props Component properties.
 * @param settingDef The setting definition from the module's settings Map.
 * @param moduleId The module's ID string (used to build the storage key and share link).
 * @param value The current (locally-buffered) value of the setting.
 * @param onChange Called with the new value when the user changes the input.
 * @param shown When false, the row renders nothing (used to hide advanced settings).
 */
export function SettingRow ({
	settingDef,
	moduleId,
	value,
	onChange,
	shown,
}: {
	settingDef: SettingDefinition
	moduleId: string
	value: unknown
	onChange: (newValue: unknown,) => void
	shown: boolean
},) {
	const [linkExpanded, setLinkExpanded,] = useState(false,)

	if (!shown) { return null }

	const settingName = settingDef.id.toLowerCase()
	const moduleName = moduleId.toLowerCase()
	const redditLink = `[${settingDef.id}](#?tbsettings=${moduleName}&setting=${settingName})`
	const internetLink = `https://www.reddit.com/#?tbsettings=${moduleName}&setting=${settingName}`

	const rowProps = {
		'id': `toolbox-${moduleName}-${settingName}`,
		'data-module': moduleId,
		'data-setting': settingDef.id,
	}

	const linkButton = (
		<button
			type="button"
			className={`${css.settingLink} ${linkExpanded ? css.activeLink : ''}`}
			aria-label="Share link to this setting"
			aria-expanded={linkExpanded}
			onClick={() => setLinkExpanded((x,) => !x)}
		>
			<Icon icon="tbSettingLink" />
		</button>
	)

	const linkInputs = linkExpanded
		? (
			<div className={css.settingLinkInputs}>
				<TextInput type="text" readOnly value={redditLink} />
				<br />
				<TextInput type="text" readOnly value={internetLink} />
			</div>
		)
		: null

	// Action type: standalone button, no link
	if (settingDef.type === 'action') {
		if (!settingDef.event || !settingDef.class) { return null }
		return (
			<div className={css.row} id={`toolbox-${moduleName}-${settingName}`}>
				<ActionButton type="button" onClick={() => sendEvent(settingDef.event!,)}>
					{settingDef.description}
				</ActionButton>
			</div>
		)
	}

	// Boolean type: toggle + label inline, link button on same line
	if (settingDef.type === 'boolean') {
		const desc = settingDef.description ?? settingDef.id
		// Match an opening HTML tag (e.g. <a>, <strong>) to distinguish markup from
		// comparison operators like "value < 10" that also contain '<'.
		const containsHtml = /<[a-zA-Z]/.test(desc,)
		const labelNode = containsHtml
			? <span dangerouslySetInnerHTML={{__html: desc,}} />
			: desc
		return (
			<div className={css.row} {...rowProps}>
				<div className={css.labelRow}>
					<CheckboxInput
						label={labelNode}
						checked={!!(value ?? settingDef.default)}
						onChange={(event,) => onChange(event.target.checked,)}
					/>{' '}
					{linkButton}
				</div>
				{linkInputs}
			</div>
		)
	}

	// All other types: label + link on one line, input control below
	let inputEl: React.ReactNode

	switch (settingDef.type) {
		case 'number': {
			inputEl = (
				<NumberInput
					value={(value ?? settingDef.default) as number}
					min={settingDef.min}
					max={settingDef.max}
					step={settingDef.step}
					onChange={(event,) => onChange(parseFloat(event.target.value,),)}
				/>
			)
			break
		}

		case 'array':
		case 'JSON': {
			const jsonStr = JSON.stringify(value ?? settingDef.default, null, 0,)
			inputEl = (
				<TextareaInput
					rows={3}
					cols={80}
					value={jsonStr}
					onChange={(event,) => {
						try {
							onChange(JSON.parse(event.target.value,),)
						} catch { /* ignore */ }
					}}
				/>
			)
			break
		}

		case 'code': {
			inputEl = (
				<TextareaInput
					rows={25}
					cols={80}
					value={(value ?? settingDef.default ?? '') as string}
					onChange={(event,) => onChange(event.target.value,)}
				/>
			)
			break
		}

		case 'subreddit': {
			inputEl = (
				<TextInput
					type="text"
					value={(value ?? settingDef.default ?? '') as string}
					onChange={(event,) => onChange(cleanSubredditName(event.target.value,),)}
				/>
			)
			break
		}

		case 'modsub': {
			inputEl = (
				<SubredditSelect
					value={(value ?? settingDef.default ?? '') as string}
					onChange={onChange}
				/>
			)
			break
		}

		case 'text': {
			inputEl = (
				<TextInput
					type="text"
					value={(value ?? settingDef.default ?? '') as string}
					onChange={(event,) => onChange(event.target.value,)}
				/>
			)
			break
		}

		case 'list': {
			const rawList = (value ?? settingDef.default) as unknown
			const listValue = Array.isArray(rawList,) ? rawList.join(', ',) : ''
			inputEl = (
				<TextInput
					type="text"
					value={listValue as string}
					onChange={(event,) =>
						onChange(
							event.target.value.split(',',).map((s: string,) => s.trim()).filter(Boolean,),
						)}
				/>
			)
			break
		}

		case 'stringlist': {
			const listArr = (value ?? settingDef.default ?? []) as string[]
			inputEl = (
				<ListInput
					value={listArr}
					{...(settingDef.placeholder != null && {placeholder: settingDef.placeholder,})}
					onChange={onChange}
				/>
			)
			break
		}

		case 'selector': {
			const vals = settingDef.values ?? []
			const rawVal = (value ?? settingDef.default ?? '') as string
			// Normalize to match how SingleSelect computes values from labels
			const currentVal = rawVal.toLowerCase().replace(/\s/g, '_',)
			inputEl = (
				<SingleSelect
					options={vals}
					value={currentVal}
					labels={settingDef.valueLabels}
					onChange={onChange}
				/>
			)
			break
		}

		case 'sublist': {
			inputEl = (
				<SubredditMultiSelect
					selected={(value ?? settingDef.default ?? []) as string[]}
					onChange={onChange}
				/>
			)
			break
		}

		case 'map': {
			inputEl = (
				<MapInput
					labels={settingDef.labels ?? ['Key', 'Value',]}
					value={(value ?? settingDef.default ?? {}) as Record<string, string>}
					onChange={onChange}
				/>
			)
			break
		}

		case 'color': {
			inputEl = (
				<input
					type="color"
					className={css.colorInput}
					value={(value ?? settingDef.default ?? '#000000') as string}
					onChange={(event,) => onChange(event.target.value,)}
				/>
			)
			break
		}

		case 'syntaxTheme': {
			inputEl = (
				<SyntaxThemeSetting
					value={(value ?? settingDef.default ?? 'default') as string}
					onChange={onChange}
				/>
			)
			break
		}

		default: {
			const jsonStr = JSON.stringify(value ?? settingDef.default, null, 0,)
			inputEl = (
				<TextareaInput
					rows={1}
					value={jsonStr ?? ''}
					onChange={(event,) => {
						try {
							onChange(JSON.parse(event.target.value,),)
						} catch { /* ignore */ }
					}}
				/>
			)
		}
	}

	return (
		<div className={css.row} {...rowProps}>
			<div className={css.labelRow}>
				<span className={css.label}>{settingDef.description}:</span> {linkButton}
			</div>
			{settingDef.preview}
			{settingDef.previewImageUrl && (
				<img
					src={settingDef.previewImageUrl}
					alt="Preview"
					className={css.previewImage}
				/>
			)}
			{inputEl}
			{settingDef.valueNotes && (() => {
				const currentVal = (value ?? settingDef.default ?? '') as string
				const note = settingDef.valueNotes[currentVal]
				return note ? <p className={css.valueNote}>{note}</p> : null
			})()}
			{linkInputs}
		</div>
	)
}
