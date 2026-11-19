/** Composer for adding a native Reddit mod note, with an optional ban for the Ban / Permaban labels. */

import {useEffect, useMemo, useRef, useState,} from 'react'

import {createModNote,} from '../../../api/resources/modnotes'
import {nativeModLog,} from '../../../framework/moduleIds'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {positiveTextFeedback,} from '../../../store/feedback'
import createLogger from '../../../util/infra/logging'
import {useSetting,} from '../../../util/ui/hooks'
import {BanMacroSelect,} from '../../shared/banMacros/components/BanMacroSelect'
import {BanTokenWarning,} from '../../shared/banMacros/components/BanTokenWarning'
import {resolveBanMacro, type ResolvedBanDefaults, type SavedBanMacro,} from '../../shared/banMacros/schema'
import {labelColors, maxNativeNoteLength, selectableLabelNames,} from '../../shared/modnotes/schema'
import {proposeOrBan,} from '../../shared/proposals/gateway'
import {
	banDaysFromNote,
	compileBanDurationPattern,
	isValidBanDays,
	maxBanDays,
	type NoteBanDays,
	writeBanDaysToNote,
} from '../schema'
import css from './NativeNoteComposer.module.css'

const log = createLogger('NativeModLog',)

/** Props for the NativeNoteComposer component. */
export interface NativeNoteComposerProps {
	subreddit: string
	user: string
	/** Fullname of the post or comment the note is about, if the composer was opened from one. */
	contextID?: string | undefined
	/** API label to preselect (e.g. `'BAN'`), or undefined for no label. */
	defaultLabel?: string | undefined
	/** When true, the ban options are suppressed since mods cannot be banned. */
	targetIsMod?: boolean | undefined
	/** The subreddit's named ban macros, offered as a picker when a ban is issued with the note. */
	savedBanMacros?: SavedBanMacro[]
	/**
	 * Token values for ban messages (see `banTokenInfo`): the user, subreddit and acting mod, plus
	 * the post or comment the composer was opened from when there is one.
	 */
	banTokenInfo?: Record<string, string>
	/** The subreddit's ban defaults (Config > Ban settings), resolved; the ban fields start from these. */
	banDefaults?: ResolvedBanDefaults | undefined
	/** Whether this subreddit requires a message on every ban (only checked when banning). */
	requireBanMessage?: boolean
	/** When true, the subreddit has turned off banning from native notes: Ban and Permaban add a note only. */
	banDisabled?: boolean
	/** Called after the note (and any ban) has been saved. */
	onSaved: () => void
}

/** True for the labels that offer to ban the user alongside the note. */
function isBanLabel (label: string | undefined,): label is 'BAN' | 'PERMA_BAN' {
	return label === 'BAN' || label === 'PERMA_BAN'
}

const noNoteDays: NoteBanDays = {kind: 'none',}

