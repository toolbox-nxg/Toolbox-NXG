/** Controlled ban-form fields for the ModButtonPopup Role tab: note, message, duration presets, and remove-all. */

import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {GeneralButton,} from '../../../shared/controls/GeneralButton'
import {GeneralInlineButton,} from '../../../shared/controls/GeneralInlineButton'
import {TextInput,} from '../../../shared/controls/NormalInput'
import {TextareaInput,} from '../../../shared/controls/TextareaInput'
import {classes,} from '../../../util/ui/reactMount'
import {maxBanReasonLength, removalNotice,} from './ModButtonPopup.helpers'
import css from './ModButtonPopup.module.css'

/** Props for the BanForm component. All state lives in the parent so it survives tab switches. */
interface BanFormProps {
	banNote: string
	onBanNoteChange: (value: string,) => void
	banMessage: string
	onBanMessageChange: (value: string,) => void
	banDuration: string
	onBanDurationChange: (value: string,) => void
	banPermanent: boolean
	showCustomDuration: boolean
	banDurationPresets: number[]
	removeAll: boolean
	/** Max ban-message length after accounting for the appended removal notice. */
	effectiveMaxMessage: number
	/** Error shown under the note field when the usernotes suggestion fails. */
	notesSuggestError: string
	/** Whether to show the "from notes" suggestion button (requires an active subreddit). */
	showFromNotes: boolean
	onSuggestFromNotes: () => void
	onSelectPreset: (days: number,) => void
	onSelectPermanent: () => void
	onSelectCustom: () => void
	onRemoveAllChange: (checked: boolean,) => void
}

/** The ban note/message/duration form shown when a ban-related action is selected. */
export function BanForm ({
	banNote,
	onBanNoteChange,
	banMessage,
	onBanMessageChange,
	banDuration,
	onBanDurationChange,
	banPermanent,
	showCustomDuration,
	banDurationPresets,
	removeAll,
	effectiveMaxMessage,
	notesSuggestError,
	showFromNotes,
	onSuggestFromNotes,
	onSelectPreset,
	onSelectPermanent,
	onSelectCustom,
	onRemoveAllChange,
}: BanFormProps,) {
	return (
		<div className={css.banNoteContainer}>
			<div className={css.banNoteRow}>
				<TextInput
					className={css.banNote}
					type="text"
					placeholder="(ban note - internal)"
					maxLength={maxBanReasonLength}
					value={banNote}
					onChange={(event,) => onBanNoteChange(event.target.value,)}
				/>
				<span
					className={classes(
						css.flairCharCount,
						banNote.length >= maxBanReasonLength && css.flairCharCountAtLimit,
					)}
				>
					({banNote.length}/{maxBanReasonLength})
				</span>
				{showFromNotes && (
					<GeneralInlineButton
						className={css.fromNotesBtn}
						stopPropagation={false}
						onClick={onSuggestFromNotes}
					>
						from notes
					</GeneralInlineButton>
				)}
			</div>
			{notesSuggestError && <span className={css.notesSuggestError}>{notesSuggestError}</span>}
			<TextareaInput
				className={css.banMessage}
				placeholder="(ban message - sent to user)"
				maxLength={effectiveMaxMessage}
				value={banMessage}
				onChange={(event,) => onBanMessageChange(event.target.value,)}
			/>
			<span
				className={classes(
					css.flairCharCount,
					banMessage.length >= effectiveMaxMessage && css.flairCharCountAtLimit,
				)}
			>
				({banMessage.length}/{effectiveMaxMessage})
			</span>
			<div className={css.banDurationRow}>
				{banDurationPresets.map((days,) => (
					<GeneralButton
						key={days}
						type="button"
						className={classes(
							css.banDurationPreset,
							!banPermanent && !showCustomDuration && banDuration === String(days,)
								&& css.banDurationPresetActive,
						)}
						onClick={() => onSelectPreset(days,)}
					>
						{days}d
					</GeneralButton>
				))}
				<GeneralButton
					type="button"
					className={classes(
						css.banDurationPreset,
						banPermanent && css.banDurationPresetActive,
					)}
					onClick={onSelectPermanent}
					title="Permanent ban"
				>
					Permanent
				</GeneralButton>
				<GeneralButton
					type="button"
					className={classes(
						css.banDurationPreset,
						showCustomDuration && css.banDurationPresetActive,
					)}
					onClick={onSelectCustom}
				>
					Custom
				</GeneralButton>
				{showCustomDuration && (
					<TextInput
						className={css.banDuration}
						type="number"
						min={1}
						max={999}
						placeholder="days"
						value={banDuration}
						onChange={(event,) => onBanDurationChange(event.target.value,)}
						autoFocus
					/>
				)}
			</div>
			{banPermanent && (
				<div className={css.removeAllRow}>
					<CheckboxInput
						label="Remove all posts & comments from selected subreddit(s)"
						checked={removeAll}
						onChange={(e,) => onRemoveAllChange(e.target.checked,)}
					/>
					{removeAll && (
						<p className={css.removalNotice}>
							The following will be appended to the ban message: &ldquo;{removalNotice
								.trim()}&rdquo;
						</p>
					)}
				</div>
			)}
		</div>
	)
}
