/** Settings tab for configuring removal-reason templates, delivery defaults, and moderation enforcement. */

import {useMemo, useRef, useState,} from 'react'

import {utils,} from '../../../framework/moduleIds'
import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {EnforcementModeRadio,} from '../../../shared/controls/EnforcementModeRadio'
import {TextInput,} from '../../../shared/controls/NormalInput'
import {TextareaInput,} from '../../../shared/controls/TextareaInput'
import {TokenChips,} from '../../../shared/controls/TokenChips'
import {positiveTextFeedback,} from '../../../store/feedback'
import {formatRelativeTime,} from '../../../util/data/time'
import {type SaveRef, useFetched, useSaveRef, useSetting,} from '../../../util/ui/hooks'
import type {ConfigState, ToolboxConfig,} from '../../../util/wiki/schemas/config/schema'
import {
	pickSubstitutionTokens,
	type SubstitutionTokenInfo,
	substitutionTokens,
} from '../../../util/wiki/schemas/shared/tokens'
import {makeDeliveryOption,} from '../../shared/removalReasons/DeliveryOption'
import {getLastNativeSyncCheck, getLastNativeSyncFailure,} from '../features/syncNativeReasons'
import {stripNativeReasons,} from '../nativeSync'
import css from './RemovalSettingsTab.module.css'

/**
 * The restricted token set the removal-log post title supports, plus the
 * `{reason}` prompt token that's specific to log titles.
 */
const logTitleTokens: SubstitutionTokenInfo[] = [
	...pickSubstitutionTokens(['{kind}', '{author}', '{subreddit}', '{title}',],),
	{token: '{reason}', description: 'Prompts the sending mod for a freeform reason at send time',},
]

/** Single delivery-option row that highlights when selected. */
const DeliveryOption = makeDeliveryOption(css.radioOption, css.selected,)

/** Props for the RemovalSettingsTab component. */
interface Props {
	/** Config state object for the current subreddit. */
	state: ConfigState
	/** Optional ref wired up so the parent can trigger saving the settings. */
	saveRef?: SaveRef
	/** Called with the updated config and revision note when the user saves. */
	onSave: (config: ToolboxConfig, reason: string,) => void
}

