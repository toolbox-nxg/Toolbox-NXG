/** Landing tab for the subreddit config overlay, providing navigation links and the advanced-mode toggle. */
import {utils,} from '../../../framework/moduleIds'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {CheckboxInput,} from '../../../shared/controls/CheckboxInput'
import {setSettingAsync,} from '../../../util/persistence/settings'
import {link,} from '../../../util/reddit/pageContext'
import {useSetting,} from '../../../util/ui/hooks'
import css from './SettingsHomeTab.module.css'

/** Props for the SettingsHomeTab component. */
interface Props {
	/** The subreddit whose config is being edited. */
	subreddit: string
	/** When true, hides the "Manage usernotes" link (usernotes manager is disabled). */
	unManager: boolean
	/** Current value of the subreddit's `showRetiredUsernoteShards` config field. */
	showRetiredShards: boolean
	/** Persists a new retired-shard visibility choice and refreshes the shard tabs. */
	onToggleRetiredShards: (checked: boolean,) => void
}

/**
 * Renders the home tab of the subreddit config overlay with subreddit-scoped wiki links
 * and a toggle to enable advanced settings.
 */
export function SettingsHomeTab ({subreddit, unManager, showRetiredShards, onToggleRetiredShards,}: Props,) {
	const advancedMode = useSetting(utils, 'advancedMode', false,)

	return (
		<div className={css.root}>
			<div className={css.intro}>
				<p className={css.introText}>
					Through this window you can edit the settings for /r/{subreddit}. Settings you change here will
					apply to the entire subreddit and by extension other moderators.
				</p>
				<div className={css.introActions}>
					<ActionButton
						type="button"
						onClick={() => window.open(link(`/r/${subreddit}/wiki/pages/`,), '_blank',)}
					>
						View all /r/{subreddit} wiki pages
					</ActionButton>
					{!unManager && (
						<ActionButton
							type="button"
							onClick={() => window.open(link(`/r/${subreddit}/about/usernotes/`,), '_blank',)}
						>
							Manage usernotes
						</ActionButton>
					)}
				</div>
			</div>
			<div className={css.advancedSection}>
				<CheckboxInput
					label="Show advanced settings"
					checked={!!advancedMode}
					onChange={(e,) => {
						void setSettingAsync(utils, 'advancedMode', e.target.checked,)
					}}
				/>
				<p className={css.advancedHint}>
					Enables advanced tabs (edit raw config, edit usernotes) and advanced options within settings tabs.
				</p>
				{advancedMode && (
					<>
						<CheckboxInput
							label="Show retired usernote shard pages"
							checked={showRetiredShards}
							onChange={(e,) => onToggleRetiredShards(e.target.checked,)}
						/>
						<p className={css.advancedHint}>
							Adds raw-editor tabs for retired (tombstoned) usernote shard pages left behind by shard
							splits. Applies to /r/{subreddit} for all of its moderators.
						</p>
					</>
				)}
			</div>
		</div>
	)
}
