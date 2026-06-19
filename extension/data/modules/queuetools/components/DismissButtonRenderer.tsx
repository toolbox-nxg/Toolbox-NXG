/** React renderer that shows a "dismiss" button on already-actioned Old Reddit queue items. */
import {useEffect, useState,} from 'react'

import {GeneralInlineButton,} from '../../../shared/controls/GeneralInlineButton'

/** CSS classes Old Reddit applies to a `.thing` once a moderator has actioned it. */
const ACTIONED_CLASSES = ['approved', 'removed', 'spammed', 'flaired',]

/**
 * Determines whether the dismiss button should show for a queue item: it must carry an
 * actioned class, but not have been actioned by AutoModerator. Automod-removed items still
 * need human review, so dismissing them as "done" would hide work that isn't finished.
 * @param thing The queue `.thing` element to inspect.
 * @returns `true` when a human moderator's verdict is present on the item.
 */
function isDismissable (thing: Element,): boolean {
	const actioned = ACTIONED_CLASSES.some((cls,) => thing.classList.contains(cls,))
	if (!actioned) { return false }
	// Old Reddit shows the actioning mod in the `.flat-list li[title]` byline, e.g.
	// `title="removed by AutoModerator"`. AutoModerator never approves, so this only
	// filters out automod removals/spam-removals awaiting review.
	const byline = thing.querySelector('.flat-list li[title]',)?.getAttribute('title',) ?? ''
	return !/AutoModerator/i.test(byline,)
}

/**
 * Shows a "dismiss" button on already-actioned queue items that removes the item from the
 * DOM via `onDismiss`. The actioned class is added by Reddit only after the moderator clicks
 * a native action button, so the item's class list and byline are observed and the button's
 * visibility updates live.
 * @param props Component properties.
 * @param target The Toolbox host slot inside the queue `.thing`.
 * @param onDismiss Removes the resolved `.thing` from the DOM (and surfaces the queue creature
 *   when it was the last item).
 */
export function DismissButtonRenderer (
	{target, onDismiss,}: {
		target: Element
		onDismiss: (thing: Element,) => void
	},
) {
	const thing = target.closest('.thing',)
	const [visible, setVisible,] = useState(() => (thing ? isDismissable(thing,) : false))

	useEffect(() => {
		if (!thing) { return }
		const observer = new MutationObserver(() => setVisible(isDismissable(thing,),))
		observer.observe(thing, {attributes: true, attributeFilter: ['class',], subtree: true, childList: true,},)
		// Re-evaluate immediately in case the item became actioned before the observer attached.
		setVisible(isDismissable(thing,),)
		return () => observer.disconnect()
	}, [thing,],)

	if (!thing || !visible) { return null }

	return (
		<GeneralInlineButton onClick={() => onDismiss(thing,)}>
			dismiss
		</GeneralInlineButton>
	)
}