/** Renders the label chips, note input, and ban controls for a new native mod note. */
export function NativeNoteComposer ({
	subreddit,
	user,
	contextID,
	defaultLabel,
	targetIsMod = false,
	savedBanMacros = [],
	banTokenInfo = {author: user, subreddit,},
	banDefaults,
	requireBanMessage = false,
	banDisabled = false,
	onSaved,
}: NativeNoteComposerProps,) {
	// Whether choosing Ban / Permaban turns the ban option on (a personal setting, on by default).
	const banWithBanLabel = !!useSetting(nativeModLog, 'banWithBanLabel', true,)
	const banNoteDuration = useSetting(nativeModLog, 'banNoteDuration', '',)
	const durationPattern = useMemo(() => compileBanDurationPattern(banNoteDuration,), [banNoteDuration,],)
	const defaultBanDays = banDefaults?.days ?? 7
	const defaultBanMessage = banDefaults?.message ?? ''
	const inputRef = useRef<HTMLInputElement>(null,)
	const [noteText, setNoteText,] = useState('',)
	const [selectedLabel, setSelectedLabel,] = useState<string | undefined>(defaultLabel,)
	const [saving, setSaving,] = useState(false,)
	const [error, setError,] = useState<string | undefined>()
	const [triggerBan, setTriggerBan,] = useState(banWithBanLabel,)
	// Days the mod picked by typing them or applying a macro, used when the note gives no length
	// (a note that does is rewritten to match them); while unset, the subreddit's default is used.
	const [chosenBanDays, setChosenBanDays,] = useState<number | undefined>()
	// The over-the-limit length in the note that the mod agreed to ban for the most Reddit allows.
	// Kept as the note's number, not a flag, so any change to that number asks again: a typo like
	// "1000d" for "100d" must never become a 999-day ban unseen.
	const [cappedNoteDays, setCappedNoteDays,] = useState<number | undefined>()
	const [banMessage, setBanMessage,] = useState(defaultBanMessage,)

	// Using autoFocus would make the page jump; focus manually without scrolling instead.
	useEffect(() => {
		inputRef.current?.focus({preventScroll: true,},)
	}, [],)

	// Switching label resets the ban options to the subreddit's defaults so a stale choice never
	// carries over.
	useEffect(() => {
		setTriggerBan(banWithBanLabel,)
		setChosenBanDays(undefined,)
		setCappedNoteDays(undefined,)
		setBanMessage(defaultBanMessage,)
	}, [selectedLabel, banWithBanLabel, defaultBanMessage,],)

	// Whether the chosen label offers a ban at all; the subreddit can turn this off for every mod.
	const offersBan = isBanLabel(selectedLabel,) && !banDisabled
	const showBanFields = offersBan && triggerBan && !targetIsMod
	// Only a timed ban has a day count to fill in.
	const banTakesDays = showBanFields && selectedLabel === 'BAN'
	const readsNote = banTakesDays && durationPattern instanceof RegExp
	const noteDays = useMemo(
		() => readsNote && durationPattern instanceof RegExp ? banDaysFromNote(noteText, durationPattern,) : noNoteDays,
		[readsNote, durationPattern, noteText,],
	)
	// Whether the mod agreed to ban for the most Reddit allows, for the length the note says now.
	const capConfirmed = noteDays.kind === 'overMax' && cappedNoteDays === noteDays.days
	// A length in the note always sets the days: changing the days rewrites the note (see
	// chooseBanDays), so the note and the ban never disagree. The one exception is a note longer
	// than Reddit allows, which the mod has confirmed: the ban is then the longest allowed, never
	// longer than the note says.
	const banDays = noteDays.kind === 'days'
		? noteDays.days
		: capConfirmed
		? maxBanDays
		: chosenBanDays ?? defaultBanDays
	// The note's length cannot be used as it is: it is not a ban length, or it is longer than
	// Reddit allows and the mod has not confirmed the shorter ban.
	const noteDaysInvalid = noteDays.kind === 'invalid' || noteDays.kind === 'overMax' && !capConfirmed

	/** Sets the days the mod picked, and rewrites the length in the note to match when it has one. */
	function chooseBanDays (days: number,) {
		setChosenBanDays(days,)
		if (!readsNote || !(durationPattern instanceof RegExp)) { return }
		const rewritten = writeBanDaysToNote(noteText, durationPattern, days, maxNativeNoteLength,)
		if (rewritten !== undefined) { setNoteText(rewritten,) }
	}

	async function handleSave () {
		const text = noteText.trim()
		if (!text) {
			setError('Note text is required',)
			return
		}
		const banning = showBanFields
		if (noteDaysInvalid) {
			setError(
				noteDays.kind === 'overMax'
					? `Reddit bans for at most ${maxBanDays} days: confirm that, or change the length in the note`
					: `The ban length in the note must be a whole number of days from 1 to ${maxBanDays}`,
			)
			return
		}
		if (banning && requireBanMessage && !banMessage.trim()) {
			setError(`/r/${subreddit} requires a ban message`,)
			return
		}
		setError(undefined,)
		setSaving(true,)
		try {
			await createModNote({
				user,
				subreddit,
				redditID: contextID,
				note: text,
				label: selectedLabel,
			},)
			// The ban toggle reads unchecked for a mod but its state stays on, so check
			// targetIsMod here too - mods can't be banned.
			if (banning) {
				await proposeOrBan(
					{subreddit, itemId: user, itemKind: 'user', link: `https://www.reddit.com/user/${user}`,},
					{
						permanent: selectedLabel === 'PERMA_BAN',
						days: banDays,
						note: text,
						message: banMessage,
						// Ties the ban to the item the note is attached to, so Reddit links it
						// in the ban message the way a ban from the Mod Button does.
						...(contextID ? {context: contextID,} : {}),
					},
				)
			}
			positiveTextFeedback('Note saved',)
			setNoteText('',)
			onSaved()
		} catch (saveError) {
			log.error('Failed to create native note:', saveError,)
			setError('Failed to save note',)
		} finally {
			setSaving(false,)
		}
	}

	return (
		<section className={css.composerPane} aria-label="Create native note">
			<div className={css.composerHeader}>
				<span>Add native note</span>
			</div>
			<div className={css.typeList}>
				{Object.entries(selectableLabelNames,).map(([key, name,],) => (
					<button
						type="button"
						key={key}
						className={`${css.typeButton} ${selectedLabel === key ? css.selectedType : ''}`}
						style={{color: labelColors[key],}}
						aria-pressed={selectedLabel === key}
						onClick={() => setSelectedLabel((prev,) => prev === key ? undefined : key)}
						disabled={saving}
					>
						{name}
					</button>
				))}
			</div>
			<input
				ref={inputRef}
				type="text"
				className={`${css.noteInput} toolbox-input`}
				placeholder="Add a note..."
				maxLength={maxNativeNoteLength}
				value={noteText}
				disabled={saving}
				onChange={(event,) => {
					setNoteText(event.target.value,)
					if (error) { setError(undefined,) }
				}}
				onKeyDown={(event,) => {
					if (event.key === 'Enter') {
						event.preventDefault()
						void handleSave()
					}
				}}
			/>
			{showBanFields && (
				<BanMacroSelect
					macros={savedBanMacros}
					disabled={saving}
					onApply={(macro,) => {
						const resolved = resolveBanMacro(macro, banTokenInfo,)
						setBanMessage(resolved.message,)
						// A PERMA_BAN label is always permanent; only BAN takes a day count.
						if (selectedLabel === 'BAN' && !resolved.permanent) {
							chooseBanDays(resolved.days,)
						}
					}}
				/>
			)}
			{showBanFields && (
				<textarea
					className={`${css.banMessageInput} toolbox-input`}
					placeholder="ban note to user"
					rows={2}
					value={banMessage}
					disabled={saving}
					onChange={(event,) => setBanMessage(event.target.value,)}
				/>
			)}
			{showBanFields && <BanTokenWarning text={banMessage} />}
			<div className={css.composerFooter}>
				<div className={css.banGroup}>
					{offersBan && selectedLabel === 'PERMA_BAN' && (
						<label className={css.banRow}>
							<input
								type="checkbox"
								className={css.toggle}
								checked={triggerBan && !targetIsMod}
								disabled={saving || targetIsMod}
								onChange={(event,) => setTriggerBan(event.target.checked,)}
							/>
							<span>Issue Permanent Ban{targetIsMod ? ' (user is a mod)' : ''}</span>
						</label>
					)}
					{offersBan && selectedLabel === 'BAN' && (
						<label className={css.banRow}>
							<input
								type="checkbox"
								className={css.toggle}
								checked={triggerBan && !targetIsMod}
								disabled={saving || targetIsMod}
								onChange={(event,) => setTriggerBan(event.target.checked,)}
							/>
							<span>Issue Ban{targetIsMod ? ' (user is a mod)' : ' for'}</span>
							{!targetIsMod && (
								<>
									<input
										type="number"
										className={`${css.banDaysInput} toolbox-input`}
										min={1}
										max={maxBanDays}
										// An unusable length from the note is shown as written, so the mod
										// sees what the pattern matched.
										value={noteDays.kind === 'invalid'
											? noteDays.text
											: noteDays.kind === 'overMax' && !capConfirmed
											? noteDays.days
											: banDays}
										aria-invalid={noteDaysInvalid}
										disabled={saving || !triggerBan}
										onChange={(event,) => {
											const days = parseInt(event.target.value, 10,)
											if (isValidBanDays(days,)) { chooseBanDays(days,) }
										}}
									/>
									<span>days</span>
								</>
							)}
						</label>
					)}
					{
						// Outside the "Issue Ban" label: a click on the hint's confirm button inside it
						// would also toggle the ban checkbox.
						banTakesDays && (
							<BanDaysHint
								noteDays={noteDays}
								patternInvalid={durationPattern === 'invalid'}
								capConfirmed={capConfirmed}
								disabled={saving}
								onConfirmCap={(days,) => {
									setCappedNoteDays(days,)
									if (error) { setError(undefined,) }
								}}
								// The note was read and gave no length, so the default is in use.
								fellBackToDefault={readsNote
									&& chosenBanDays === undefined
									&& noteText.trim() !== ''}
							/>
						)
					}
				</div>
				{error && <span className={css.error}>{error}</span>}
				<ActionButton
					type="button"
					primary
					disabled={saving || noteDaysInvalid}
					onClick={() => void handleSave()}
				>
					{saving ? 'Saving...' : `Save for /r/${subreddit}`}
				</ActionButton>
			</div>
		</section>
	)
}

