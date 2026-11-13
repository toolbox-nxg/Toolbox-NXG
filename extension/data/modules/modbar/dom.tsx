/** DOM integration for the Modbar module - mounts the ModBar React component into the page body. */

import {Provider,} from 'react-redux'

import {notifier, utils,} from '../../framework/moduleIds'
import store from '../../store'
import {getModuleSettingAsync,} from '../../util/persistence/settings'
import {link,} from '../../util/reddit/pageContext'
import {mountReactInLightBody,} from '../../util/ui/reactMount'
import {getAccountState,} from '../notifier/moduleapi'
import {type CounterState, getCounterState,} from '../notifier/store'
import {ModBar,} from './components/ModBar'
import {createApiBudgetHandlers,} from './features/apiBudget'
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
		showCounters,
		unmoderatedOn,
		enableModSubs,
		enableOldNewToggle,
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
		// Last counts seen by this tab's account; settings are shared across Firefox
		// containers, so these come from the per-account cache instead.
		getAccountState('modqueueCount',),
		getAccountState('unmoderatedCount',),
		getAccountState('modmailCount',),
		// The Notifier is always enabled now (its poll feeds these counters), so the
		// hover tooltip keys off whether notifications are on rather than a module toggle.
		getModuleSettingAsync(notifier, 'showNotifications', true,),
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

	// The API budget readout is a debug aid; only poll for it when debug mode is on.
	const apiBudget = debugMode ? createApiBudgetHandlers() : null

	// The Provider lets the bar follow settings changed in other tabs (collapse state,
	// context menu side) through the settings store's storage listener.
	const {unmount,} = mountReactInLightBody(
		<Provider store={store}>
			<ModBar
				shortcuts={shortcuts}
				compactHide={compactHide}
				showCounters={showCounters}
				unmoderatedOn={unmoderatedOn}
				enableModSubs={enableModSubs}
				enableOldNewToggle={enableOldNewToggle}
				subredditColorSalt={subredditColorSalt}
				initialHidden={modbarHidden}
				modmailUrl={modmailUrl}
				modQueueUrl={modQueueUrl}
				unModQueueUrl={unModQueueUrl}
				notifierEnabled={notifierEnabled}
				debugMode={debugMode}
				{...(apiBudget ? {apiBudget: apiBudget.store,} : {})}
				initialCounters={initialCounters}
				setSetting={setSetting}
				onMount={onModbarMount}
			/>
		</Provider>,
		'ModBar',
	)

	return {
		dispose: () => {
			unmount()
			void apiBudget?.cleanup()
		},
	}
}
