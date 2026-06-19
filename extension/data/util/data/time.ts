/** Date and time utility functions: relative time formatting, unit conversions, and timestamp formatting. */

const rtf = new Intl.RelativeTimeFormat('en', {numeric: 'auto',},)

const minute = 60_000
const hour = 60 * minute
const day = 24 * hour
const week = 7 * day
const month = 30 * day
const year = 365 * day

/** Returns a human-readable relative time string for a given date (e.g. "3 hours ago"). */
export function formatRelativeTime (date: Date,): string {
	const diff = date.getTime() - Date.now()
	const abs = Math.abs(diff,)
	if (abs < minute) {
		return rtf.format(Math.round(diff / 1000,), 'second',)
	}
	if (abs < hour) {
		return rtf.format(Math.round(diff / minute,), 'minute',)
	}
	if (abs < day) {
		return rtf.format(Math.round(diff / hour,), 'hour',)
	}
	if (abs < week) {
		return rtf.format(Math.round(diff / day,), 'day',)
	}
	if (abs < month) {
		return rtf.format(Math.round(diff / week,), 'week',)
	}
	if (abs < year) {
		return rtf.format(Math.round(diff / month,), 'month',)
	}
	return rtf.format(Math.round(diff / year,), 'year',)
}

/**
 * Formats a Unix timestamp (seconds) as a short relative time, e.g. "just now",
 * "5m ago", "3h ago", "2d ago". Used by the mod-action history popups where space
 * is tight; for full-width prose prefer {@link formatRelativeTime}.
 * @param utcSeconds Unix timestamp in seconds.
 */
export function relativeTimeShort (utcSeconds: number,): string {
	const mins = Math.floor((Date.now() - utcSeconds * 1000) / minute,)
	if (mins < 1) { return 'just now' }
	if (mins < 60) { return `${mins}m ago` }
	const hrs = Math.floor(mins / 60,)
	if (hrs < 24) { return `${hrs}h ago` }
	return `${Math.floor(hrs / 24,)}d ago`
}

/** Returns the current time in milliseconds. */
export function getTime (): number {
	return Date.now()
}

/**
 * The current time in whole epoch seconds - the unit Toolbox uses for its wiki
 * timestamps (usernotes, proposals, announcements). Truncates toward zero, which is
 * equivalent to flooring for the always-positive `Date.now()`.
 */
export function nowInSeconds (): number {
	return Math.trunc(Date.now() / 1000,)
}

/**
 * Upper bound on a plausible epoch-*second* timestamp. It corresponds to roughly
 * the year 5138, so any real Toolbox timestamp falls far below it, while an
 * epoch-*millisecond* value for any date after 1973 sits far above it. The gap
 * between the two ranges is ~1000×, leaving a wide, unambiguous margin.
 */
const maxPlausibleEpochSeconds = 1e11

/**
 * Coerces a timestamp that is meant to be in epoch seconds back to seconds,
 * repairing values that were mistakenly stored in milliseconds (e.g. a note
 * written with `Date.now()` instead of {@link nowInSeconds}). Values already in
 * the plausible-seconds range pass through untouched, so this is idempotent and
 * safe to apply to every timestamp on read.
 * @param time A timestamp that should be in epoch seconds but may be in milliseconds.
 * @returns The timestamp in epoch seconds.
 */
export function coerceEpochSeconds (time: number,): number {
	return time >= maxPlausibleEpochSeconds ? Math.floor(time / 1000,) : time
}

/** Converts minutes to milliseconds, with a minimum of one minute. */
export function minutesToMilliseconds (mins: number,): number {
	return Math.max(mins * minute, minute,)
}

/** Converts days to milliseconds. */
export function daysToMilliseconds (days: number,): number {
	return days * 86400000
}

/** Converts milliseconds to days. */
export function millisecondsToDays (milliseconds: number,): number {
	return milliseconds / 86400000
}

/** Returns the difference between two dates in a human-readable format like "1 year, 2 months". */
export function niceDateDiff (origdate: Date, newdate: Date = new Date(),): string {
	const amonth = origdate.getUTCMonth() + 1
	const aday = origdate.getUTCDate()
	const ayear = origdate.getUTCFullYear()

	const tyear = newdate.getUTCFullYear()
	const tmonth = newdate.getUTCMonth() + 1
	const tday = newdate.getUTCDate()

	let y = 1
	let mm = 1
	let d = 1
	let monthComponent = 0
	let yearComponent = 0
	let f = 28

	if (tyear % 4 === 0 && tyear % 100 !== 0 || tyear % 400 === 0) {
		f = 29
	}

	const m = [31, f, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,]

	let dyear = tyear - ayear

	let dmonth = tmonth - amonth
	if (dmonth < 0 && dyear > 0) {
		dmonth += 12
		dyear--
	}

	let dday = tday - aday
	if (dday < 0) {
		if (dmonth > 0) {
			// 0-based index of the month before tmonth in the days-per-month array.
			const ma = (tmonth - 2 + 12) % 12
			dday += m[ma]!
			dmonth--
			if (dmonth < 0) {
				dyear--
				dmonth += 12
			}
		} else {
			dday = 0
		}
	}

	let returnString = ''

	if (dyear === 0) {
		y = 0
	}
	if (dmonth === 0) {
		mm = 0
	}
	if (dday === 0) {
		d = 0
	}
	if (y === 1 && mm === 1) {
		yearComponent = 1
	}
	if (y === 1 && d === 1) {
		yearComponent = 1
	}
	if (mm === 1 && d === 1) {
		monthComponent = 1
	}
	if (y === 1) {
		returnString += dyear === 1 ? `${dyear} year` : `${dyear} years`
	}
	if (yearComponent === 1 && monthComponent === 0) {
		returnString += ' and '
	}
	if (yearComponent === 1 && monthComponent === 1) {
		returnString += ', '
	}
	if (mm === 1) {
		returnString += dmonth === 1 ? `${dmonth} month` : `${dmonth} months`
	}
	if (monthComponent === 1) {
		returnString += ' and '
	}
	if (d === 1) {
		returnString += dday === 1 ? `${dday} day` : `${dday} days`
	}
	if (returnString === '') {
		returnString = '0 days'
	}
	return returnString
}

/** Converts a Unix epoch timestamp to readable format: dd-mm-yyyy hh:mm:ss UTC */
export function timeConverterRead (UNIX_timestamp: number,): string {
	const a = new Date(UNIX_timestamp * 1000,)
	const year = a.getUTCFullYear()
	const month = `0${a.getUTCMonth() + 1}`.slice(-2,)
	const date = `0${a.getUTCDate()}`.slice(-2,)
	const hour = `0${a.getUTCHours()}`.slice(-2,)
	const min = `0${a.getUTCMinutes()}`.slice(-2,)
	const sec = `0${a.getUTCSeconds()}`.slice(-2,)
	return `${date}-${month}-${year} ${hour}:${min}:${sec} UTC`
}
