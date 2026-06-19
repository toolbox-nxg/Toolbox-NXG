/** Registers the Notifier module, which polls Reddit for new modqueue and modmail items and fires browser notifications. */

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {modbar,} from '../../framework/moduleIds'
import {minutesToMilliseconds,} from '../../util/data/time'
import {isEmbedded,} from '../../util/infra/platform'
import {getModuleSettingAsync,} from '../../util/persistence/settings'
import {createNotifierHandlers, toModmailCategoryCount,} from './poll'
import {NotifierSettings, settings,} from './settings'

export default new Module<NotifierSettings>({
	name: 'Notifier',
	id: 'Notifier',
	enabledByDefault: true,
	settings,
}, async function init (this: Module<NotifierSettings>, {
	modNotifications,
	unmoderatedNotifications,
	consolidatedMessages,
	modSubreddits,
	unmoderatedSubreddits,
	checkInterval,
	modqueueCount,
	unmoderatedCount,
	modmailCount,
	modmailCategoryCount,
}: NotifierSettings,) {
	if (isEmbedded) {
		return
	}

	const lifecycle = createLifecycle()

	const unmoderatedOn = await getModuleSettingAsync(modbar, 'unmoderatedOn', true,)
	const checkIntervalMillis = minutesToMilliseconds(checkInterval,)

	const {getmessages, handleCounterUpdate,} = createNotifierHandlers({
		modNotifications,
		unmoderatedNotifications,
		consolidatedMessages,
		modSubreddits,
		unmoderatedSubreddits,
		unmoderatedOn,
		checkIntervalMillis,
		modqueueCount,
		unmoderatedCount,
		modmailCount,
		modmailCategoryCount: toModmailCategoryCount(modmailCategoryCount,),
	}, this,)

	lifecycle.on(window, 'TB_UPDATE_COUNTERS', handleCounterUpdate,)
	lifecycle.interval(getmessages, checkIntervalMillis,)

	getmessages()

	return lifecycle.cleanup
},)