/** Props for BanDaysHint. */
interface BanDaysHintProps {
	noteDays: NoteBanDays
	/** True when the mod's ban duration pattern does not compile. */
	patternInvalid: boolean
	/** True when the note is longer than Reddit allows and the mod has confirmed the longest ban. */
	capConfirmed: boolean
	/** Disables the confirm button while the note saves. */
	disabled: boolean
	/** Called with the note's length when the mod confirms banning for the longest Reddit allows. */
	onConfirmCap: (noteDays: number,) => void
	/**
	 * True when the pattern was applied to a typed note but the mod's days are not set, so a
	 * `none` result means the subreddit default is used.
	 */
	fellBackToDefault: boolean
}

/**
 * Says where the ban length came from, so a length read from the note - or a note the pattern
 * missed, which would otherwise ban for the default while the note says something else - is
 * checked before saving.
 */
function BanDaysHint ({
	noteDays,
	patternInvalid,
	capConfirmed,
	disabled,
	onConfirmCap,
	fellBackToDefault,
}: BanDaysHintProps,) {
	if (patternInvalid) {
		return <span className={css.error}>(duration pattern is invalid)</span>
	}
	if (noteDays.kind === 'overMax') {
		if (capConfirmed) {
			return (
				<span className={css.banDaysHint}>
					(note says {noteDays.days}; {maxBanDays} is the most Reddit allows)
				</span>
			)
		}
		return (
			<>
				<span className={css.error}>(note says {noteDays.days}; Reddit allows at most {maxBanDays})</span>
				<ActionButton type="button" disabled={disabled} onClick={() => onConfirmCap(noteDays.days,)}>
					Ban for {maxBanDays} days
				</ActionButton>
			</>
		)
	}
	if (noteDays.kind === 'invalid') {
		return <span className={css.error}>(must be a whole number of days from 1 to {maxBanDays})</span>
	}
	if (noteDays.kind === 'days') {
		return <span className={css.banDaysHint}>(from note)</span>
	}
	if (fellBackToDefault) {
		return <span className={css.banDaysHint}>(default, not from note)</span>
	}
	return null
}
