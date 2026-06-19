/** Controlled User Flair tab content for the ModButtonPopup: template select plus text/class inputs. */

import {ChangeEvent,} from 'react'

import {TextInput,} from '../../../shared/controls/NormalInput'
import {SelectInput,} from '../../../shared/controls/SelectInput'
import {classes,} from '../../../util/ui/reactMount'
import {maxFlairTextLength,} from './ModButtonPopup.helpers'
import css from './ModButtonPopup.module.css'

/** A user flair template as returned by the flair API; `any` narrowed to the fields this tab reads. */
export interface FlairTemplate {
	id: string
	text: string
	css_class: string
	background_color?: string
	/** `'dark'` renders black option text; anything else renders white. */
	text_color?: string
}

/** Props for the UserFlairTab component. All state lives in the parent so it survives tab switches. */
interface UserFlairTabProps {
	flairTemplates: FlairTemplate[]
	flairTemplateId: string
	flairText: string
	flairClass: string
	/** True when a template is selected, which locks the CSS class field. */
	flairClassDisabled: boolean
	onTemplateChange: (event: ChangeEvent<HTMLSelectElement>,) => void
	onTextChange: (value: string,) => void
	onClassChange: (value: string,) => void
}

/** The User Flair tab: a flair template dropdown and editable text/class fields. */
export function UserFlairTab ({
	flairTemplates,
	flairTemplateId,
	flairText,
	flairClass,
	flairClassDisabled,
	onTemplateChange,
	onTextChange,
	onClassChange,
}: UserFlairTabProps,) {
	return (
		<>
			<p className={css.flairInput}>
				<label htmlFor="flair-template-id-select" className={css.flairLabel}>Template:</label>
				<SelectInput
					id="flair-template-id-select"
					className={css.flairTemplateSelect}
					value={flairTemplateId}
					onChange={onTemplateChange}
				>
					<option value="">None</option>
					{flairTemplates.map((f,) => (
						<option
							key={f.id}
							value={f.id}
							style={{
								backgroundColor: f.background_color || 'initial',
								color: f.text_color === 'dark' ? '#000' : '#fff',
							}}
						>
							{f.text}
						</option>
					))}
				</SelectInput>
			</p>
			<p className={css.flairInput}>
				<label htmlFor="flair-text" className={css.flairLabel}>Text:</label>
				<TextInput
					id="flair-text"
					type="text"
					value={flairText}
					maxLength={maxFlairTextLength}
					onChange={(event,) => onTextChange(event.target.value,)}
				/>
				<span
					className={classes(
						css.flairCharCount,
						flairText.length >= maxFlairTextLength && css.flairCharCountAtLimit,
					)}
				>
					({flairText.length}/{maxFlairTextLength})
				</span>
			</p>
			<p className={css.flairInput}>
				<label htmlFor="flair-class" className={css.flairLabel}>Class:</label>
				<TextInput
					id="flair-class"
					type="text"
					value={flairClass}
					disabled={flairClassDisabled}
					title={flairClassDisabled
						? 'Changing the class is disabled when using a flair template.'
						: undefined}
					onChange={(event,) => onClassChange(event.target.value,)}
				/>
			</p>
		</>
	)
}
