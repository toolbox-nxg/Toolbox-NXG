/** Full-page modal dialog: scroll-locking backdrop + centered window shell in one component. */

import {ReactNode,} from 'react'
import {Backdrop,} from './Backdrop'
import {Window,} from './Window'

/**
 * Renders a full-page modal overlay containing a styled dialog window.
 * Combines `Backdrop` (scroll locking, Escape key, click-outside dismissal) and `Window`
 * (title bar, close button, toolbar/footer slots) into a single composable unit.
 * For tabbed dialogs use `TabbedDialog` instead.
 * @param props Component properties.
 * @param title Text shown in the window title bar.
 * @param onClose Called when the user closes the window or clicks/Escapes outside it.
 * @param toolbar Optional content rendered in a slot below the title bar.
 * @param footer Optional content rendered at the bottom of the window.
 * @param headerButtons Optional buttons placed in the title bar to the left of the close button.
 * @param className Optional CSS class applied to the inner window element.
 * @param backdropClassName Optional CSS class applied to the outer backdrop element.
 * @param width Constrains the window to `min(${width}px, 100vw - 20px)`. Omit to let CSS drive sizing.
 */
export const FullPageDialog = ({
	title,
	onClose,
	toolbar,
	footer,
	headerButtons,
	className,
	backdropClassName,
	width,
	children,
}: {
	title: ReactNode
	onClose?: () => void
	toolbar?: ReactNode
	footer?: ReactNode
	headerButtons?: ReactNode
	className?: string | undefined
	backdropClassName?: string | undefined
	width?: number
	children: ReactNode
},) => (
	<Backdrop
		{...(onClose && {onClickOutside: onClose,})}
		{...(backdropClassName !== undefined && {className: backdropClassName,})}
	>
		<div style={width !== undefined ? {width: `min(${width}px, calc(100vw - 20px))`,} : undefined}>
			<Window
				title={title}
				{...(onClose && {onClose,})}
				{...(toolbar !== undefined && {toolbar,})}
				{...(footer !== undefined && {footer,})}
				{...(headerButtons !== undefined && {headerButtons,})}
				{...(className !== undefined && {className,})}
			>
				{children}
			</Window>
		</div>
	</Backdrop>
)
