/** Presentational helper that runs an imperative side-effect for a renderer's mounted lifetime. */
import {useEffect,} from 'react'

/** Props for {@link MountEffect}. */
interface MountEffectProps {
	/** Side-effect to run once on mount; may return a cleanup function run on unmount. */
	effect: () => (() => void) | void
}

/**
 * Renders nothing; runs `effect` once on mount and its returned cleanup on unmount.
 * Bridges a `renderAtLocation` renderer's lifetime into an imperative DOM side-effect
 * without putting that DOM logic inside the component.
 */
export function MountEffect ({effect,}: MountEffectProps,) {
	useEffect(() => effect(), [],)
	return null
}
