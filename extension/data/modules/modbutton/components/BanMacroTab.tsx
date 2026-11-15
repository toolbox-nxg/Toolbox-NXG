/** Settings UI tab for the default ban note, message, duration and presets, plus the named ban macro list. */

import {useRef, useState,} from 'react'

import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {Icon,} from '../../../shared/controls/Icon'
import {TextInput,} from '../../../shared/controls/NormalInput'
import {TextareaInput,} from '../../../shared/controls/TextareaInput'
import {TokenChips,} from '../../../shared/controls/TokenChips'
import {negativeTextFeedback, positiveTextFeedback,} from '../../../store/feedback'
import {type TriggerRef, useTriggerRef,} from '../../../util/ui/hooks'
import type {ConfigState,} from '../../../util/wiki/schemas/config/schema'
import {SavedBanMacroList,} from '../../shared/banMacros/components/SavedBanMacroList'
import {banMacroTokens, maxBanMacroMessage, maxBanMacroNote, type SavedBanMacro,} from '../../shared/banMacros/schema'
import {type BanMacros, DEFAULT_BAN_PRESETS,} from '../schema'
import css from './BanMacroTab.module.css'

/** Props for the BanMacroTab component. */
interface Props {
	/** Shared config state object passed down from the settings framework. */
	state: ConfigState
	/** Optional ref wired up by the parent tab to trigger saving the ban macro config. */
	saveRef?: TriggerRef
	/**
	 * Called with the validated defaults, the named macro list, and whether a ban message is required;
	 * the parent is responsible for persisting all three.
	 */
	onSave: (
		banMacros: BanMacros,
		savedBanMacros: SavedBanMacro[],
		requireBanMessage: boolean,
		disableNativeNoteBan: boolean,
	) => void
}

const maxBanNoteLength = maxBanMacroNote
const maxBanMessageLength = maxBanMacroMessage

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
	const [savedBanMacros, setSavedBanMacros,] = useState<SavedBanMacro[]>(state.config.savedBanMacros ?? [],)
	const [requireBanMessage, setRequireBanMessage,] = useState(state.config.requireBanMessage === true,)
	const [disableNativeNoteBan, setDisableNativeNoteBan,] = useState(state.config.disableNativeNoteBan === true,)

	function handleSave () {
		if (!state.subreddit) { return }
		if (savedBanMacros.some((macro,) => macro.title.trim() === '')) {
			negativeTextFeedback('Every ban macro needs a title before saving.',)
			return
		}
		const validPresets = banDurationPresets.filter((n,) => n >= 1 && n <= 999)
		const invalidCount = banDurationPresets.length - validPresets.length
		onSave(
			{
				banNote,
				banMessage,
				defaultBanPermanent,
				defaultBanDuration: defaultBanPermanent ? 0 : (parseInt(defaultBanDuration, 10,) || 0),
				banDurationPresets: validPresets.length > 0 ? validPresets : DEFAULT_BAN_PRESETS,
			},
			savedBanMacros,
			requireBanMessage,
			disableNativeNoteBan,
		)
		if (invalidCount > 0) {
			negativeTextFeedback(`${invalidCount} preset(s) out of range (1–999) were removed before saving.`,)
		} else {
			positiveTextFeedback('Ban settings are saved.',)
		}
	}

	// Refs into the token-accepting fields, for inserting chips at the cursor.
	const banNoteRef = useRef<HTMLInputElement>(null,)
	const banMessageRef = useRef<HTMLTextAreaElement>(null,)

	useTriggerRef(saveRef, handleSave,)

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
				<span className={css.fieldHint}>
					Bans issued from the removal reasons pane start from this default too (7 days if no temporary
					duration is set).
				</span>
			</div>
			<div className={css.field}>
				<CheckboxInput
					label="Require a ban message"
					checked={requireBanMessage}
					onChange={(e,) => setRequireBanMessage(e.target.checked,)}
				/>
				<span className={css.fieldHint}>
					The mod button, usernote and native note ban forms won&apos;t send a ban with an empty message. Only
					checked when a ban is actually being issued.
				</span>
			</div>
			<div className={css.field}>
				<CheckboxInput
					label="Don't offer a ban with native notes"
					checked={disableNativeNoteBan}
					onChange={(e,) => setDisableNativeNoteBan(e.target.checked,)}
				/>
				<span className={css.fieldHint}>
					Hides the ban option the native note composer shows for the Ban and Permaban labels, for every mod;
					those labels then add a note only. Usernote types control their own Auto-ban.
				</span>
			</div>
			<div className={css.field}>
				<div className={css.fieldLabel}>Duration preset buttons</div>
				<div className={css.presetList}>
					{banDurationPresets.map((days, i,) => (
						// oxlint-disable-next-line react/no-array-index-key -- presets are bare numbers with no id; each row is a controlled input holding no local state, so position is enough
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
			<div className={css.field}>
				<div className={css.fieldLabel}>Named ban macros</div>
				<span className={css.fieldHint}>
					Offered as an &ldquo;Apply ban macro...&rdquo; picker in the mod button ban form, the removal
					reasons ban section, the usernote ban options, and the native note composer. Applying a macro
					replaces what is already in that form&apos;s fields rather than adding to them. Not every form uses
					every field: the removal reasons pane keeps the removal reason as the ban message and takes only the
					macro&apos;s note and duration. Toolbox NXG only - not visible to 6.x.
				</span>
				<SavedBanMacroList macros={savedBanMacros} onChange={setSavedBanMacros} />
			</div>
		</div>
	)
}
