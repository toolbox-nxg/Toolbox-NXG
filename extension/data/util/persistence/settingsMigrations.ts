/** Version-gated settings migrations and module key renames run once per update. */

import browser from 'webextension-polyfill'

import {getCurrentUser,} from '../../api/resources/me'
import {setWikiPageSettings,} from '../../api/resources/wiki'
import type {TbCacheForceTimeoutMessage,} from '../../background/messages'
import {queueTools, syntax, utils,} from '../../framework/moduleIds'
import {syntaxThemes,} from '../../modules/syntax/syntaxThemes'
import {negativeTextFeedback,} from '../../store/feedback'
import createLogger from '../infra/logging'
import {getLastVersion, versionNumber,} from '../infra/version'
import {navigateTo,} from '../ui/navigation'
import {getCache, setCache,} from './cache'
import {getSettingAsync, getSettings, setSettingAsync, updateSettings,} from './settings'

const log = createLogger('Init',)

async function setWikiPrivate (subreddit: string, page: string, failAlert: boolean,) {
	await setWikiPageSettings({
		subreddit,
		page,
		listed: 'true',
		permlevel: '2',
	},)
		.catch(() => {
			if (failAlert) {
				negativeTextFeedback('error setting wiki page to mod only access',)
				navigateTo(`https://www.reddit.com/r/${subreddit}/wiki/settings/${page}`,)
			} else {
				log.debug('error setting wiki page to mod only access',)
			}
		},)
}

/**
 * Runs one-time settings migrations on the first launch of a new Toolbox
 * version, and keeps the "cacheName" cache aligned with the logged-in user.
 */
