/** Utilities for computing screen positions for Toolbox popup windows. */

/** Pixel coordinates for positioning a popup relative to the viewport. */
export interface DrawPosition {
	leftPosition: number
	topPosition: number
}

/**
 * Clamps a page-coordinate top-left position so a popup of the given size stays
 * fully on-screen against every edge, leaving a small margin. When the popup is
 * larger than the viewport along an axis, it is pinned to the top/left edge
 * rather than producing a negative (off-screen) clamp.
 *
 * Works in page coordinates (i.e. includes `window.scrollX/Y`), matching the
 * values written to a popup's `style.left`/`style.top`.
 */
export function clampIntoViewport (
	left: number,
	top: number,
	width: number,
	height: number,
	margin = 5,
): {left: number; top: number} {
	const minLeft = window.scrollX + margin
	const maxLeft = window.scrollX + window.innerWidth - width - margin
	const minTop = window.scrollY + margin
	const maxTop = window.scrollY + window.innerHeight - height - margin

	return {
		// `Math.max(minLeft, maxLeft)` guards popups wider/taller than the viewport
		// (where max < min) so they pin to the top-left instead of going negative.
		left: Math.max(minLeft, Math.min(left, Math.max(minLeft, maxLeft,),),),
		top: Math.max(minTop, Math.min(top, Math.max(minTop, maxTop,),),),
	}
}

/**
 * Picks a viewport coordinate at which to anchor a popup for a given pointer
 * event. Aims to sit near the cursor while clamping the result so the popup
 * stays fully on-screen against every edge.
 *
 * Supply `popupWidth`/`popupHeight` when known for exact clamping; otherwise
 * conservative fallback dimensions are assumed.
 */
export function drawPosition (
	event: PointerEvent | MouseEvent,
	{popupWidth = 700, popupHeight = 500,}: {popupWidth?: number; popupHeight?: number} = {},
): DrawPosition {
	const {left, top,} = clampIntoViewport(event.pageX - 50, event.pageY - 50, popupWidth, popupHeight,)
	return {leftPosition: left, topPosition: top,}
}
