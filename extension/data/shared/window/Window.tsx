/** Generic Toolbox window/panel component with optional drag, toolbar, footer, and close button. */

import {MouseEventHandler, ReactNode, useId, useLayoutEffect, useRef,} from 'react'
import {classes,} from '../../util/ui/reactMount'

/**
 * Makes `dragEl` draggable by mouse, using `handleEl` as the drag initiator.
 * Sets the element to `position: fixed` coordinates tracked via mousemove.
 */
function makeDraggable (dragEl: HTMLElement, handleEl: HTMLElement = dragEl,): void {
	handleEl.style.cursor = 'move'
	handleEl.addEventListener('mousedown', (event,) => {
		const rect = dragEl.getBoundingClientRect()
		const deltaX = rect.left + window.scrollX - event.pageX
		const deltaY = rect.top + window.scrollY - event.pageY
		const originalZIndex = dragEl.style.zIndex
		dragEl.style.zIndex = '2147483647'
		function onMouseMove (ev: MouseEvent,) {
			dragEl.style.left = `${deltaX + ev.pageX}px`
			dragEl.style.top = `${deltaY + ev.pageY}px`
			dragEl.style.bottom = 'auto'
			dragEl.style.right = 'auto'
		}
		function onMouseUp () {
			document.documentElement.removeEventListener('mousemove', onMouseMove,)
			dragEl.style.zIndex = originalZIndex
		}
		document.documentElement.addEventListener('mousemove', onMouseMove,)
		document.documentElement.addEventListener('mouseup', onMouseUp, {once: true,},)
		event.preventDefault()
	},)
}
import {Icon,} from '../controls/Icon'
import css from './Window.module.css'

/**
 * Renders a styled dialog window with a title bar and optional toolbar, footer, and header buttons.
 * @param props Component properties.
 * @param toolbar Optional content rendered in a slot below the title bar.
 * @param footer Optional content rendered at the bottom of the window.
 * @param headerButtons Optional action buttons placed in the title bar to the left of the close button.
 * @param draggable When true, the window can be moved by dragging the title bar.
 * @param initialPosition Pixel position for the top-left corner when `draggable` is true.
 * @param closable When false, the close button is hidden.
 * @param onClose Called when the close button is clicked.
 * @param onClick Called when anywhere in the window is clicked.
 */
export const Window = ({
	title,
	toolbar,
	footer,
	headerButtons,
	className = '',
	draggable = false,
	initialPosition,
	closable = true,
	children,
	onClose,
	onClick,
}: {
	title: ReactNode
	toolbar?: ReactNode
	footer?: ReactNode
	headerButtons?: ReactNode
	className?: string | undefined
	draggable?: boolean
	initialPosition?: {top: number; left: number} | undefined
	closable?: boolean
	children?: ReactNode
	onClose?: (() => void) | undefined
	onClick?: (() => void) | undefined
},) => {
	const windowRef = useRef<HTMLDivElement>(null,)
	const windowHeaderRef = useRef<HTMLDivElement>(null,)
	const titleId = useId()

	useLayoutEffect(() => {
		if (draggable && windowRef.current != null && windowHeaderRef.current != null) {
			if (initialPosition) {
				windowRef.current.style.top = `${initialPosition.top}px`
				windowRef.current.style.left = `${initialPosition.left}px`
			}
			makeDraggable(windowRef.current, windowHeaderRef.current,)
		}
		// Move focus into the window so keyboard navigation works immediately,
		// remembering what had focus so it can be restored when the window closes.
		const previouslyFocused = document.activeElement as HTMLElement | null
		const firstFocusable = windowRef.current?.querySelector<HTMLElement>(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
		)
		firstFocusable?.focus({preventScroll: true,},)
		return () => {
			// Restore focus to whatever held it before the window opened, but only
			// if that element is still in the document and able to take focus.
			if (previouslyFocused && previouslyFocused !== document.body && previouslyFocused.isConnected) {
				previouslyFocused.focus({preventScroll: true,},)
			}
		}
	}, [],)

	const handleClick: MouseEventHandler<HTMLDivElement> = () => {
		onClick?.()
	}

	const handleClose: MouseEventHandler<HTMLButtonElement> = (event,) => {
		event.stopPropagation()
		onClose?.()
	}

	return (
		<div
			ref={windowRef}
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			className={classes(
				css.window,
				draggable && css.draggable,
				className,
			)}
			onClick={handleClick}
		>
			<div ref={windowHeaderRef} className={css.header}>
				<div id={titleId} className={css.title}>{title}</div>
				<div className={css.buttons}>
					{headerButtons}
					{closable && (
						<button type="button" aria-label="Close" onClick={handleClose}>
							<Icon icon="close" />
						</button>
					)}
				</div>
			</div>
			{toolbar !== undefined && (
				<div className={css.toolbarSlot}>{toolbar}</div>
			)}
			<div className={css.content}>
				{children}
			</div>
			{footer !== undefined && (
				<div className={css.footer}>
					{footer}
				</div>
			)}
		</div>
	)
}
