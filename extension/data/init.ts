/** Extension entry point: validates load conditions, registers all modules, and starts the Toolbox runtime. */

import {createElement,} from 'react'
import browser from 'webextension-polyfill'

// Bundle the shared base stylesheets so they ship with the extension
import './css/base.css'
import './css/classic.css'
import './css/reddit-integration.css'
import './css/toolbox-buttons.css'

import AppRoot from './shared/app/AppRoot'

import {initProposalsRuntime,} from './modules/shared/proposals/setup'

import {registerContainerRequestExecutor,} from './api/transport/containerExecutor'
import {checkLoadConditions,} from './framework/loadConditions'
import TBModule from './framework/moduleRegistry'
import {createRateLimitNotice,} from './framework/rateLimitNotice'
import createLogger from './util/infra/logging'
import {isOldReddit,} from './util/infra/platform'
import {toolboxVersionClassNames,} from './util/infra/version'
import {clearCache,} from './util/persistence/cache'
import {doSettingsUpdates,} from './util/persistence/settingsMigrations'
import {setupMessageBridge,} from './util/reddit/events'
import {watchForURLChanges,} from './util/reddit/pageContext'
import {syncDarkClass,} from './util/ui/colorScheme'
import {delegate, documentInteractive,} from './util/ui/dom'
import {reactRenderer,} from './util/ui/reactMount'

import Announcements from './modules/announcements'
import BetterButtons from './modules/betterbuttons'
import Comment from './modules/comment'
import CommentActions from './modules/commentActions'
import CommentTriage from './modules/commenttriage'
import Config from './modules/config'
import CustomCss from './modules/customcss'
import Devtools from './modules/devtools'
import DomainTagger from './modules/domaintagger'
import General from './modules/general'
import HistoryButton from './modules/historybutton'
import Macros from './modules/macros'
import MassModeration from './modules/massmoderation'
import ModActions from './modules/modactions'
import Modbar from './modules/modbar'
import ModButton from './modules/modbutton'
import Modmail from './modules/modmail'
import ModMatrix from './modules/modmatrix'
import ModViewEnhancements from './modules/modviewenhancements'
import NativeModLog from './modules/nativemodlog'
import Notifier from './modules/notifier'
import NukeComments from './modules/nukecomments'
import OldReddit from './modules/oldreddit'
import Profile from './modules/profile'
import Proposals from './modules/proposals'
import QueueOverlay from './modules/queue_overlay'
import QueueTools from './modules/queuetools'
import RemovalReasons from './modules/removalreasons'
import Shreddit from './modules/shreddit'
import SubredditNotes from './modules/subredditnotes'
import Support from './modules/support'
import Syntax from './modules/syntax'
import Usernotes from './modules/usernotes'

const log = createLogger('Init',)

// On old Reddit, clear the cache when the user switches accounts, logs out,
// or accepts/resigns a moderator role - any of these invalidates cached mod state.
if (isOldReddit) {
	delegate(
		document.body,
		'click',
		'#RESAccountSwitcherDropdown .accountName, #header-bottom-right .logout, .toggle.moderator .option',
		() => {
			void clearCache()
		},
	)
}

/** Runs the full startup sequence: load checks, settings migrations, module registration and init. */
async function startToolbox () {
	// Firefox Multi-Account Containers: answer background-forwarded requests from this frame so
	// they carry this tab's container cookies. Must precede every request, including the user
	// details fetch in checkLoadConditions. No-op outside the Firefox bundle.
	registerContainerRequestExecutor()

	// Ensure that other conditions are met, and return early if not
	try {
		await checkLoadConditions()
	} catch (error) {
		log.error('Load condition not met:', error,)
		return
	}

	// Bridge background messages to window CustomEvents so modules can use
	// window.addEventListener for cross-tab signals (e.g. TB_UPDATE_COUNTERS,
	// toolbox-url-changed) without knowing about the browser messaging layer.
	setupMessageBridge()

	// Install the proposals (training-mode) runtime so moderation actions can be
	// captured for review before any module wires its action surfaces.
	initProposalsRuntime()

	// Add relevant CSS classes to the page
	document.body.classList.add('toolbox',)

	// new profiles have some weird css going on. This remedies the weirdness...
	window.addEventListener('TBNewPage', (event,) => {
		if (event.detail.pageType === 'userProfile') {
			document.body.classList.add('toolbox-profile',)
		} else {
			document.body.classList.remove('toolbox-profile',)
		}
	},)

	document.documentElement.classList.add('toolbox-scope',)
	document.body.classList.add('toolbox-scope',)

	// Public hooks for subreddit stylesheets: `toolbox` alone also matches classic Toolbox, so
	// these let a stylesheet scope fixes to this extension, or to one major/minor version of it.
	document.documentElement.classList.add(...toolboxVersionClassNames,)
	document.body.classList.add(...toolboxVersionClassNames,)

	// On old Reddit the page stays light regardless of OS theme. On shreddit, follow
	// Reddit's own theme, which a moderator can set independently of the OS.
	if (!isOldReddit) { syncDarkClass() }

	// Add icon font
	const fontStyle = document.createElement('style',)
	fontStyle.textContent = `
        @font-face {
            font-family: 'Material Symbols Filled';
            font-style: normal;
            font-weight: 400;
            src: url(${browser.runtime.getURL('data/MaterialSymbols-Filled.woff2',)}) format('woff2');
        }
    `
	document.head.appendChild(fontStyle,)

	// Do version-specific setting updates and cache the current logged-in user
	await doSettingsUpdates()

	// Attach React root
	documentInteractive.then(() => {
		document.body.append(reactRenderer(createElement(AppRoot,),),)
	},).catch((error: unknown,) => log.error(error,))

	// Load feature modules and register them
	for (
		const m of [
			Devtools,
			Support,
			// Early, so the custom CSS is in place before most Toolbox UI first renders.
			CustomCss,
			Modbar,
			Config,
			BetterButtons,
			DomainTagger,
			ModMatrix,
			Syntax,
			ModButton,
			General,
			Notifier,
			Usernotes,
			NativeModLog,
			Comment,
			Macros,
			SubredditNotes,
			HistoryButton,
			RemovalReasons,
			Proposals,
			NukeComments,
			CommentTriage,
			Profile,
			QueueOverlay,
			QueueTools,
			ModViewEnhancements,
			MassModeration,
			OldReddit,
			Shreddit,
			ModActions,
			CommentActions,
			Modmail,
			Announcements,
		]
	) {
		log.debug('Registering module', m,)
		TBModule.registerModule(m,)
	}

	// Once all modules are registered, call TB.init() to run them
	await TBModule.init()

	// Modules must register their handlers during init() before we start emitting
	// events - otherwise the first page context events would be lost. init.ts is the
	// single owner of this startup order. The `TBListenerLoaded` signal tells the
	// shreddit module that every module is registered and it may run its initial scan.
	document.dispatchEvent(new CustomEvent('TBListenerLoaded',),)
	watchForURLChanges()
}

void (async () => {
	// Startup waits on the shared API budget (the user-details fetch, settings
	// migrations, module init). If that budget is spent, explain the wait instead of
	// leaving the page silently without Toolbox; removed once startup settles.
	const stopRateLimitNotice = createRateLimitNotice()
	try {
		await startToolbox()
	} finally {
		await stopRateLimitNotice()
	}
})()
