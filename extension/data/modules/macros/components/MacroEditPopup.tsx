/** Draggable popup that lets a moderator review and edit a macro reply before posting it. */

import {useEffect, useRef, useState,} from 'react'

import {ActionButton,} from '../../../shared/controls/ActionButton'
import {Window,} from '../../../shared/window/Window'
import {purifyHTML,} from '../../../util/data/purify'
import {getMarkdownParser,} from '../../../util/ui/markdown'
import {mountPopup,} from '../../../util/ui/reactMount'

import css from './MacroEditPopup.module.css'

/** Props for the MacroEditPopup component. */
interface MacroEditPopupProps {
	/** The macro title shown in the window heading. */
	title: string
	/** Pre-filled text for the reply textarea. */
	initialComment: string
	/** Sanitized HTML listing the mod actions that will be performed on post. */
	actionListHtml: string
	/** Whether to show a live markdown preview below the textarea. */
	showMacroPreview: boolean
	/** Minimum pixel width for the edit textarea. */
	editMinWidth: number
	/** Minimum pixel height for the edit textarea. */
	editMinHeight: number
	/** Where to place the popup window on screen. */
	initialPosition: {top: number; left: number}
	/** Returns `true` to close the popup, `false` to leave it open. */
	onPost: (editedComment: string,) => Promise<boolean>
	onClose: () => void
}

/** Renders the macro edit/preview popup window. */
export function MacroEditPopup ({
	title,
	initialComment,
	actionListHtml,
	showMacroPreview,
	editMinWidth,
	editMinHeight,
	initialPosition,
	onPost,
	onClose,
}: MacroEditPopupProps,) {
	const [comment, setComment,] = useState(initialComment,)
	const [posting, setPosting,] = useState(false,)

	// Debounced markdown preview
	const [previewHtml, setPreviewHtml,] = useState('',)
	const parser = useRef(getMarkdownParser(),)
	const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null,)
	useEffect(() => {
		if (!showMacroPreview) { return }
		if (debounceTimer.current) { clearTimeout(debounceTimer.current,) }
		debounceTimer.current = setTimeout(() => {
			setPreviewHtml(purifyHTML(parser.current.render(comment,),),)
		}, 100,)
		return () => {
			if (debounceTimer.current) { clearTimeout(debounceTimer.current,) }
		}
	}, [comment, showMacroPreview,],)
	// Initial render of preview
	useEffect(() => {
		if (showMacroPreview) {
			setPreviewHtml(purifyHTML(parser.current.render(initialComment,),),)
		}
	}, [showMacroPreview,],)

	const handlePost = async () => {
		setPosting(true,)
		try {
			const shouldClose = await onPost(comment,)
			if (shouldClose) { onClose() }
		} finally {
			setPosting(false,)
		}
	}

	return (
		<Window
			title={`Mod Macro: ${title}`}
			className={css.popup}
			initialPosition={initialPosition}
			draggable
			closable={!posting}
			onClose={onClose}
			footer={
				<ActionButton onClick={handlePost} disabled={posting}>
					Post Macro
				</ActionButton>
			}
		>
			<textarea
				className={css.editArea}
				value={comment}
				onChange={(event,) => setComment(event.target.value,)}
				style={{
					minWidth: `${editMinWidth}px`,
					minHeight: `${editMinHeight}px`,
				}}
			/>
			<div className={css.actionList} dangerouslySetInnerHTML={{__html: purifyHTML(actionListHtml,),}} />
			{showMacroPreview && (
				<div className={css.preview}>
					<h3 className={css.previewHeading}>Preview</h3>
					<div className={css.commentBody}>
						<div className="md" dangerouslySetInnerHTML={{__html: previewHtml,}} />
					</div>
				</div>
			)}
		</Window>
	)
}

/**
 * Mounts a MacroEditPopup in a detached shadow DOM and returns a function that unmounts it.
 * @param props All MacroEditPopupProps except `onClose`, which is handled internally.
 */
export function showMacroEditPopup (
	props: Omit<MacroEditPopupProps, 'onClose'> & {onClose?: () => void},
) {
	// Per-target by macro title: re-opening the same macro reveals the live editor
	// instead of mounting a duplicate that would discard the in-progress edit.
	return mountPopup(
		(onClose,) => <MacroEditPopup {...props} onClose={onClose} />,
		props.onClose,
		`macroedit:${props.title}`,
	)
}
