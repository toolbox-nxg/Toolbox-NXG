/** Exports and imports Toolbox settings to/from a private subreddit wiki page. */

import {postToWiki, readFromWiki,} from '../../api/resources/wiki'
import {purifyObject,} from '../data/purify'
import createLogger from '../infra/logging'
import {getWikiReadPath, getWikiWritePaths,} from '../wiki/wikiPaths'
import {getSettings, writeSettings,} from './settings'

const log = createLogger('TBSettingsPortability',)

/**
 * Backs up all current settings to the `tbsettings` wiki page of the given subreddit.
 * Keys are stripped of the `Toolbox.` prefix before writing.
 */
export async function exportSettings (subreddit: string,): Promise<void> {
	const settingsObject = await getSettings()

	const backupObject = Object.fromEntries(
		Object.entries(settingsObject,)
			.map(([key, value,],) => [key.replace('Toolbox.', '',), value,])
			.filter(([key,],) => key !== 'Storage.setting')
			.filter(([_key, value,],) => value != null),
	)

	// The canonical NXG page is written first (fatal on failure); the legacy
	// mirror, when 6.x compatibility is on, is best-effort.
	const [canonicalPage, ...mirrorPages] = await getWikiWritePaths('userSettings', subreddit,)
	await postToWiki(subreddit, canonicalPage!, backupObject, 'exportSettings', true, false,)
	for (const page of mirrorPages) {
		try {
			await postToWiki(subreddit, page, backupObject, 'exportSettings', true, false,)
		} catch {
			// Non-fatal: the canonical backup succeeded; the next export
			// refreshes the mirror.
		}
	}
	await writeSettings({'Toolbox.Modbar.lastExport': Date.now(),},)
}

/**
 * Restores settings from the `tbsettings` wiki page of the given subreddit.
 * Sanitizes the imported data with DOMPurify before writing.
 * @throws When the imported settings cannot be verified (e.g. version too old or wiki unreadable).
 */
export async function importSettings (subreddit: string,): Promise<void> {
	const page = await getWikiReadPath('userSettings', subreddit,)
	const response = await readFromWiki<Record<string, any>>(subreddit, page, true,)
	if (!response.ok) {
		log.debug('Error loading wiki page',)
		return
	}
	purifyObject(response.data,)
	const data = response.data

	if ((data['Utils.lastversion'] ?? 0) < 300) {
		log.debug('Cannot import from a toolbox version under 3.0',)
		return
	}

	const doNotImport = [
		'oldreddit.enabled',
	]

	const newSettings = Object.fromEntries(
		Object.entries(data,)
			.filter(([key,],) => !(doNotImport.includes(key,)))
			.map(([key, value,],) => [`Toolbox.${key}`, value,]),
	)

	await writeSettings(newSettings,)
}
