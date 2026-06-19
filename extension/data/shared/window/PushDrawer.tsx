/**
 * Side-drawer container that pushes the page content right while open.
 *
 * On wide viewports (per `pushMediaQuery`) the page body is shifted by
 * `widthPx` via a margin transition and the `--toolbox-drawer-left-offset`
 * custom property; on narrow viewports the drawer overlays the page instead.
 * Escape closes the drawer.
 *
 * Multiple simultaneous PushDrawer instances coordinate through a shared
 * registry so that their body-margin contributions are additive and the
 * correct value is always maintained regardless of the close order. Each
 * drawer also receives its own left offset (the cumulative width of all
 * drawers registered before it) so they stack side-by-side rather than
 * overlapping.
 */

import {ReactNode, useEffect, useState,} from 'react'
import {useEscapeKey,} from '../../util/ui/hooks'

/** Props for the PushDrawer component. */
interface PushDrawerProps {
	/** Drawer width in pixels; also the amount the page is pushed. */
	widthPx: number
	/** Media query controlling when the page is pushed rather than overlaid. */
	pushMediaQuery: string
	/** Class for the drawer root; supplies the module's positioning/appearance styles. */
	className: string
	onClose: () => void
	children: ReactNode
}

/** Per-entry data stored in the registry for each open drawer. */
interface RegistryEntry {
	effectiveWidthPx: number
	/** Called whenever this drawer's own left-offset changes. */
	setOwnOffset: (offset: number,) => void
}

/**
 * Shared registry that coordinates body-margin changes across multiple
 * simultaneous PushDrawer instances, regardless of the order they close.
 *
 * The registry captures the page's original margin+transition when the first
 * drawer mounts and restores them when the last drawer unmounts. In between,
 * any open/close recomputes the total from the set of still-active entries.
 * Each drawer's individual left offset is also recomputed on every change so
 * that drawers stack left-to-right in registration order.
 */
const drawerRegistry = new class {
	/** Map from drawer id -> entry, in insertion order (determines stacking). */
	private entries = new Map<symbol, RegistryEntry>()
	/** Original inline marginLeft before any drawer was opened. */
	private baselineMarginLeft = ''
	/** Original computed marginLeft before any drawer was opened. */
	private baselineComputedMarginLeft = '0px'
	/** Original inline transition before any drawer was opened. */
	private baselineTransition = ''

	/**
	 * Register a new drawer with its current effective push width.
	 * Captures baseline values when the first drawer registers.
	 * @param id Unique key identifying this drawer in the registry.
	 * @param effectiveWidthPx The drawer's current effective push width, in pixels.
	 * @param setOwnOffset Stable React state setter for this drawer's left offset.
	 */
	register (id: symbol, effectiveWidthPx: number, setOwnOffset: (offset: number,) => void,) {
		if (this.entries.size === 0) {
			this.baselineMarginLeft = document.body.style.marginLeft
			this.baselineComputedMarginLeft = window.getComputedStyle(document.body,).marginLeft
			this.baselineTransition = document.body.style.transition
			document.body.style.transition = this.baselineTransition
				? `${this.baselineTransition}, margin-left 180ms ease`
				: 'margin-left 180ms ease'
		}
		this.entries.set(id, {effectiveWidthPx, setOwnOffset,},)
		this.apply()
	}

	/** Update the effective push width for an already-registered drawer (e.g. on viewport resize). */
	update (id: symbol, effectiveWidthPx: number,) {
		const entry = this.entries.get(id,)
		if (entry) {
			entry.effectiveWidthPx = effectiveWidthPx
			this.apply()
		}
	}

	/**
	 * Unregister a drawer. When the last drawer unregisters the baseline
	 * body styles are fully restored.
	 */
	unregister (id: symbol,) {
		this.entries.delete(id,)
		if (this.entries.size === 0) {
			document.body.style.marginLeft = this.baselineMarginLeft
			document.body.style.transition = this.baselineTransition
			document.documentElement.style.removeProperty('--toolbox-drawer-left-offset',)
		} else {
			this.apply()
		}
	}

	/** Recompute and apply the total body margin and each drawer's own left offset. */
	private apply () {
		let ownOffset = 0
		let totalPx = 0
		for (const {effectiveWidthPx,} of this.entries.values()) {
			totalPx += effectiveWidthPx
		}
		for (const {effectiveWidthPx, setOwnOffset,} of this.entries.values()) {
			setOwnOffset(ownOffset,)
			ownOffset += effectiveWidthPx
		}
		document.body.style.marginLeft = totalPx > 0
			? `calc(${this.baselineComputedMarginLeft} + ${totalPx}px)`
			: this.baselineMarginLeft
		document.documentElement.style.setProperty(
			'--toolbox-drawer-left-offset',
			`${totalPx}px`,
		)
	}
}()

/** A fixed side drawer that pushes the page aside while mounted and closes on Escape. */
export function PushDrawer ({widthPx, pushMediaQuery, className, onClose, children,}: PushDrawerProps,) {
	const [ownOffset, setOwnOffset,] = useState(0,)

	useEffect(() => {
		const id = Symbol()
		const shouldPush = () => window.matchMedia?.(pushMediaQuery,).matches ?? true

		drawerRegistry.register(id, shouldPush() ? widthPx : 0, setOwnOffset,)

		const onMediaChange = () => drawerRegistry.update(id, shouldPush() ? widthPx : 0,)
		const mediaQuery = window.matchMedia?.(pushMediaQuery,)
		if (mediaQuery) {
			mediaQuery.addEventListener('change', onMediaChange,)
		} else {
			window.addEventListener('resize', onMediaChange,)
		}

		return () => {
			mediaQuery?.removeEventListener('change', onMediaChange,)
			if (!mediaQuery) {
				window.removeEventListener('resize', onMediaChange,)
			}
			drawerRegistry.unregister(id,)
		}
	}, [widthPx, pushMediaQuery,],)

	useEscapeKey(onClose,)

	return (
		<div className={className} style={{left: ownOffset,}}>
			{children}
		</div>
	)
}
