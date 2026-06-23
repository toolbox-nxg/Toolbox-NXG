/** Settings tab for configuring what a usernote must contain before it can be saved. */

import {useState,} from 'react'

import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {type EnforcementModeOption, EnforcementModeRadio,} from '../../../shared/controls/EnforcementModeRadio'
import {positiveTextFeedback,} from '../../../store/feedback'
import {type SaveRef, useSaveRef,} from '../../../util/ui/hooks'
import type {ConfigState, ToolboxConfig,} from '../../../util/wiki/schemas/config/schema'
import css from './UsernotesSettingsTab.module.css'

/** Props for the UsernotesSettingsTab component. */
interface Props {
	/** Config state object for the current subreddit. */
	state: ConfigState
	/** Optional ref wired up so the parent can trigger saving the settings. */
	saveRef?: SaveRef
	/** Called with the updated config and revision note when the user saves. */
	onSave: (config: ToolboxConfig, reason: string,) => void
}

/** The enforcement-mode choices for how the requirement flags apply to moderators. */
const requirementModes: readonly EnforcementModeOption[] = [
	{val: 'suggest', label: 'Suggest these requirements (moderators may add stricter)',},
	{val: 'force', label: 'Require these for all moderators',},
	{val: 'leave', label: 'Leave up to each moderator\'s personal settings',},
]

/** Renders the usernotes save-requirement settings panel within the subreddit config overlay. */
export function UsernotesSettingsTab ({state, saveRef, onSave,}: Props,) {
	const config = state.config ?? {}

	// Seed from the loaded config honoring the per-field defaults: type/link
	// default off, text defaults on (only an explicit false disables it).
	const [requireType, setRequireType,] = useState(config.requireUsernoteType === true,)
	const [requireText, setRequireText,] = useState(config.requireUsernoteText !== false,)
	const [requireLink, setRequireLink,] = useState(config.requireUsernoteLink === true,)
	// Default to 'leave' when unset: that is how the resolver actually treats an
	// absent mode, so the picker reflects the live state and a no-op save can't
	// silently flip the subreddit into enforcing a floor on every moderator.
	const [requirementOption, setRequirementOption,] = useState<string>(
		config.usernoteRequirementOption ?? 'leave',
	)

	function handleSave () {
		if (!state.subreddit) { return }
		state.config.requireUsernoteType = requireType
		state.config.requireUsernoteText = requireText
		state.config.requireUsernoteLink = requireLink
		state.config.usernoteRequirementOption = requirementOption
		onSave(state.config, 'updated usernotes settings',)
		positiveTextFeedback('Usernotes settings are saved',)
	}
	useSaveRef(saveRef, handleSave,)

	return (
		<div id="toolbox-usernotes-settings">
			{/* Save requirements */}
			<div className={css.section}>
				<div className={css.sectionTitle}>Save requirements</div>
				<p className={css.sectionDesc}>
					Choose what a usernote must contain before it can be saved in this subreddit.
				</p>
				<div className={css.checkboxGroup}>
					<CheckboxInput
						label="Require a note type"
						checked={requireType}
						onChange={(e,) => setRequireType(e.target.checked,)}
					/>
					<CheckboxInput
						label="Require note text"
						checked={requireText}
						onChange={(e,) => setRequireText(e.target.checked,)}
					/>
					<CheckboxInput
						label="Require a link to the content"
						checked={requireLink}
						onChange={(e,) => setRequireLink(e.target.checked,)}
					/>
				</div>
			</div>

			{/* Moderator enforcement */}
			<div className={css.section}>
				<div className={css.sectionTitle}>Moderator enforcement</div>
				<p className={css.sectionDesc}>
					How do the requirements above apply to other moderators? The more restrictive of this
					subreddit&apos;s requirements and a moderator&apos;s personal settings always wins.
				</p>
				<EnforcementModeRadio
					name="usernote-requirement-option"
					options={requirementModes}
					value={requirementOption}
					onChange={setRequirementOption}
				/>
			</div>
		</div>
	)
}
