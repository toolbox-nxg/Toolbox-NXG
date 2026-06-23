/** A single drag-sortable removal reason card with selection, inline editing, and rendered preview. */

import {useSortable,} from '@dnd-kit/sortable'
import {CSS,} from '@dnd-kit/utilities'
import {useMemo,} from 'react'
import {ActionButton,} from '../../../shared/controls/ActionButton'
import {Icon,} from '../../../shared/controls/Icon'
import {TextareaInput,} from '../../../shared/controls/TextareaInput'
import {RenderedReason,} from './RemovalReasonsOverlay.helpers'
import css from './RemovalReasonsOverlay.module.css'

/** Props for the SortableReasonCard component. */
interface SortableReasonCardProps {
	item: RenderedReason
	/** Zero-based display position; shown as a 1-based number badge. */
	position: number
	selected: boolean
	/** Whether this reason was pre-selected from the item's report (shows a "Suggested" badge). */
	suggested?: boolean
	onToggle: () => void
	/** Receives the rendered-content element so the parent can read user input values. */
	setContentRef: (element: HTMLDivElement | null,) => void
	isEditing: boolean
	/** The in-progress edited markdown while this card is being edited. */
	editDraft: string
	/** Re-rendered HTML for an edited reason, replacing the original preview. */
	overrideHtml?: string | undefined
	onEdit: () => void
	onEditDraftChange: (text: string,) => void
	onEditSave: () => void
	onEditCancel: () => void
}

/** One removal reason in the sortable reason list. */
export function SortableReasonCard ({
	item,
	position,
	selected,
	suggested,
	onToggle,
	setContentRef,
	isEditing,
	editDraft,
	overrideHtml,
	onEdit,
	onEditDraftChange,
	onEditSave,
	onEditCancel,
}: SortableReasonCardProps,) {
	const {attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,} = useSortable({
		id: item.id,
	},)
	const style = {
		transform: CSS.Transform.toString(transform,),
		transition,
		opacity: isDragging ? 0.5 : undefined,
	}
	const hasTitle = !!item.reason.title
	// The {__html} object must keep a stable identity while the HTML string is
	// unchanged: react-dom re-applies innerHTML whenever the object identity
	// differs, which would wipe the input listeners and user-entered values the
	// overlay wires into this subtree on every unrelated re-render.
	const contentHtml = useMemo(
		() => ({__html: overrideHtml ?? item.html,}),
		[overrideHtml, item.html,],
	)
	const flairBadges = [
		item.reason.flairText && `flair: ${item.reason.flairText}`,
		item.reason.flairCSS && `class: ${item.reason.flairCSS}`,
		item.reason.flairTemplateID && `template: ${item.reason.flairTemplateID}`,
	].filter(Boolean,)

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={`${css.reasonCard} ${selected ? css.reasonSelected : ''}`}
			onClick={(event,) => {
				const target = event.target as HTMLElement
				if (
					target.closest('button',)
					|| target.closest('input',)
					|| target.closest('textarea',)
					|| target.closest('select',)
					|| target.closest('a',)
					|| target.closest('.toolbox-radio-group',)
				) {
					return
				}
				onToggle()
			}}
		>
			<div className={css.reasonCardHeader}>
				<button
					ref={setActivatorNodeRef}
					type="button"
					className={css.dragHandle}
					{...attributes}
					{...listeners}
					title="Drag to reorder"
					aria-label="Drag to reorder removal reason"
				>
					<Icon icon="dragHandle" />
				</button>
				<label className={css.reasonCardSelect} onClick={(event,) => event.stopPropagation()}>
					<input
						type="checkbox"
						className={css.reasonCheck}
						aria-label={`Select removal reason ${position + 1}`}
						checked={selected}
						onChange={onToggle}
					/>
					<span className={css.reasonNum}>{position + 1}</span>
				</label>
				<div className={css.reasonCardTitle}>
					{hasTitle ? item.reason.title : <em className={css.untitled}>Untitled</em>}
				</div>
				{suggested && (
					<div className={css.contextBadges}>
						<span className={css.contextBadge}>Suggested</span>
					</div>
				)}
				{flairBadges.length > 0 && (
					<div className={css.contextBadges}>
						{flairBadges.map((badge,) => (
							<span key={badge} className={css.contextBadge}>{badge}</span>
						))}
					</div>
				)}
				{selected && (
					<button
						type="button"
						className={`${css.editIconButton} ${isEditing ? css.editIconButtonActive : ''}`}
						title={isEditing ? 'Cancel edit' : 'Edit reason text'}
						onClick={(e,) => {
							e.stopPropagation()
							if (isEditing) { onEditCancel() }
							else { onEdit() }
						}}
					>
						<Icon icon={isEditing ? 'close' : 'edit'} />
					</button>
				)}
			</div>
			{isEditing
				? (
					<div className={css.reasonContent}>
						<TextareaInput
							rows={6}
							value={editDraft}
							onChange={(e,) => onEditDraftChange(e.target.value,)}
						/>
						<div className={css.editReasonActions}>
							<ActionButton primary type="button" onClick={onEditSave}>Save</ActionButton>
							<ActionButton type="button" onClick={onEditCancel}>Cancel</ActionButton>
						</div>
					</div>
				)
				: (
					<div
						ref={setContentRef}
						className={css.reasonContent}
						style={hasTitle && !selected ? {display: 'none',} : undefined}
						dangerouslySetInnerHTML={contentHtml}
					/>
				)}
		</div>
	)
}
