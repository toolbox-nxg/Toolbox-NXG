/** Shared "pill" control for the Shreddit flat-list mod-action row. */

import {type AnchorHTMLAttributes, type MouseEvent,} from 'react'

import {classes,} from '../../util/ui/reactMount'

/** Props for {@link FlatListAction}: any anchor attributes, plus our pill-class handling. */
export interface FlatListActionProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
	/** Extra class names layered on top of the shared `toolbox-flat-list-action` pill class. */
	className?: string
	/** Arbitrary `data-*` attributes (e.g. document-level handlers read `data-id`/`data-subreddit`). */
	[dataAttr: `data-${string}`]: string | undefined
}

/**
 * A flat-list-row action rendered as an `<a role="button">` styled like Reddit's native pills.
 *
 * Bakes in the contract every row control shares: the `toolbox-flat-list-action` class, button
 * semantics, and - crucially - stopping the click from reaching Shreddit's full-post overlay link
 * (the slot links have no `href`, so a bubbled click would navigate to the post instead of running
 * the action). That propagation-stop is applied **only when this control owns its click** via
 * `onClick`; handler-less links (the Remove and "Add removal reason" pills) intentionally let the
 * click bubble to a document-level handler, so for them the event is left untouched.
 */
export function FlatListAction ({className, onClick, children, ...rest}: FlatListActionProps,) {
	const handleClick = onClick
		? (event: MouseEvent<HTMLAnchorElement>,) => {
			event.preventDefault()
			event.stopPropagation()
			onClick(event,)
		}
		: undefined

	return (
		<a {...rest} className={classes('toolbox-flat-list-action', className,)} role="button" onClick={handleClick}>
			{children}
		</a>
	)
}
