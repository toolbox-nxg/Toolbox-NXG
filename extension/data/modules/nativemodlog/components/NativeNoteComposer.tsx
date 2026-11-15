/** Composer for adding a native Reddit mod note, with an optional ban for the Ban / Permaban labels. */

import {useEffect, useRef, useState,} from 'react'

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
	const defaultBanDays = banDefaults?.days ?? 7
	const defaultBanMessage = banDefaults?.message ?? ''
	const inputRef = useRef<HTMLInputElement>(null,)
	const [noteText, setNoteText,] = useState('',)
	const [selectedLabel, setSelectedLabel,] = useState<string | undefined>(defaultLabel,)
	const [saving, setSaving,] = useState(false,)
	const [error, setError,] = useState<string | undefined>()
	const [triggerBan, setTriggerBan,] = useState(banWithBanLabel,)
	const [banDays, setBanDays,] = useState(defaultBanDays,)
	const [banMessage, setBanMessage,] = useState(defaultBanMessage,)

	// Using autoFocus would make the page jump; focus manually without scrolling instead.
	useEffect(() => {
		inputRef.current?.focus({preventScroll: true,},)
	}, [],)

	// Switching label resets the ban options to the subreddit's defaults (which may also arrive after
	// mount) so a stale choice never carries over. Adjusted during render rather than in an effect,
	// so the stale options never render under the new label.
	const banDefaultsKey = {selectedLabel, banWithBanLabel, defaultBanDays, defaultBanMessage,}
	const [banOptionsFor, setBanOptionsFor,] = useState(banDefaultsKey,)
	if (
		banOptionsFor.selectedLabel !== selectedLabel || banOptionsFor.banWithBanLabel !== banWithBanLabel
		|| banOptionsFor.defaultBanDays !== defaultBanDays || banOptionsFor.defaultBanMessage !== defaultBanMessage
	) {
		setBanOptionsFor(banDefaultsKey,)
		setTriggerBan(banWithBanLabel,)
		setBanDays(defaultBanDays,)
		setBanMessage(defaultBanMessage,)
	}

	// Whether the chosen label offers a ban at all; the subreddit can turn this off for every mod.
	const offersBan = isBanLabel(selectedLabel,) && !banDisabled
	const showBanFields = offersBan && triggerBan && !targetIsMod

	async function handleSave () {
		const text = noteText.trim()
		if (!text) {
			setError('Note text is required',)
			return
		}
		const banning = offersBan && triggerBan && !targetIsMod
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
							setBanDays(resolved.days,)
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
									max={999}
									value={banDays}
									disabled={saving || !triggerBan}
									onChange={(event,) => {
										const days = parseInt(event.target.value, 10,)
										if (!isNaN(days,) && days >= 1 && days <= 999) { setBanDays(days,) }
									}}
								/>
								<span>days</span>
							</>
						)}
					</label>
				)}
				{error && <span className={css.error}>{error}</span>}
				<ActionButton type="button" primary disabled={saving} onClick={() => void handleSave()}>
					{saving ? 'Saving...' : `Save for /r/${subreddit}`}
				</ActionButton>
			</div>
		</section>
	)
}
