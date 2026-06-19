/** DOM integration for the Modbar module - mounts the ModBar React component into the page body. */

import {notifier, utils,} from '../../framework/moduleIds'
import {getModuleSettingAsync,} from '../../util/persistence/settings'
import {link,} from '../../util/reddit/pageContext'
import {mountReactInLightBody,} from '../../util/ui/reactMount'
import {type CounterState, getCounterState,} from '../notifier/store'
import {ModBar,} from './components/ModBar'
import type {ModbarSettings,} from './settings'

/**
 * Fetches all data needed by the modbar, then mounts the ModBar component into the page body.
 * @param s The resolved modbar settings.
 * @param setSetting Callback to persist setting changes back through the module system.
 * @param onModbarMount Called once after the bar first renders (resolves the `modbarExists` promise).
 * @returns An object with a `dispose` function that unmounts the bar.
 */
export async function createModbarHandlers (
	s: ModbarSettings,
	setSetting: (key: 'modbarHidden', value: boolean,) => void,
	onModbarMount: () => void,
): Promise<{dispose: () => void}> {
	const {
		shortcuts,
		compactHide,
		unmoderatedOn,
		enableModSubs,
		enableOldNewToggle,
		customCSS,
		modbarHidden,
		subredditColorSalt,
	} = s

	const [
		debugMode,
		modSubreddits,
		unmoderatedSubreddits,
		modqueueCount,
		unmoderatedCount,
		modmailCount,
		notifierEnabled,
	] = await Promise.all([
		getModuleSettingAsync(utils, 'debugMode', false,),
		getModuleSettingAsync(notifier, 'modSubreddits', 'mod',),
		getModuleSettingAsync(notifier, 'unmoderatedSubreddits', 'mod',),
		getModuleSettingAsync(notifier, 'modqueueCount', 0,),
		getModuleSettingAsync(notifier, 'unmoderatedCount', 0,),
		getModuleSettingAsync(notifier, 'modmailCount', 0,),
		getModuleSettingAsync(notifier, 'enabled', true,),
	],)

	const modmailUrl = 'https://www.reddit.com/mail/all'
	const modQueueUrl = link(`/r/${modSubreddits}/about/modqueue`,)
	const unModQueueUrl = unmoderatedOn
		? link(`/r/${unmoderatedSubreddits}/about/unmoderated`,)
		: null

	const initialCounters: CounterState = {
		...getCounterState(),
		modqueueCount,
		unmoderatedCount,
		modmailCount,
	}

	const {unmount,} = mountReactInLightBody(
		<ModBar
			shortcuts={shortcuts}
			compactHide={compactHide}
			unmoderatedOn={unmoderatedOn}
			enableModSubs={enableModSubs}
			enableOldNewToggle={enableOldNewToggle}
			customCSS={customCSS}
			subredditColorSalt={subredditColorSalt}
			initialHidden={compactHide || modbarHidden}
			modmailUrl={modmailUrl}
			modQueueUrl={modQueueUrl}
			unModQueueUrl={unModQueueUrl}
			notifierEnabled={notifierEnabled}
			debugMode={debugMode}
			initialCounters={initialCounters}
			setSetting={setSetting}
			onMount={onModbarMount}
		/>,
		'ModBar',
	)

	return {dispose: unmount,}
}
