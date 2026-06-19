import {defineConfig,} from 'vitest/config'

export default defineConfig({
	test: {
		// happy-dom avoids the jsdom → html-encoding-sniffer → @exodus/bytes
		// ESM/CJS incompatibility that breaks tests on Node 20 + jsdom 29.
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
		include: ['extension/**/*.test.{ts,tsx}',],
	},
},)
