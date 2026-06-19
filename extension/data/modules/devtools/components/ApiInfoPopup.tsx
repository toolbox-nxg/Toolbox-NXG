/** Draggable popup that pretty-prints front-end API context data as JSON. */
import {Window,} from '../../../shared/window/Window'
import {mountPopup,} from '../../../util/ui/reactMount'

import css from './ApiInfoPopup.module.css'

/** Props for the ApiInfoPopup component. */
interface ApiInfoPopupProps {
	/** The API context object to display. */
	info: unknown
	/** Where the popup should initially appear on screen. */
	initialPosition: {top: number; left: number}
	onClose: () => void
}

/** Renders a draggable window containing pretty-printed JSON of the given API context. */
export function ApiInfoPopup ({info, initialPosition, onClose,}: ApiInfoPopupProps,) {
	return (
		<Window
			title="front-end api info"
			draggable
			initialPosition={initialPosition}
			className={css.popup}
			onClose={onClose}
		>
			<pre className={css.code}>
                <code>{JSON.stringify(info, null, '\t')}</code>
			</pre>
		</Window>
	)
}

/**
 * Mounts an ApiInfoPopup as a managed popup overlay.
 * @param props Popup props; `onClose` is optional and will be called in addition to unmounting.
 */
export function showApiInfoPopup (props: Omit<ApiInfoPopupProps, 'onClose'> & {onClose?: () => void},) {
	// Per-target by the thing's id (or permalink). Omit the key when neither is
	// available so unrelated popups aren't collapsed onto a shared empty key.
	const ctx = props.info as {thingId?: string; permalink?: string} | undefined
	const id = ctx?.thingId ?? ctx?.permalink
	const key = id ? `apiinfo:${id}` : undefined
	return mountPopup((onClose,) => <ApiInfoPopup {...props} onClose={onClose} />, props.onClose, key,)
}
