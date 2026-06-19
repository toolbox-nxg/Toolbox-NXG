/** Draggable popup for editing or clearing the color tag associated with a domain in a subreddit. */
import {useState,} from 'react'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {Window,} from '../../../shared/window/Window'
import type {DomainTag,} from '../schema'
import css from './DomainTaggerPopup.module.css'

/**
 * Renders a draggable window for editing or clearing a domain color tag within a subreddit.
 * @param props Component properties.
 * @param subreddit The subreddit whose config will be updated.
 * @param initialDomain The domain name pre-filled in the text input.
 * @param initialColor The hex color pre-selected in the color picker.
 * @param initialNote Optional existing note text for this tag.
 * @param initialThreshold Optional removal-rate alert threshold (0-100).
 * @param approvalCount Read-only cumulative approval count for this domain.
 * @param removalCount Read-only cumulative removal count for this domain.
 * @param initialPosition Where the popup should appear on screen.
 * @param onSave Called with the new {@link DomainTag} when the user saves, or with `color: 'none'` to clear.
 * @param onClose Called when the window is dismissed.
 */
export const DomainTaggerPopup = ({
	subreddit,
	initialDomain,
	initialColor,
	initialNote,
	initialThreshold,
	approvalCount,
	removalCount,
	initialPosition,
	onSave,
	onClose,
}: {
	subreddit: string
	initialDomain: string
	initialColor: string
	initialNote?: string
	initialThreshold?: number
	approvalCount: number
	removalCount: number
	initialPosition: {top: number; left: number}
	onSave: (tag: DomainTag,) => void
	onClose: () => void
},) => {
	const [name, setName,] = useState(initialDomain,)
	const [color, setColor,] = useState(initialColor,)
	const [note, setNote,] = useState(initialNote ?? '',)
	const [threshold, setThreshold,] = useState(
		initialThreshold !== undefined ? String(initialThreshold,) : '',
	)

	/** Builds a {@link DomainTag} from the current field values. */
	function buildTag (overrideColor?: string,): DomainTag {
		const parsedThreshold = threshold !== '' ? parseInt(threshold, 10,) : undefined
		const tag: DomainTag = {
			name,
			color: overrideColor ?? color,
			approvalCount,
			removalCount,
		}
		if (note) { tag.note = note }
		if (parsedThreshold !== undefined && !isNaN(parsedThreshold,)) { tag.removalThreshold = parsedThreshold }
		return tag
	}

	const hasStats = approvalCount > 0 || removalCount > 0

	return (
		<Window
			title={`Domain Tagger - /r/${subreddit}`}
			draggable
			initialPosition={initialPosition}
			onClose={onClose}
			footer={
				<>
					<ActionButton type="button" onClick={() => onSave(buildTag(),)}>save</ActionButton>
					<ActionButton type="button" onClick={() => onSave(buildTag('none',),)}>clear</ActionButton>
				</>
			}
		>
			<div className={css.row}>
				<input
					type="text"
					value={name}
					onChange={(event,) => setName(event.target.value,)}
				/>
				<input
					type="color"
					value={color}
					onChange={(event,) => setColor(event.target.value,)}
				/>
			</div>
			<div className={css.row}>
				<label className={css.fieldLabel} htmlFor="dt-popup-note">Note</label>
				<textarea
					id="dt-popup-note"
					className={css.noteField}
					placeholder="Optional note shown as tooltip..."
					value={note}
					onChange={(e,) => setNote(e.target.value,)}
					rows={2}
				/>
			</div>
			<div className={css.row}>
				<label className={css.fieldLabel} htmlFor="dt-popup-threshold">
					Removal-rate alert (%)
				</label>
				<input
					id="dt-popup-threshold"
					type="number"
					className={css.thresholdField}
					placeholder="e.g. 80"
					min={0}
					max={100}
					value={threshold}
					onChange={(e,) => setThreshold(e.target.value,)}
				/>
			</div>
			{hasStats && (
				<p className={css.stats}>
					▲{approvalCount} approved&nbsp; ▼{removalCount} removed
				</p>
			)}
			<p className={css.note}>Ex: i.imgur.com is not imgur.com</p>
			<p className={css.note}>Glob patterns supported (e.g. *.blogspot.com)</p>
		</Window>
	)
}
