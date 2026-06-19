/** Exhaustiveness helper for discriminated unions. */

/**
 * Asserts that a code path is unreachable. Used in the `default` branch of a switch
 * over a discriminated union: if every variant is handled, `value` narrows to `never`
 * and this compiles; if a new variant is added without a matching case, `value` is no
 * longer `never` and the call becomes a **compile error**, forcing the new case to be
 * handled. Also throws at runtime as a defensive backstop for malformed data.
 * @param value The value that should have been narrowed away by prior cases.
 * @param label Optional context for the runtime error message.
 */
export function assertNever (value: never, label = 'value',): never {
	throw new Error(`Unhandled ${label}: ${JSON.stringify(value,)}`,)
}
