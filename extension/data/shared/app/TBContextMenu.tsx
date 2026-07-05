/** Renders the Toolbox context menu panel anchored to the left or right edge of the page. */

import {useEffect, useState,} from 'react'
import {createPortal,} from 'react-dom'
import {useDispatch, useSelector,} from 'react-redux'

import {genSettings,} from '../../framework/moduleIds'
import {RootState,} from '../../store'
import {clearAttention,} from '../../store/contextMenuSlice'
import {useSetting,} from '../../util/ui/hooks'
import {Icon,} from '../controls/Icon'

/** Renders the slide-out Toolbox context menu, portaled into `document.body`. */
export function TBContextMenu () {
	const items = useSelector((state: RootState,) => state.contextMenu.items)
	const attentionId = useSelector((state: RootState,) => state.contextMenu.attentionId)
	const dispatch = useDispatch()

	const location = useSetting<'left' | 'right'>(genSettings, 'contextMenuLocation', 'left',)
	const attention = useSetting<'open' | 'fade'>(genSettings, 'contextMenuAttention', 'open',)
	const clickActivated = useSetting<boolean>(genSettings, 'contextMenuClick', false,)

	const [open, setOpen,] = useState(false,)
	const [showAttention, setShowAttention,] = useState(false,)

	// Briefly highlight the menu when an item is added
	useEffect(() => {
		if (!attentionId) { return }
		setShowAttention(true,)
		const duration = attention === 'fade' ? 6000 : 1000
		const t = setTimeout(() => {
			setShowAttention(false,)
			dispatch(clearAttention(),)
		}, duration,)
		return () => clearTimeout(t,)
	}, [attentionId, attention, dispatch,],)

	if (items.length === 0) { return null }

	const classNames = [
		`show-context-${location}`,
		clickActivated ? 'click-activated' : 'hover-activated',
		showAttention ? attention : '',
		open ? 'open' : '',
	].filter(Boolean,).join(' ',)

	const menu = (
		<div
			id="toolbox-context-menu"
			className={classNames}
			onClick={clickActivated ? () => setOpen((o,) => !o) : undefined}
		>
			<div id="toolbox-context-menu-wrap">
				<div id="toolbox-context-header">Toolbox context menu</div>
				<ul id="toolbox-context-menu-list">
					{items.map((item,) => {
						const dataProps: Record<string, string> = {}
						if (item.dataAttributes) {
							for (const [k, v,] of Object.entries(item.dataAttributes,)) {
								dataProps[`data-${k}`] = v
							}
						}
						return (
							<li
								key={item.id}
								id={item.id}
								title={item.title || item.text}
								{...dataProps}
							>
								<Icon icon={item.icon} />
								<span>{item.text}</span>
							</li>
						)
					},)}
				</ul>
			</div>
			<Icon
				icon={location === 'left' ? 'arrowRight' : 'arrowLeft'}
				className="toolbox-context-arrow"
			/>
		</div>
	)

	return createPortal(menu, document.body,)
}
