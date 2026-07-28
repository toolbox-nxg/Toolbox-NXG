/** Hook that marks an ancestor element with a CSS class while a component is mounted and active. */

import {useEffect,} from 'react'

/**
 * Adds `className` to `target` while `active` is true and the component is mounted, and removes it on
 * unmount or when `active` becomes false. A no-op when `target` is null or `active` is false.
 *
 * Used by inline Shreddit controls to mark their host `shreddit-comment`/`shreddit-post` so the
 * native-control-hiding CSS applies only where a Toolbox replacement is actually rendered - keying
 * the hide off the replacement's presence rather than off a slot being injected. The class-toggle is
 * a rendering side-effect intrinsically tied to whether the replacement mounted, so it lives in the
 * component's React lifecycle (effect cleanup removes it) rather than a raw DOM listener.
 * @param target Element to mark, or null to skip (e.g. before the host resolves).
 * @param className CSS class to add while active.
 * @param active Whether the marker should currently be applied.
 */
export function useAncestorClass (target: Element | null, className: string, active: boolean,): void {
	useEffect(() => {
		if (!target || !active) { return }
		target.classList.add(className,)
		return () => {
			target.classList.remove(className,)
		}
	}, [target, className, active,],)
}
