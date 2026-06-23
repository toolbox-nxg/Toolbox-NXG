/** Derives the moderation status of a Reddit thing (comment or submission) for TBComment/TBSubmission. */

import type {ThingModData,} from '../../../api/resources/things'
import {timeConverterRead,} from '../../../util/data/time'
import type {ThingStatus,} from './types'

/**
 * Derives the moderation status and a human-readable "by <mod> on <date>" string from a raw Reddit
 * comment or submission data object. Comments and submissions expose the same moderation fields
 * (`spam` / `removed` / `approved` / `ban_note`), so both components share this.
 * @param thing The raw Reddit comment or submission data object.
 * @returns `status` - one of `'neutral' | 'approved' | 'removed' | 'spammed'`; `actionByOn` - the
 *          "by <mod> on <date>" string, with the ban note appended when present.
 */
export function deriveThingStatus (thing: ThingModData,): {status: ThingStatus; actionByOn: string} {
	let status: ThingStatus = 'neutral'
	let actionByOn = ''
	if (thing.spam) {
		status = 'spammed'
		actionByOn = `by ${thing.banned_by} on ${timeConverterRead(thing.banned_at_utc ?? 0,)}`
	} else if (thing.removed) {
		status = 'removed'
		actionByOn = `by ${thing.banned_by} on ${timeConverterRead(thing.banned_at_utc ?? 0,)}`
	} else if (thing.approved) {
		status = 'approved'
		actionByOn = `by ${thing.approved_by} on ${timeConverterRead(thing.approved_at_utc ?? 0,)}`
	} else if (thing.ban_note && !thing.spam && !thing.removed && !thing.approved) {
		status = 'removed'
		actionByOn = `${thing.banned_by ? `by ${thing.banned_by}` : ''} on ${
			timeConverterRead(thing.banned_at_utc ?? 0,)
		} [${thing.ban_note}]`
	}
	return {status, actionByOn,}
}
