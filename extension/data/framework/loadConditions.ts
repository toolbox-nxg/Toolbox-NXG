/** Pre-flight checks run during Toolbox initialization: load condition validation. */

import browser from 'webextension-polyfill'

import {getUserDetails,} from '../api/resources/me'
import {delay,} from '../util/data/async'
import {isUserLoggedInQuick,} from '../util/infra/platform'
import {getSettingAsync, setSettingAsync,} from '../util/persistence/settings'
import {utils,} from './moduleIds'

/**
 * Decides whether Toolbox should keep loading: confirms a user is logged in,
 * that we haven't already initialized in this window, and that we're not in a
 * Firefox incognito window. A `false` result means init should stop early.
 * @param tries Number of attempts to read a logged-in user (default 3).
 */
export async function checkLoadConditions (tries = 3,) {
	// Make a quick check for signs of life before sending off API requests to
	// get information about the logged-in user
	if (!isUserLoggedInQuick()) {
		if (tries < 1) {
			// We've tried a bunch of times and still don't have anything, so
			// assume there's no logged-in user
			throw new Error('Did not detect a logged in user, Toolbox-NXG will not start',)
		} else {
			// Give it another go
			await delay(500,)
			return checkLoadConditions(tries - 1,)
		}
	}

	// When Firefox updates the extension, content scripts get reloaded but old elements remain on
	// the page, which Toolbox doesn't handle well. The `toolbox` class on the body marks such a
	// stale page so we can warn the user to reload.
	if (document.body.classList.contains('toolbox',)) {
		document.body.setAttribute(
			'toolbox-warning',
			'This page must be reloaded for Toolbox-NXG to function correctly.',
		)
		throw new Error('Toolbox-NXG has already been loaded in this window',)
	}

	// https://bugzilla.mozilla.org/show_bug.cgi?id=1380812#c7
	// https://github.com/toolbox-team/reddit-moderator-toolbox/issues/98
	if (navigator.userAgent.includes('Firefox',) && browser.extension.inIncognitoContext) {
		throw new Error('Firefox is in Incognito mode, Toolbox-NXG will not work',)
	}

	// Check that we have details about the current user
	let userDetails
	try {
		userDetails = await getUserDetails()
	} catch (error) {
		throw new Error('Failed to fetch user details', {cause: error,},)
	}
	if (!userDetails || userDetails.constructor !== Object || !Object.keys(userDetails,).length) {
		throw new Error(`Fetched user details are invalid: ${userDetails}`,)
	}

	// Write a setting and read back its value, if this fails something is wrong
	const echoValue = Math.random()
	try {
		await setSettingAsync(utils, 'echoTest', echoValue,)
	} catch (error) {
		throw new Error('Failed to write to settings', {cause: error,},)
	}
	const echoResult = await getSettingAsync(utils, 'echoTest',) as number
	if (echoResult !== echoValue) {
		throw new Error(`Settings read/write inconsistent: expected ${echoValue}, received ${echoResult}`,)
	}
}
