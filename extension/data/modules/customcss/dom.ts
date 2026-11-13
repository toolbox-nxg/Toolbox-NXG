/** Applies the moderator's custom CSS to the page and to every Toolbox window. */
import {createLifecycle,} from '../../framework/lifecycle'
import {setUserCss,} from '../../util/ui/userStyles'

/** Handler bundle returned by {@link createCustomCssHandlers}. */
export interface CustomCssHandlers {
	/** Replaces the custom CSS on the page and in every Toolbox window, open or opened later. */
	applyCustomCss: (css: string,) => void
	/** Removes the custom CSS everywhere. */
	cleanup: () => Promise<void>
}

/**
 * Creates the handlers that apply the moderator's custom CSS.
 * @returns The apply handler and a cleanup that clears the CSS.
 */
export function createCustomCssHandlers (): CustomCssHandlers {
	const scope = createLifecycle()
	scope.mount(() => setUserCss('',))
	return {applyCustomCss: setUserCss, cleanup: scope.cleanup,}
}
