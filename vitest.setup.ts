/**
 * Global test setup. Runs once per worker (via `setupFiles` in vitest.config.ts)
 * before any test module is imported.
 *
 * reactMount.tsx eagerly `fetch()`es the bundled stylesheet at import time as a
 * FOUC optimization. That resource is never served under happy-dom, so the fetch
 * fails and happy-dom logs a `GET .../data/bundled.css 404` line (or, when a test
 * mocks `browser.runtime.getURL` to a `chrome-extension://` URL, an unsupported-
 * scheme DOMException) before reactMount's own `.catch` swallows the rejection.
 * Short-circuit only that one request with an empty 200 so nothing is logged;
 * every other request falls through to the real fetch untouched.
 */

const realFetch = globalThis.fetch

globalThis.fetch = function fetch (input: RequestInfo | URL, init?: RequestInit,): Promise<Response> {
	const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
	if (url.endsWith('data/bundled.css',)) {
		return Promise.resolve(new Response('', {status: 200,},),)
	}
	return realFetch(input, init,)
} as typeof fetch
