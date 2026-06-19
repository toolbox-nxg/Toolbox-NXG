/** Toolbar with moderator filter and display-option toggles for the Mod Log Matrix. */

import css from '../modmatrix.module.css'
import type {MatrixState,} from '../schema'
import {ModeratorFilter,} from './ModeratorFilter'
import {Toggle,} from './Toggle'

/** Subset of display options that can be changed via the toolbar. */
interface DisplayOpts {
	showPercentages?: boolean
	/** Percentage threshold below which a moderator row is highlighted. */
	highlightThreshold?: number
	hideZeroColumns?: boolean
	hideZeroMods?: boolean
	showSparklines?: boolean
}

/** Props for the {@link ControlsToolbar} component. */
interface Props {
	state: MatrixState
	/** Called when the user changes the moderator visibility filter. */
	onSetModFilter: (filter: string[] | null,) => void
	/** Called when any display toggle or threshold input changes. */
	onSetDisplayOptions: (options: DisplayOpts,) => void
}

/** Renders the matrix toolbar containing the moderator filter dropdown and display-option toggles. */
export function ControlsToolbar ({state, onSetModFilter, onSetDisplayOptions,}: Props,) {
	const {
		showPercentages,
		highlightThreshold,
		hideZeroColumns,
		hideZeroMods,
		showSparklines,
		modFilter,
		subredditModerators,
	} = state

	const moderators = Object.keys(subredditModerators,)

	return (
		<div className={css.toolbar}>
			<div className={css.toolbarGroup}>
				<ModeratorFilter
					moderators={moderators}
					modFilter={modFilter}
					onChange={onSetModFilter}
				/>
			</div>
			<div className={css.toolbarDivider} />
			<div className={css.toolbarGroup}>
				<Toggle
					id="mm-pct"
					checked={showPercentages}
					onChange={(v,) => onSetDisplayOptions({showPercentages: v,},)}
					label="Show Total Percentages"
				/>
				<Toggle
					id="mm-sparklines"
					checked={showSparklines}
					onChange={(v,) => onSetDisplayOptions({showSparklines: v,},)}
					label="Sparkline"
				/>
			</div>
			<div className={css.toolbarDivider} />
			<div className={css.toolbarGroup}>
				<Toggle
					id="mm-hidezerocols"
					checked={hideZeroColumns}
					onChange={(v,) => onSetDisplayOptions({hideZeroColumns: v,},)}
					label="Hide Empty Columns"
				/>
				<Toggle
					id="mm-hidezeromods"
					checked={hideZeroMods}
					onChange={(v,) => onSetDisplayOptions({hideZeroMods: v,},)}
					label="Hide Inactive Moderators"
				/>
				{showPercentages && (
					<>
						<div className={css.toolbarDivider} />
						<span className={css.toolbarLabel}>Highlight below</span>
						<input
							type="number"
							className={css.thresholdInput}
							value={highlightThreshold}
							min={0}
							max={100}
							onChange={(e,) =>
								onSetDisplayOptions({
									highlightThreshold: Math.max(0, Math.min(100, Number(e.target.value,),),),
								},)}
						/>
						<span className={css.toolbarLabel}>%</span>
					</>
				)}
			</div>
		</div>
	)
}
