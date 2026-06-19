/** Popup that displays the full list of mod and user reports for a queue item that has ignored reports. */
import {Window,} from '../../../shared/window/Window'
import {mountPopup,} from '../../../util/ui/reactMount'

import css from './QueuetoolsReportsPopup.module.css'

/** Props for the QueuetoolsReportsPopup component. */
interface QueuetoolsReportsPopupProps {
	title: string
	/** Mod reports as `[reportText, modUsername]` tuples. */
	modReports: Array<[string, string,]>
	/** User reports as `[reportText, reportCount]` tuples. */
	userReports: Array<[string, string,]>
	/** Screen coordinates where the popup should initially appear. */
	initialPosition: {top: number; left: number}
	onClose: () => void
}

/** Renders a draggable popup listing all mod and user reports for a queue item. */
export function QueuetoolsReportsPopup ({
	title,
	modReports,
	userReports,
	initialPosition,
	onClose,
}: QueuetoolsReportsPopupProps,) {
	return (
		<Window
			title={title}
			className={css.popup}
			draggable
			initialPosition={initialPosition}
			onClose={onClose}
		>
			<div className={css.reportList}>
				{modReports.length > 0 && (
					<>
						<b>mod reports:</b>
						<ul>
							{modReports.map(([text, author,], i,) => (
								<li key={`m${i}`}>{author}: {text}</li>
							))}
						</ul>
					</>
				)}
				{userReports.length > 0 && (
					<>
						<b>user reports:</b>
						<ul>
							{userReports.map(([text, author,], i,) => (
								<li key={`u${i}`}>{author}: {text}</li>
							))}
						</ul>
					</>
				)}
			</div>
		</Window>
	)
}

/**
 * Mounts the QueuetoolsReportsPopup into the page.
 * @param props Popup props; `onClose` is optional and merged with the mount cleanup.
 * @returns A function that unmounts the popup.
 */
export function showQueuetoolsReportsPopup (
	props: Omit<QueuetoolsReportsPopupProps, 'onClose'> & {onClose?: () => void},
) {
	return mountPopup((onClose,) => <QueuetoolsReportsPopup {...props} onClose={onClose} />, props.onClose,)
}
