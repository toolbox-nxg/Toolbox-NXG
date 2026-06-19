/** Shared test helpers for background message-handler suites: handler lookup and
 * mock JWT cookie construction. */

import {vi,} from 'vitest'

/**
 * Returns a `handlerFor` function bound to the given `registerMessageHandler` mock.
 * The returned function finds the handler that was registered for a given action string.
 *
 * @example
 * const registerMessageHandler = vi.hoisted(() => vi.fn());
 * const handlerFor = makeHandlerFinder(registerMessageHandler);
 * // In tests:
 * const handler = handlerFor('toolbox-cache');
 */
export function makeHandlerFinder (registerMock: ReturnType<typeof vi.fn>,) {
	return function handlerFor (action: string,) {
		const call = registerMock.mock.calls.find((call: unknown[],) => call[0] === action)
		if (!call) {
			throw new Error(`No handler registered for action: ${action}`,)
		}
		return call[1]
	}
}

/**
 * Creates a minimal mock browser cookie whose value is a JWT with the given payload.
 * The token is not signed; only the header and payload portions are present.
 *
 * @example
 * cookies.get.mockResolvedValue(mockJwtCookie({sub: 't2_user'}));
 */
export function mockJwtCookie (payload: Record<string, unknown>,) {
	return {value: `header.${btoa(JSON.stringify(payload,),)}.sig`,}
}
