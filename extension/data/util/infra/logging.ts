/** Toolbox logger factory: creates per-module colored console loggers. */

// Per-level console styling, keyed by log type name
const logTypes = {
	debug: {
		color: '#fff',
		background: '#387fa780',
	},
	info: {
		color: '#fff',
		background: '#38a76280',
	},
	warn: {
		color: '#fff',
		background: '#ce821a80',
		text: 'warning',
	},
	error: {
		color: '#fff',
		background: '#eb394180',
	},
}

/** One of the supported log message levels. */
type LogType = keyof typeof logTypes

/**
 * Emits a single log entry at the given level.
 * @private
 * @param caller Identifier of the calling code.
 * @param type Which log level/type to use.
 * @param values Arbitrary content passed through to the console
 */
function log (caller: string, type: LogType, ...values: any[]) {
	// Get the appropriate styles for this log type, and send the message
	const config = logTypes[type]
	const {color, background,} = config
	const text = ('text' in config) ? config.text : type
	// Look up the method at call time so vi.spyOn(console, ...) intercepts it.
	console[type](
		// First part of the message line
		`tb: %c[${caller}] %c${text}`,
		// Caller style
		'font-weight: bold',
		// Styles for the type name
		`color: ${color}; background: ${background}; padding: 0 3px; border-radius: 3px`,
		// The rest of the arguments are passed through unmodified
		...values,
	)
}

/** A logger scoped to a named caller. */
type Logger = {
	[type in LogType]: (...values: any[]) => void
}

/**
 * Builds a logger bound to a particular caller.
 * @param caller Label for the module or code section using the logger; shown in
 * the console next to every message it emits.
 */
export default function createLogger (caller: string,) {
	// Create a new object
	const logger: Partial<Logger> = {}
	// The object gets a function for every log type
	for (const type of Object.keys(logTypes,) as LogType[]) {
		// `this` arg is not provided
		logger[type] = log.bind(undefined, caller, type,)
	}
	return logger as Logger
}
