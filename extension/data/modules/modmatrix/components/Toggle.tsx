/** Styled checkbox toggle with a sliding track, used throughout the Mod Log Matrix UI. */

import css from '../modmatrix.module.css'

/** Props for the {@link Toggle} component. */
interface Props {
	id: string
	checked: boolean
	onChange: (checked: boolean,) => void
	label: string
}

/** Renders a labelled checkbox styled as a sliding toggle switch. */
export function Toggle ({id, checked, onChange, label,}: Props,) {
	return (
		<label htmlFor={id} className={css.toggle}>
			<input
				type="checkbox"
				id={id}
				checked={checked}
				onChange={(e,) => onChange(e.target.checked,)}
			/>
			<span className={css.toggleTrack}>
				<span className={css.toggleThumb} />
			</span>
			{label}
		</label>
	)
}