/** Renders the removal-reasons settings panel within the toolbox subreddit config overlay. */
export function RemovalSettingsTab ({state, saveRef, onSave,}: Props,) {
	const rr = state.config.removalReasons ?? {}
	const advancedMode = !!useSetting(utils, 'advancedMode', false,)

	const [header, setHeader,] = useState(rr.header ?? '',)
	const [footer, setFooter,] = useState(rr.footer ?? '',)
	const [removalOption, setRemovalOption,] = useState(rr.removalOption ?? 'suggest',)
	const [typeReply, setTypeReply,] = useState<string>(rr.typeReply ?? 'reply',)
	const [typeStickied, setTypeStickied,] = useState(!!rr.typeStickied,)
	const [typeLockComment, setTypeLockComment,] = useState(!!rr.typeLockComment,)
	const [typeCommentAsSubreddit, setTypeCommentAsSubreddit,] = useState(!!rr.typeCommentAsSubreddit,)
	const [typeAsSub, setTypeAsSub,] = useState(!!rr.typeAsSub,)
	const [autoArchive, setAutoArchive,] = useState(!!rr.autoArchive,)
	const [typeLockThread, setTypeLockThread,] = useState(!!rr.typeLockThread,)
	const [getfrom, setGetfrom,] = useState(rr.getfrom ?? '',)
	const [logsub, setLogsub,] = useState(rr.logsub ?? '',)
	const [pmsubject, setPmsubject,] = useState(rr.pmsubject ?? '',)
	const [logtitle, setLogtitle,] = useState(rr.logtitle ?? '',)

	const [logreason, setLogreason,] = useState(rr.logreason ?? '',)
	const [nativeSyncEnabled, setNativeSyncEnabled,] = useState(rr.nativeSync?.enabled === true,)

	// Refs into the token-accepting fields, for inserting chips at the cursor.
	const pmsubjectRef = useRef<HTMLInputElement>(null,)
	const headerRef = useRef<HTMLTextAreaElement>(null,)
	const footerRef = useRef<HTMLTextAreaElement>(null,)
	const logtitleRef = useRef<HTMLInputElement>(null,)

	function handleSave () {
		if (!state.subreddit) { return }

		// Turning the sync off takes the imported reasons with it, and clears the whole
		// bookkeeping block rather than just the flag. That makes re-enabling a clean full
		// re-import, which is also the only way back for a reason that was deleted locally
		// and thereby added to `ignored`.
		let syncEnabled = nativeSyncEnabled
		let reasons = rr.reasons || []
		if (!syncEnabled && rr.nativeSync) {
			const stripped = stripNativeReasons(reasons,)
			const confirmed = stripped.removed < 1 || confirm(
				`Turning off syncing will remove ${stripped.removed} imported removal `
					+ `${stripped.removed === 1 ? 'reason' : 'reasons'} from toolbox, along with any flair and `
					+ 'usernote settings you added to them. They are left in place on Reddit. Are you sure?',
			)
			if (confirmed) {
				reasons = stripped.reasons
			} else {
				// Declining the removal means declining the switch-off; flipping the checkbox
				// back keeps what is on screen matching what is about to be written.
				syncEnabled = true
				setNativeSyncEnabled(true,)
			}
		}

		state.config.removalReasons = {
			...rr,
			header,
			footer,
			removalOption,
			typeReply,
			typeStickied,
			typeLockComment,
			typeCommentAsSubreddit,
			typeAsSub,
			autoArchive,
			typeLockThread,
			getfrom,
			logsub,
			pmsubject,
			logtitle,

			logreason,
			reasons,
			...(syncEnabled ? {nativeSync: {...rr.nativeSync, enabled: true,},} : {}),
		}
		// The `...rr` spread above carried the old block across even when the sync is off,
		// so drop it outright. Absent rather than `enabled: false` matches how the rest of
		// the config stores its booleans.
		if (!syncEnabled) { delete state.config.removalReasons.nativeSync }
		onSave(state.config, 'updated removal reason settings',)
		positiveTextFeedback('Removal reasons settings are saved',)
	}
	useSaveRef(saveRef, handleSave,)

	const subreddit = state.subreddit ?? ''

	// Phrased as "imported a change" rather than "synced", because the timestamp only moves
	// when a sync actually rewrote something. Checks happen far more often than that and
	// deliberately do not write, so a plain "last synced" date reads as a stalled sync when
	// it really means Reddit's reasons have been stable since then.
	const lastSyncedAt = rr.nativeSync?.lastSyncedAt
	const lastSyncedLabel = lastSyncedAt
		? `Last imported a change from Reddit on ${new Date(lastSyncedAt,).toLocaleString()}.`
		: 'Nothing imported from Reddit yet.'

	// The companion liveness signal: local to this browser, and only worth showing while the
	// sync is actually switched on, since nothing refreshes it once it is off.
	const syncPersistedOn = rr.nativeSync?.enabled === true
	const lastCheckedAt = useFetched(
		useMemo(() => syncPersistedOn ? getLastNativeSyncCheck(subreddit,) : Promise.resolve(undefined,), [
			subreddit,
			syncPersistedOn,
		],),
	)
	const lastCheckedLabel = lastCheckedAt === undefined
		? ''
		: ` Last checked ${formatRelativeTime(new Date(lastCheckedAt,),)}.`

	// Background runs stay quiet so a removal is never interrupted, which leaves the editor
	// as the only place a persistently broken sync can be reported.
	const lastFailure = useFetched(
		useMemo(() => syncPersistedOn ? getLastNativeSyncFailure(subreddit,) : Promise.resolve(undefined,), [
			subreddit,
			syncPersistedOn,
		],),
	)

	return (
		<div id="toolbox-removal-reason-settings">
			{/* Message template */}
			<div className={css.section}>
				<div className={css.sectionTitle}>Message template</div>
				<label className={css.fieldLabel} htmlFor="rr-pmsubject">Modmail subject</label>
				<TokenChips tokens={substitutionTokens} inputRef={pmsubjectRef} onChange={setPmsubject}>
					<TextInput
						id="rr-pmsubject"
						ref={pmsubjectRef}
						type="text"
						className={css.fullWidthInput}
						value={pmsubject}
						onChange={(e,) => setPmsubject(e.target.value,)}
					/>
				</TokenChips>
				<label className={css.fieldLabel} htmlFor="rr-header">Header</label>
				<TokenChips tokens={substitutionTokens} inputRef={headerRef} onChange={setHeader}>
					<TextareaInput
						id="rr-header"
						ref={headerRef}
						placeholder="Header text prepended to every removal message..."
						rows={Math.max(2, header.split('\n',).length,)}
						value={header}
						onChange={(e,) => setHeader(e.target.value,)}
					/>
				</TokenChips>
				<label className={css.fieldLabel} htmlFor="rr-footer">Footer</label>
				<TokenChips tokens={substitutionTokens} inputRef={footerRef} onChange={setFooter}>
					<TextareaInput
						id="rr-footer"
						ref={footerRef}
						placeholder="Footer text appended to every removal message..."
						rows={Math.max(2, footer.split('\n',).length,)}
						value={footer}
						onChange={(e,) => setFooter(e.target.value,)}
					/>
				</TokenChips>
				<p className={css.tokenHint}>
					Focus a field above to see the tokens it supports; hover a token for what it inserts.
				</p>
			</div>

			{/* Removal actions */}
			<div className={css.section}>
				<div className={css.sectionTitle}>Removal actions</div>
				<div className={css.radioGroup}>
					<DeliveryOption selected={typeReply === 'reply'}>
						<label className={css.radioLabel}>
							<input
								type="radio"
								name="type-reply"
								value="reply"
								checked={typeReply === 'reply'}
								onChange={() => setTypeReply('reply',)}
							/>
							Reply with a comment to the removed item
						</label>
						{typeReply === 'reply' && (
							<div className={css.subOptions}>
								<CheckboxInput
									label="Sticky the removal comment"
									checked={typeStickied}
									onChange={(e,) => setTypeStickied(e.target.checked,)}
								/>
								<CheckboxInput
									label="Lock the removal comment"
									checked={typeLockComment}
									onChange={(e,) => setTypeLockComment(e.target.checked,)}
								/>
								<CheckboxInput
									label={`Send as /u/${subreddit}-ModTeam`}
									checked={typeCommentAsSubreddit}
									onChange={(e,) => setTypeCommentAsSubreddit(e.target.checked,)}
								/>
							</div>
						)}
					</DeliveryOption>

					<DeliveryOption selected={typeReply === 'pm'}>
						<label className={css.radioLabel}>
							<input
								type="radio"
								name="type-reply"
								value="pm"
								checked={typeReply === 'pm'}
								onChange={() => setTypeReply('pm',)}
							/>
							Send as Modmail
						</label>
						{typeReply === 'pm' && (
							<div className={css.subOptions}>
								<CheckboxInput
									label="Send via modmail as subreddit"
									checked={typeAsSub}
									onChange={(e,) => setTypeAsSub(e.target.checked,)}
								/>
								{typeAsSub && (
									<p className={css.subNote}>Note: this will clutter up modmail.</p>
								)}
								<CheckboxInput
									label="Auto-archive sent Modmail"
									checked={autoArchive}
									onChange={(e,) => setAutoArchive(e.target.checked,)}
								/>
							</div>
						)}
					</DeliveryOption>

					<DeliveryOption selected={typeReply === 'both'}>
						<label className={css.radioLabel}>
							<input
								type="radio"
								name="type-reply"
								value="both"
								checked={typeReply === 'both'}
								onChange={() => setTypeReply('both',)}
							/>
							Both comment reply and Modmail
						</label>
						{typeReply === 'both' && (
							<div className={css.subOptions}>
								<div className={css.subGroupLabel}>Comment options</div>
								<CheckboxInput
									label="Sticky the removal comment"
									checked={typeStickied}
									onChange={(e,) => setTypeStickied(e.target.checked,)}
								/>
								<CheckboxInput
									label="Lock the removal comment"
									checked={typeLockComment}
									onChange={(e,) => setTypeLockComment(e.target.checked,)}
								/>
								<CheckboxInput
									label={`Send as /u/${subreddit}-ModTeam`}
									checked={typeCommentAsSubreddit}
									onChange={(e,) => setTypeCommentAsSubreddit(e.target.checked,)}
								/>
								<div className={css.subGroupLabel}>Modmail options</div>
								<CheckboxInput
									label="Send via modmail as subreddit"
									checked={typeAsSub}
									onChange={(e,) => setTypeAsSub(e.target.checked,)}
								/>
								{typeAsSub && (
									<p className={css.subNote}>Note: this will clutter up modmail.</p>
								)}
								<CheckboxInput
									label="Auto-archive sent Modmail"
									checked={autoArchive}
									onChange={(e,) => setAutoArchive(e.target.checked,)}
								/>
							</div>
						)}
					</DeliveryOption>

					{advancedMode && (
						<DeliveryOption selected={typeReply === 'none'}>
							<label className={css.radioLabel}>
								<input
									type="radio"
									name="type-reply"
									value="none"
									checked={typeReply === 'none'}
									onChange={() => setTypeReply('none',)}
								/>
								Log the removal without sending a message
							</label>
						</DeliveryOption>
					)}
				</div>
				<div className={css.actionsSeparator}>
					<CheckboxInput
						label="Lock the removed thread"
						checked={typeLockThread}
						onChange={(e,) => setTypeLockThread(e.target.checked,)}
					/>
				</div>
			</div>

			{/* Native removal reason sync */}
			<div className={css.section}>
				<div className={css.sectionTitle}>Reddit&apos;s removal reasons</div>
				<p className={css.sectionDesc}>
					Import this subreddit&apos;s native removal reasons (the ones set in Reddit&apos;s Mod Tools) and
					keep them up to date. Reddit owns each imported reason&apos;s title and message; flair, usernote
					defaults, and the post/comment settings stay here in toolbox.
				</p>
				<CheckboxInput
					label="Keep toolbox removal reasons in sync with Reddit's"
					checked={nativeSyncEnabled}
					onChange={(e,) => setNativeSyncEnabled(e.target.checked,)}
				/>
				<span className={css.fieldHint}>
					Turning this off removes the imported reasons from toolbox again; they are left in place on Reddit.
					Imported reasons are not written to the legacy toolbox 6.x page, so moderators still on 6.x will not
					see them. {lastSyncedLabel}
					{lastCheckedLabel}
				</span>
				{lastFailure && (
					<p className={css.syncFailure}>
						{lastFailure.stage === 'fetch'
							? 'Could not read Reddit\'s removal reasons'
							: 'Could not save the reasons imported from Reddit'}{' '}
						{formatRelativeTime(new Date(lastFailure.at,),)}: {lastFailure.message}.{' '}
						{lastFailure.stage === 'save'
							? 'Toolbox has stopped retrying for now; if this is a permissions problem, ask for the "wiki" moderator permission.'
							: 'Toolbox will try again shortly.'} Press <strong>Sync from Reddit</strong> on the{' '}
						<em>Edit removal reasons</em> tab to retry immediately.
					</p>
				)}
			</div>

			{/* Moderator enforcement */}
			<div className={css.section}>
				<div className={css.sectionTitle}>Moderator enforcement</div>
				<p className={css.sectionDesc}>
					How do the removal actions above apply to other moderators in this subreddit?
				</p>
				<EnforcementModeRadio
					name="removal-option"
					options={[
						{val: 'suggest', label: 'Suggest these settings (moderators can override)',},
						{val: 'force', label: 'Require moderators to use these settings',},
						{val: 'leave', label: 'Leave up to each moderator\'s personal settings',},
					]}
					value={removalOption}
					onChange={setRemovalOption}
				/>
			</div>

			{/* Advanced settings - only visible when global advanced mode is on */}
			{advancedMode && (
				<div className={css.section}>
					<div className={css.sectionTitle}>Advanced settings</div>
					<div className={css.advancedField}>
						<label className={css.advancedFieldLabel} htmlFor="rr-getfrom">
							Get reasons from /r/:
						</label>
						<TextInput
							id="rr-getfrom"
							type="text"
							value={getfrom}
							onChange={(e,) => setGetfrom(e.target.value,)}
						/>
						<span className={css.warning}>WARNING: overrides all other settings.</span>
					</div>
					<div className={css.advancedField}>
						<label className={css.advancedFieldLabel} htmlFor="rr-logsub">
							Removal log subreddit /r/:
						</label>
						<TextInput
							id="rr-logsub"
							type="text"
							value={logsub}
							onChange={(e,) => setLogsub(e.target.value,)}
						/>
						<span className={css.fieldHint}>
							When set, each removal posts a new thread to this subreddit as a log entry.
						</span>
					</div>
					<div className={css.advancedField}>
						<label className={css.advancedFieldLabel} htmlFor="rr-logtitle">
							Log post title:
						</label>
						<TokenChips tokens={logTitleTokens} inputRef={logtitleRef} onChange={setLogtitle}>
							<TextInput
								id="rr-logtitle"
								ref={logtitleRef}
								type="text"
								value={logtitle}
								onChange={(e,) => setLogtitle(e.target.value,)}
							/>
						</TokenChips>
						<span className={css.fieldHint}>
							Title for the log post. Add {'{reason}'} to prompt mods for a freeform reason at send time.
						</span>
					</div>
					<div className={css.advancedField}>
						<label className={css.advancedFieldLabel} htmlFor="rr-logreason">
							Default log reason:
						</label>
						<TextInput
							id="rr-logreason"
							type="text"
							value={logreason}
							onChange={(e,) => setLogreason(e.target.value,)}
						/>
						<span className={css.fieldHint}>
							Pre-filled value for the {'{reason}'} prompt. Only used if the log post title contains{' '}
							{'{reason}'}.
						</span>
					</div>
				</div>
			)}
		</div>
	)
}
