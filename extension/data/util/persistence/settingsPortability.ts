/** Exports and imports Toolbox settings to/from a private subreddit wiki page. */

import {postToWiki, readFromWiki,} from '../../api/resources/wiki'
import {utils,} from '../../framework/moduleIds'
import {purifyObject,} from '../data/purify'
import {getTime,} from '../data/time'
import createLogger from '../infra/logging'
import {getWikiReadPath, getWikiWritePaths,} from '../wiki/wikiPaths'
import {getSettings, updateSettings, writeSettings,} from './settings'

const log = createLogger('TBSettingsPortability',)

/**
 * Backs up all current settings to the `tbsettings` wiki page of the given subreddit.
 * Keys are stripped of the `Toolbox.` prefix before writing.
 */
export async function exportSettings (subreddit: string,): Promise<void> {
	const settingsObject = await getSettings()

	// `getSettings()` is the heterogeneous (`any`-valued) settings store; treat each value
	// as `unknown` here so the assembled backup object is typed rather than `any`.
	const backupObject: Record<string, unknown> = Object.fromEntries(
		(Object.entries(settingsObject,) as [string, unknown,][])
			.map(([key, value,],): [string, unknown,] => [key.replace('Toolbox.', '',), value,])
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
	await updateSettings({
		'Toolbox.Modbar.lastExport': getTime(),
		'Toolbox.Utils.settingSub': subreddit,
	},)
}

/**
 * Restores settings from the `tbsettings` wiki page of the given subreddit.
 * Sanitizes the imported data with DOMPurify before writing.
 * @throws When the imported settings cannot be verified (e.g. version too old or wiki unreadable).
 */
export async function importSettings (subreddit: string,): Promise<void> {
	const page = await getWikiReadPath('userSettings', subreddit,)
	const response = await readFromWiki<Record<string, unknown>>(subreddit, page, true,)
	if (!response.ok) {
		log.debug('Error loading wiki page',)
		// Throw rather than return: the caller reports success on a silent return,
		// so a failed read must surface as an error the dialog can show.
		throw new Error(`Could not read settings backup from /r/${subreddit} (${response.reason})`,)
	}
	purifyObject(response.data,)
	const data = response.data

	// The backup stores keys with the `Toolbox.` prefix stripped, so the version
	// lives under `${utils}.lastVersion` (camelCase, matching how it is written).
	const rawVersion = data[`${utils}.lastVersion`]
	const lastVersion = typeof rawVersion === 'number' ? rawVersion : 0
	if (lastVersion < 300) {
		log.debug('Cannot import from a toolbox version under 3.0',)
		throw new Error('Settings backup is from an unsupported Toolbox version (older than 3.0) or is unversioned',)
	}

	const doNotImport = [
		'oldreddit.enabled',
		'Utils.settingSub',
	]

	// Restore is a full overwrite, but keys in `doNotImport` must keep their
	// current stored value rather than being dropped by the overwrite.
	const current = await getSettings()
	const newSettings = Object.fromEntries(
		Object.entries(data,)
			.filter(([key,],) => !(doNotImport.includes(key,)))
			.map(([key, value,],) => [`Toolbox.${key}`, value,]),
	)
	for (const key of doNotImport) {
		const fullKey = `Toolbox.${key}`
		if (current[fullKey] !== undefined) {
			newSettings[fullKey] = current[fullKey]
		}
	}

	await writeSettings(newSettings,)
}
