/** Radio-button group that presents a set of options as inline selectable chips. */

import {useId,} from 'react'
import css from './SingleSelect.module.css'

/**
 * Renders a group of radio buttons, one per option.
 * Option values are derived from labels by lower-casing and replacing spaces with underscores.
 * @param props Component properties.
 * @param options Display labels for each option (and the source of each option's stored value).
 * @param value Currently selected value (in the derived key form).
 * @param labels Optional display-text overrides keyed by the option string. When present, the
 *   override text is shown instead of the option itself, while the stored value is still derived
 *   from the option — letting a label be renamed without changing what is persisted.
 * @param onChange Called with the derived value string when the selection changes.
 */
export const SingleSelect = ({
	options,
	value,
	labels,
	onChange,
}: {
	options: string[]
	value?: string
	labels?: Partial<Record<string, string>> | undefined
	onChange: (value: string,) => void
},) => {
	const groupName = useId()
	return (
		<div className={css.group}>
			{options.map((label,) => {
				const val = label.toLowerCase().replace(/\s/g, '_',)
				const id = `${groupName}-${val}`
				return (
					<span key={val} className={css.option}>
						<input
							type="radio"
							name={groupName}
							id={id}
							value={val}
							checked={value === val}
							onChange={() => onChange(val,)}
						/>
						<label htmlFor={id}>{labels?.[label] ?? label}</label>
					</span>
				)
			},)}
		</div>
	)
}
