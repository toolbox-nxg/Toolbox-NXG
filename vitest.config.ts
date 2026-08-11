import {defineConfig,} from 'vitest/config'

export default defineConfig({
	test: {
		// The only DOM environment: every test runs here, so there is one set of DOM
		// quirks to reason about rather than two. jsdom was previously pinned per-file
		// by a handful of tests via `// @vitest-environment jsdom`; none of them needed
		// anything happy-dom lacks (no XPath, no computed styles), so the dependency was
		// dropped. Reach for jsdom again only if a test genuinely needs its fuller CSS
		// or XPath support -- that means re-adding the devDependency, not a stray pragma.
		environment: 'happy-dom',
		environmentOptions: {
			happyDOM: {
				settings: {
					// The bundled stylesheet (browser.runtime.getURL('data/bundled.css'))
					// is not served under test, so every <link rel="stylesheet"> that the
					// UI appends to a shadow root logs a failed-fetch DOMException. Skip
					// the fetch entirely...
					disableCSSFileLoading: true,
					// ...and treat the skipped load as success so the link fires `load`
					// instead of `error` and happy-dom logs nothing. MatrixStyleProvider's
					// readiness flag settles on `load` just as it did on the old `error`.
					handleDisabledFileLoadingAsSuccess: true,
				},
			},
		},
		// Stubs the eager bundled.css prefetch (reactMount.tsx) that 404s under test.
		// Lives in a file (loaded inside the worker) rather than inline here, because
		// functions in `environmentOptions` cannot be cloned to the forks pool.
		setupFiles: ['./vitest.setup.ts',],
		env: {TZ: 'UTC',},
		include: ['extension/**/*.test.{ts,tsx}',],
	},
},)
