/**
 * Context and provider that delay rendering children until all required stylesheets have loaded,
 * ensuring CSS-based action icons are visible before the matrix table appears.
 */

import {createContext, useRef, useState,} from 'react'

/**
 * `true` once all stylesheets passed to {@link MatrixStyleProvider} have settled (loaded or errored).
 * Consumers use this to defer icon-visibility checks until CSS rules are available.
 */
export const StylesReadyContext = createContext(false,)

/**
 * Injects `<link>` elements for the provided stylesheet URLs and exposes a readiness flag via
 * {@link StylesReadyContext} that becomes `true` once every sheet has loaded or failed.
 * @param hrefs Stylesheet URLs to inject (typically cross-origin sheets that need to be re-attached).
 */
export function MatrixStyleProvider ({hrefs, children,}: {hrefs: string[]; children: React.ReactNode},) {
	const remaining = useRef(hrefs.length,)
	const [ready, setReady,] = useState(hrefs.length === 0,)

	const onSettled = () => {
		remaining.current--
		if (remaining.current <= 0) { setReady(true,) }
	}

	return (
		<StylesReadyContext.Provider value={ready}>
			{hrefs.map((href,) => (
				<link key={href} rel="stylesheet" type="text/css" href={href} onLoad={onSettled} onError={onSettled} />
			))}
			{children}
		</StylesReadyContext.Provider>
	)
}
