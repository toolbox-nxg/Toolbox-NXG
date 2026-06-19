/** Dropdown (or button-overlay) control that lists available macros for a given context and subreddit. */

import {useState,} from 'react'

import {ActionSelect,} from '../../../shared/controls/ActionSelect'
import {useFetched,} from '../../../util/ui/hooks'
import {getMacroConfig,} from '../moduleapi'
import {MacroConfig,} from '../schema'

const macros = 'TB-MACROS'

/** Maps a macro context type to the config field that flags macros for that context. */
const typeToContext = {
	post: 'contextpost',
	comment: 'contextcomment',
	modmail: 'contextmodmail',
} as const

/** Props for the MacroSelect component. */
export interface MacroSelectProps {
	/** The subreddit whose macro configuration should be loaded. */
	subreddit: string
	/** The context type used to filter which macros are shown. */
	type: 'modmail' | 'post' | 'comment'
	/**
	 * Called when the user picks a macro.
	 * @param macro The selected macro configuration.
	 * @param dropdown The host element of the select control (used to position the edit popup).
	 * @param reset Resets the select back to the placeholder option.
	 */
	onSelectMacro: (macro: MacroConfig, dropdown: Element, reset: () => void,) => Promise<void>
	/**
	 * How to render the control - `'select'` shows a plain `<select>`, while `'button'` overlays
	 * a transparent select on top of a styled button.
	 */
	presentation?: 'select' | 'button'
	/** Label text shown as the placeholder option and button caption. */
	label?: string
}

/** Renders a macro picker that is filtered to the given context type and subreddit. */
export function MacroSelect (
	{subreddit, type, onSelectMacro, presentation = 'select', label = 'macros',}: MacroSelectProps,
) {
	const config = useFetched(getMacroConfig(subreddit,),)

	const [value, setValue,] = useState(macros,)
	const [disabled, setDisabled,] = useState(false,)

	if (config == null) {
		return <></>
	}

	const context = typeToContext[type]

	const reset = () => {
		setValue(macros,)
		setDisabled(false,)
	}

	const handleChange: React.ChangeEventHandler<HTMLSelectElement> = async (event,) => {
		const index = event.target.value
		if (index === macros) { return }

		const indexNum = parseInt(index, 10,)
		const macro = config[indexNum]
		if (!macro) { return }

		const parentNode = event.target.parentNode
		if (!parentNode) { return }
		const dropdown = parentNode as Element

		setValue(index,)
		setDisabled(true,)

		await onSelectMacro(macro, dropdown, reset,)
	}

	const macroOptions = (Object.entries(config,) as [string, MacroConfig,][]).filter(
		([, item,],) => item[context] !== false,
	)

	if (macroOptions.length === 0) {
		return null
	}

	const options = (
		<>
			<option value={macros}>{label}</option>
			{macroOptions.map(([i, item,],) => (
				<option key={i} value={i}>{item.title}</option>
			))}
		</>
	)

	if (presentation === 'button') {
		return (
			<span
				style={{
					position: 'relative',
					display: 'inline-flex',
					alignItems: 'center',
					justifyContent: 'center',
					verticalAlign: 'middle',
				}}
			>
				<span
					aria-hidden="true"
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						minHeight: '32px',
						padding: '0 12px',
						borderRadius: '999px',
						color: 'var(--color-secondary-plain, inherit)',
						font: 'inherit',
						fontSize: '1em',
						fontWeight: 600,
						lineHeight: '16px',
						whiteSpace: 'nowrap',
					}}
				>
					<span style={{display: 'inline-flex', marginRight: '4px',}}>
						<svg
							fill="currentColor"
							height="20"
							viewBox="0 0 20 20"
							width="20"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path d="M4 3.5A1.5 1.5 0 0 1 5.5 2h9A1.5 1.5 0 0 1 16 3.5v13a.5.5 0 0 1-.76.43L10 13.78l-5.24 3.15A.5.5 0 0 1 4 16.5v-13ZM5.5 3a.5.5 0 0 0-.5.5v12.12l4.74-2.85a.5.5 0 0 1 .52 0L15 15.62V3.5a.5.5 0 0 0-.5-.5h-9Z" />
						</svg>
					</span>
					<span>{label}</span>
				</span>
				<ActionSelect
					aria-label={label}
					title={label}
					value={value}
					disabled={disabled}
					onChange={handleChange}
					style={{
						position: 'absolute',
						inset: 0,
						width: '100%',
						height: '100%',
						opacity: 0,
						cursor: disabled ? 'default' : 'pointer',
					}}
				>
					{options}
				</ActionSelect>
			</span>
		)
	}

	return (
		<ActionSelect
			style={{
				verticalAlign: 'middle',
				maxWidth: '90px',
			}}
			value={value}
			disabled={disabled}
			onChange={handleChange}
		>
			{options}
		</ActionSelect>
	)
}