export async function doSettingsUpdates () {
	const settingsName = utils

	const currentUser = await getCurrentUser()
	let lastVersion = await getLastVersion()

	const cacheName = await getCache(utils, 'cacheName', '',)

	// Update cache if we're logged in as someone else
	if (cacheName !== currentUser) {
		await setCache(settingsName, 'cacheName', currentUser,)

		// Force refresh of timed cache
		void browser.runtime.sendMessage({action: 'toolbox-cache-force-timeout',} satisfies TbCacheForceTimeoutMessage,)
	}

	// Extra checks on old faults
	if (typeof lastVersion !== 'number') {
		lastVersion = parseInt(lastVersion, 10,)
		await setSettingAsync(settingsName, 'lastVersion', lastVersion,)
	}

	let shortLength = await getSettingAsync(settingsName, 'shortLength', 15,) as number | string
	let longLength = await getSettingAsync(settingsName, 'longLength', 45,) as number | string

	if (typeof shortLength !== 'number') {
		shortLength = parseInt(shortLength, 10,)
		await setSettingAsync(settingsName, 'shortLength', shortLength,)
	}

	if (typeof longLength !== 'number') {
		longLength = parseInt(longLength, 10,)
		await setSettingAsync(settingsName, 'longLength', longLength,)
	}

	// First run changes for all releases.
	if (versionNumber > lastVersion) {
		// These need to happen for every version change
		await setSettingAsync(settingsName, 'lastVersion', versionNumber,) // set last version to this version.

		// This should be a per-release section of stuff we want to change in each update.  Like setting/converting data/etc.  It should always be removed before the next release.

		// Start: version changes.
		// reportsThreshold should be 0 by default
		if (lastVersion < 50101) {
			await setSettingAsync(queueTools, 'reportsThreshold', 0,)
		}

		// Clean up removed settings - it doesn't really matter what version
		// we're coming from, we just want to make sure these removed settings
		// aren't cluttering up storage
		const keysToDelete = [
			// Obsolete new-modmail settings
			'Toolbox.NewModMail.searchhelp',
			'Toolbox.NewModMail.checkForNewMessages',

			// Obsolete beta-mode setting (superseded by dedicated beta builds)
			'Toolbox.Utils.betaMode',

			// Obsolete old-modmail-pro settings
			...[
				'inboxStyle',
				'filteredSubs',
				'defaultCollapse',
				'noRedModmail',
				'highlightNew',
				'expandReplies',
				'hideInviteSpam',
				'autoLoad',
				'fadeRecipient',
				'subredditColor',
				'resThreadedModmail',
				'subredditColorSalt',
				'customLimit',
				'filterBots',
				'botsToFilter',
				'newTabLinks',
				'lastVisited',
				'replied',
				'threadProcessRate',
				'entryProcessRate',
				'chunkProcessSize',
				'twoPhaseProcessing',
			].map((setting,) => `Toolbox.ModMail.${setting}`),

			'Toolbox.Comments.commentsAsFullPage',

			// fmod (/me/f/mod/) support removed; always use /r/mod/
			'Toolbox.Notifier.modSubredditsFMod',
			'Toolbox.Notifier.unmoderatedSubredditsFMod',
		]
		await updateSettings(Object.fromEntries(keysToDelete.map((key,) => [key, undefined,]),),)

		// Reset selectedTheme if it's a CM5 theme name no longer valid in CM6
		const storedTheme = await getSettingAsync(syntax, 'selectedTheme', 'dracula',) as string
		if (storedTheme && !(syntaxThemes as readonly string[]).includes(storedTheme,)) {
			await setSettingAsync(syntax, 'selectedTheme', 'dracula',)
		}

		// End: version changes.

		// This is a super extra check to make sure the wiki page for settings export really is private.
		const settingSubEnabled = await getSettingAsync(utils, 'settingSub', '',) as string
		if (settingSubEnabled) {
			void setWikiPrivate(settingSubEnabled, 'tbsettings', false,)
		}

		// This should be left for every new release. If there is a new beta feature people want, it should be opt-in, not left to old settings.
		await setSettingAsync(settingsName, 'debugMode', false,)
	}

	// Migrate storage keys from old module IDs to new ones.
	// These prefixes changed when module IDs were renamed for consistency.
	const moduleKeyMigrations: [string, string,][] = [
		['Toolbox.BButtons.', 'Toolbox.BetterButtons.',],
		['Toolbox.TBConfig.', 'Toolbox.Config.',],
		['Toolbox.DTagger.', 'Toolbox.DomainTagger.',],
		['Toolbox.HButton.', 'Toolbox.HistoryButton.',],
		['Toolbox.ModMacros.', 'Toolbox.Macros.',],
		['Toolbox.CommentNuke.', 'Toolbox.NukeComments.',],
		['Toolbox.oldreddit.', 'Toolbox.OldReddit.',],
		['Toolbox.PNotes.', 'Toolbox.SubredditNotes.',],
		['Toolbox.queueOverlay.', 'Toolbox.QueueOverlay.',],
		['Toolbox.RReasons.', 'Toolbox.RemovalReasons.',],
		['Toolbox.support.', 'Toolbox.Support.',],
		['Toolbox.QueueEnhancements.', 'Toolbox.ModViewEnhancements.',],
	]

	const splitModuleSettingMigrations: [string, string, string[],][] = [
		[
			'QueueTools',
			'MassModeration',
			[
				'autoActivate',
				'expandReports',
				'hideActionedItems',
				'linkToQueues',
				'reportsOrder',
				'reportsThreshold',
				'reportsAscending',
				'groupCommentsOnModPage',
			],
		],
		[
			// QueueEnhancements was later renamed to ModViewEnhancements (see moduleKeyMigrations);
			// migrate legacy QueueTools installs straight to the current id so they aren't left on a
			// dead module (the rename loop above only sees the original snapshot, not these writes).
			'QueueTools',
			'ModViewEnhancements',
			[
				'subredditColor',
				'subredditColorSalt',
				'highlightNegativePosts',
				'showAutomodActionReason',
				'botCheckmark',
				'highlightAutomodMatches',
			],
		],
	]

	const allSettings = await getSettings()
	const migratedWrites: Record<string, unknown> = {}
	const migratedDeletes: string[] = []

	for (const [oldPrefix, newPrefix,] of moduleKeyMigrations) {
		for (const [key, value,] of Object.entries(allSettings,)) {
			if (key.startsWith(oldPrefix,)) {
				migratedWrites[key.replace(oldPrefix, newPrefix,)] = value
				migratedDeletes.push(key,)
			}
		}
	}

	// QueueTools was split into QueueTools, MassModeration, and
	// ModViewEnhancements (formerly QueueEnhancements). Preserve relevant old preferences for the new modules.
	for (const [oldModule, newModule, settings,] of splitModuleSettingMigrations) {
		for (const setting of settings) {
			const oldKey = `Toolbox.${oldModule}.${setting}`
			const newKey = `Toolbox.${newModule}.${setting}`
			if (oldKey in allSettings) {
				if (!(newKey in allSettings)) {
					migratedWrites[newKey] = allSettings[oldKey]
				}
				migratedDeletes.push(oldKey,)
			}
		}
	}

	// QueueTools "showActionReason" (a single on/off for the recent-actions table) was replaced by the
	// per-item-state toggles showRecentActionsOnApproved / showRecentActionsOnRemoved. Preserve an
	// explicit "off" by turning both new toggles off; otherwise the new defaults (on) apply.
	const showActionReasonKey = 'Toolbox.QueueTools.showActionReason'
	if (showActionReasonKey in allSettings) {
		if (allSettings[showActionReasonKey] === false) {
			for (
				const key of [
					'Toolbox.QueueTools.showRecentActionsOnApproved',
					'Toolbox.QueueTools.showRecentActionsOnRemoved',
				]
			) {
				if (!(key in allSettings)) { migratedWrites[key] = false }
			}
		}
		migratedDeletes.push(showActionReasonKey,)
	}

	// The Notifier became always-enabled so its poll keeps the modbar counters fresh. Its old
	// on/off toggle is replaced by "showNotifications", which silences notifications only.
	// Carry an explicit "off" across so previously-disabled users don't suddenly start getting
	// notifications (modNotifications defaults to on); an old "on"/absent leaves the new default.
	const oldNotifierEnabledKey = 'Toolbox.Notifier.enabled'
	if (oldNotifierEnabledKey in allSettings) {
		const newKey = 'Toolbox.Notifier.showNotifications'
		if (allSettings[oldNotifierEnabledKey] === false && !(newKey in allSettings)) {
			migratedWrites[newKey] = false
		}
		migratedDeletes.push(oldNotifierEnabledKey,)
	}

	const oldQueueToolsEnabled = allSettings['Toolbox.QueueTools.enabled'] as unknown
	if (oldQueueToolsEnabled !== undefined) {
		for (const newModule of ['MassModeration', 'ModViewEnhancements',]) {
			const newKey = `Toolbox.${newModule}.enabled`
			if (!(newKey in allSettings)) {
				migratedWrites[newKey] = oldQueueToolsEnabled
			}
		}
	}

	if (Object.keys(migratedWrites,).length > 0 || migratedDeletes.length > 0) {
		await updateSettings({
			...migratedWrites,
			...Object.fromEntries(migratedDeletes.map((k,) => [k, undefined,]),),
		},)
	}
}
