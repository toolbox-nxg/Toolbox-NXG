/** Multi-select control for choosing an ordered list of subreddits from the user's moderated subreddits. */

import {useState,} from 'react'
import {getModSubs,} from '../../api/resources/modSubs'
import {useFetched,} from '../../util/ui/hooks'
import {classes,} from '../../util/ui/reactMount'
import {ActionButton,} from './ActionButton'
import {Icon,} from './Icon'
import css from './SubredditMultiSelect.module.css'

/**
 * Renders a drag-reorderable list of selected subreddits plus a dropdown to add more.
 * @param props Component properties.
 * @param selected Currently selected subreddit names in display order.
 * @param onChange Called with the updated ordered list when the selection changes.
 */
export const SubredditMultiSelect = ({
	selected,
	onChange,
}: {
	selected: string[]
	onChange: (selected: string[],) => void
},) => {
	const available = (useFetched(getModSubs(false,),)) ?? []
	const [draggedIdx, setDraggedIdx,] = useState<number | null>(null,)
	const [dragOverIdx, setDragOverIdx,] = useState<number | null>(null,)

	const unselected = available.filter((s,) => !selected.includes(s,))

	// `pending` tracks the user's dropdown selection. Since `available` loads async,
	// we derive the effective value so the first item is always actionable on load.
	const [pending, setPending,] = useState('',)
	const effectivePending = unselected.includes(pending,) ? pending : (unselected[0] ?? '')

	const add = () => {
		if (!effectivePending) { return }
		onChange([...selected, effectivePending,],)
		const remaining = unselected.filter((s,) => s !== effectivePending)
		setPending(remaining[0] ?? '',)
	}

	const remove = (subreddit: string,) =>
		onChange(selected.filter((selectedSubreddit,) => selectedSubreddit !== subreddit),)

	const handleDragStart = (index: number,) => setDraggedIdx(index,)

	const handleDragOver = (event: React.DragEvent, index: number,) => {
		event.preventDefault()
		if (dragOverIdx !== index) { setDragOverIdx(index,) }
	}

	const handleDrop = (index: number,) => {
		if (draggedIdx === null || draggedIdx === index) {
			setDraggedIdx(null,)
			setDragOverIdx(null,)
			return
		}
		const next = [...selected,]
		const [item,] = next.splice(draggedIdx, 1,)
		next.splice(index, 0, item!,)
		onChange(next,)
		setDraggedIdx(null,)
		setDragOverIdx(null,)
	}

	const handleDragEnd = () => {
		setDraggedIdx(null,)
		setDragOverIdx(null,)
	}

	return (
		<div className={css.wrapper}>
			{selected.length > 0 && (
				<div className={css.cardList}>
					{selected.map((subreddit, i,) => (
						<div
							key={subreddit}
							className={classes(
								css.card,
								draggedIdx === i && css.dragging,
								dragOverIdx === i && draggedIdx !== i && css.dragTarget,
							)}
							draggable
							onDragStart={() => handleDragStart(i,)}
							onDragOver={(e,) => handleDragOver(e, i,)}
							onDrop={() => handleDrop(i,)}
							onDragEnd={handleDragEnd}
						>
							<button
								type="button"
								className={css.dragHandle}
								title="Drag to reorder"
							>
								<Icon icon="dragHandle" />
							</button>
							<span className={css.subName}>{subreddit}</span>
							<button
								type="button"
								className={css.removeBtn}
								aria-label={`Remove ${subreddit}`}
								onClick={() => remove(subreddit,)}
							>
								<Icon icon="delete" mood="negative" />
							</button>
						</div>
					))}
				</div>
			)}
			{unselected.length > 0 && (
				<div className={css.addRow}>
					<select
						className={css.addSelect}
						value={effectivePending}
						onChange={(e,) => setPending(e.target.value,)}
					>
						{unselected.map((s,) => <option key={s} value={s}>{s}</option>)}
					</select>
					<ActionButton type="button" onClick={add}>Add</ActionButton>
				</div>
			)}
		</div>
	)
}
