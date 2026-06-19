/** Settings UI tab for configuring the default ban note, message, duration, and duration presets. */

import {useEffect, useRef, useState,} from 'react'

import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {Icon,} from '../../../shared/controls/Icon'
import {TextInput,} from '../../../shared/controls/NormalInput'
import {TextareaInput,} from '../../../shared/controls/TextareaInput'
import {TokenChips,} from '../../../shared/controls/TokenChips'
import {negativeTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import type {ConfigState,} from '../../../util/wiki/schemas/config/schema'
import {pickSubstitutionTokens,} from '../../../util/wiki/schemas/shared/tokens'
import {type BanMacros, DEFAULT_BAN_PRESETS,} from '../schema'
import css from './BanMacroTab.module.css'

/** The substitution tokens supported in ban macro templates. */
const banMacroTokens = pickSubstitutionTokens(
	['{author}', '{subreddit}', '{kind}', '{title}', '{url}', '{mod}', '{body}',],
)

/** Ref used by a parent settings tab to imperatively trigger saving the ban macro config. */
export type SaveRef = {current: (() => void) | null}

/** Props for the BanMacroTab component. */
interface Props {
	/** Shared config state object passed down from the settings framework. */
	state: ConfigState
	/** Optional ref wired up by the parent tab to trigger saving the ban macro config. */
	saveRef?: SaveRef
	/** Called with the validated BanMacros data; the parent is responsible for persisting it. */
	onSave: (banMacros: BanMacros,) => void
}

const maxBanNoteLength = 300
const maxBanMessageLength = 999

/** Renders the ban macro settings tab for configuring default ban templates and duration presets. */
export function BanMacroTab ({state, saveRef, onSave,}: Props,) {
	const [banNote, setBanNote,] = useState(state.config.banMacros?.banNote ?? '',)
	const [banMessage, setBanMessage,] = useState(state.config.banMacros?.banMessage ?? '',)
	const [defaultBanPermanent, setDefaultBanPermanent,] = useState(
		state.config.banMacros?.defaultBanPermanent !== false,
	)
	const [defaultBanDuration, setDefaultBanDuration,] = useState(
		state.config.banMacros?.defaultBanDuration ? String(state.config.banMacros.defaultBanDuration,) : '',
	)
	const [banDurationPresets, setBanDurationPresets,] = useState<number[]>(
		Array.isArray(state.config.banMacros?.banDurationPresets,)
			&& state.config.banMacros.banDurationPresets.length > 0
			? state.config.banMacros.banDurationPresets
			: DEFAULT_BAN_PRESETS,
	)

	function handleSave () {
		if (!state.subreddit) { return }
		const validPresets = banDurationPresets.filter((n,) => n >= 1 && n <= 999)
		const invalidCount = banDurationPresets.length - validPresets.length
		onSave({
			banNote,
			banMessage,
			defaultBanPermanent,
			defaultBanDuration: defaultBanPermanent ? 0 : (parseInt(defaultBanDuration, 10,) || 0),
			banDurationPresets: validPresets.length > 0 ? validPresets : DEFAULT_BAN_PRESETS,
		},)
		if (invalidCount > 0) {
			negativeTextFeedback(`${invalidCount} preset(s) out of range (1–999) were removed before saving.`,)
		} else {
			positiveTextFeedback('Ban macro is saved.',)
		}
	}

	// Refs into the token-accepting fields, for inserting chips at the cursor.
	const banNoteRef = useRef<HTMLInputElement>(null,)
	const banMessageRef = useRef<HTMLTextAreaElement>(null,)

	const handleSaveRef = useRef(handleSave,)
	handleSaveRef.current = handleSave
	useEffect(() => {
		if (!saveRef) { return }
		saveRef.current = () => handleSaveRef.current()
		return () => {
			saveRef.current = null
		}
	}, [],)

	return (
		<div className={css.root}>
			<div className={css.field}>
				<label className={css.fieldLabel} htmlFor="ban-note">Mod note (internal)</label>
				<TokenChips tokens={banMacroTokens} inputRef={banNoteRef} onChange={setBanNote}>
					<TextInput
						id="ban-note"
						ref={banNoteRef}
						type="text"
						className={css.fullWidth}
						value={banNote}
						onChange={(e,) => setBanNote(e.target.value,)}
						maxLength={maxBanNoteLength}
					/>
				</TokenChips>
				<span className={css.fieldHint}>
					Visible only to moderators ({maxBanNoteLength - banNote.length} chars remaining).
				</span>
			</div>
			<div className={css.field}>
				<label className={css.fieldLabel} htmlFor="ban-message">Ban message (sent to user)</label>
				<TokenChips tokens={banMacroTokens} inputRef={banMessageRef} onChange={setBanMessage}>
					<TextareaInput
						id="ban-message"
						ref={banMessageRef}
						rows={Math.max(3, banMessage.split('\n',).length,)}
						value={banMessage}
						onChange={(e,) => setBanMessage(e.target.value,)}
						maxLength={maxBanMessageLength}
					/>
				</TokenChips>
				<span className={css.fieldHint}>
					Sent to the user when banned ({maxBanMessageLength - banMessage.length} chars remaining).
				</span>
			</div>
			<p className={css.tokenHint}>
				Focus a field above to see the tokens it supports; hover a token for what it inserts.
			</p>
			<div className={css.field}>
				<div className={css.fieldLabel}>Default ban duration</div>
				<CheckboxInput
					label="Permanent ban by default"
					checked={defaultBanPermanent}
					onChange={(e,) => setDefaultBanPermanent(e.target.checked,)}
				/>
				{!defaultBanPermanent && (
					<TextInput
						type="number"
						min={1}
						max={999}
						placeholder="default duration (days)"
						value={defaultBanDuration}
						onChange={(e,) => setDefaultBanDuration(e.target.value,)}
					/>
				)}
			</div>
			<div className={css.field}>
				<div className={css.fieldLabel}>Duration preset buttons</div>
				<div className={css.presetList}>
					{banDurationPresets.map((days, i,) => (
						<div key={i} className={css.presetRow}>
							<TextInput
								type="number"
								min={1}
								max={999}
								className={css.presetInput}
								value={String(days,)}
								onChange={(e,) => {
									const n = parseInt(e.target.value, 10,)
									setBanDurationPresets((prev,) =>
										prev.map((v, j,) => j === i ? (isNaN(n,) ? v : n) : v)
									)
								}}
							/>
							<button
								type="button"
								className={css.presetRemoveBtn}
								aria-label="Remove preset"
								onClick={() => setBanDurationPresets((prev,) => prev.filter((_, j,) => j !== i))}
							>
								<Icon icon="delete" mood="negative" />
							</button>
						</div>
					))}
					<button
						type="button"
						className={css.presetAddBtn}
						aria-label="Add preset"
						onClick={() => setBanDurationPresets((prev,) => [...prev, 1,])}
					>
						<Icon icon="addBox" mood="positive" />
					</button>
				</div>
				<span className={css.fieldHint}>
					Durations (days) to show as quick-select buttons in the ban form.
				</span>
			</div>
		</div>
	)
}
