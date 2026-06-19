/** Controlled Send Modmail tab content for the ModButtonPopup: from-sub select, send-as toggle, subject, and body. */

import {TextInput,} from '../../../shared/controls/NormalInput'
import {SelectInput,} from '../../../shared/controls/SelectInput'
import {TextareaInput,} from '../../../shared/controls/TextareaInput'
import {classes,} from '../../../util/ui/reactMount'
import css from './ModButtonPopup.module.css'

/** Props for the SendModmailTab component. All state lives in the parent so it survives tab switches. */
interface SendModmailTabProps {
	/** Subreddits offered in the "From" dropdown, with the active subreddit floated to the top. */
	modmailSubOptions: string[]
	modmailSub: string
	onModmailSubChange: (subreddit: string,) => void
	/** When true, the message is sent as the subreddit rather than the moderator. */
	isHidden: boolean
	onIsHiddenChange: (hidden: boolean,) => void
	subject: string
	onSubjectChange: (value: string,) => void
	body: string
	onBodyChange: (value: string,) => void
	/** Status shown under the form after a send attempt. */
	callback: {text: string; kind: '' | 'error' | 'success'}
	/** Fallback shown in the "send as subreddit" label when no From sub is selected. */
	activeSub: string
}

/** The Send Modmail tab: choose the sending subreddit and identity, then compose the message. */
export function SendModmailTab ({
	modmailSubOptions,
	modmailSub,
	onModmailSubChange,
	isHidden,
	onIsHiddenChange,
	subject,
	onSubjectChange,
	body,
	onBodyChange,
	callback,
	activeSub,
}: SendModmailTabProps,) {
	return (
		<>
			<div className={css.modmailRow}>
				<label className={css.modmailRowLabel}>From:</label>
				<SelectInput
					className={css.modmailSubSelect}
					value={modmailSub}
					onChange={(e,) => onModmailSubChange(e.target.value,)}
				>
					{modmailSubOptions.map((s,) => (
						<option key={s} value={s}>/r/{s}</option>
					))}
				</SelectInput>
			</div>
			<div className={css.modmailRow}>
				<label className={css.modmailRowLabel}>Send as:</label>
				<label className={css.modmailRadioLabel}>
					<input
						type="radio"
						checked={!isHidden}
						onChange={() => onIsHiddenChange(false,)}
					/>{' '}
					myself
				</label>
				<label className={css.modmailRadioLabel}>
					<input
						type="radio"
						checked={isHidden}
						onChange={() => onIsHiddenChange(true,)}
					/>{' '}
					/r/{modmailSub || activeSub}
				</label>
			</div>
			<label className={css.modmailFieldLabel}>Subject</label>
			<TextInput
				className={css.modmailSubject}
				type="text"
				placeholder="Subject"
				maxLength={100}
				value={subject}
				onChange={(event,) => onSubjectChange(event.target.value,)}
			/>
			<label className={css.modmailFieldLabel}>Message</label>
			<TextareaInput
				className={css.modmailBody}
				placeholder="Message to user"
				value={body}
				onChange={(event,) => onBodyChange(event.target.value,)}
			/>
			<span
				className={classes(
					callback.kind === 'error' && css.error,
					callback.kind === 'success' && css.callbackSuccess,
				)}
			>
				{callback.text}
			</span>
		</>
	)
}
