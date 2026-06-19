/** A stacked radio-card group for choosing how a setting applies to moderators. */

import css from './EnforcementModeRadio.module.css'

/** A single enforcement-mode choice: its stored value and its display label. */
export interface EnforcementModeOption {
	/** The value persisted to config when this option is selected. */
	val: string
	/** The label shown to the moderator. */
	label: string
}

/** Props for {@link EnforcementModeRadio}. */
interface Props {
	/** The radio group's `name`, scoping which options are mutually exclusive. */
	name: string
	/** The selectable options, rendered top to bottom as highlightable cards. */
	options: readonly EnforcementModeOption[]
	/** The currently selected option's value. */
	value: string
	/** Called with the chosen value when the moderator selects an option. */
	onChange: (value: string,) => void
}

/**
 * Renders a vertical list of radio "cards" where the selected card is
 * highlighted. Shared by the removal-reasons and usernotes settings tabs so
 * their "moderator enforcement" pickers stay visually and behaviorally identical.
 */
export function EnforcementModeRadio ({name, options, value, onChange,}: Props,) {
	return (
		<div className={css.radioGroup}>
			{options.map(({val, label,},) => (
				<div
					key={val}
					className={`${css.radioOption} ${value === val ? css.selected : ''}`}
				>
					<label className={css.radioLabel}>
						<input
							type="radio"
							name={name}
							value={val}
							checked={value === val}
							onChange={() => onChange(val,)}
						/>
						{label}
					</label>
				</div>
			))}
		</div>
	)
}
