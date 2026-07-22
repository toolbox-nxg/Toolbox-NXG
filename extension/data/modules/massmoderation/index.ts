/** Entry point for the Mass Moderation module - adds queue tools to old Reddit moderation pages. */

import './massmoderation.css'

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {isModpage,} from '../../util/reddit/pageContext'
import {createMassModerationSetup, createModtoolsActivator,} from './oldReddit/queueModtools'
import {settings,} from './settings'
import type {MassModerationSettings,} from './settings'

const self: Module<MassModerationSettings> = new Module({
	name: 'Mass Moderation',
	id: 'MassModeration',
	docSlug: 'massmoderation',
	enabledByDefault: true,
	oldReddit: true,
	settings,
}, init,)

function init (options: MassModerationSettings,) {
	const lifecycle = createLifecycle()
	const body = document.body

	// Both factory calls happen after createLifecycle() above - ordering is correct.
	const setup = createMassModerationSetup()
	lifecycle.mount(setup.cleanup,)

	// activateModtools is a pure-wiring local: only lifecycle calls and a factory invocation.
	// The one-shot guard lives in the createModtoolsActivator closure, not here.
	const activateOnce = createModtoolsActivator(self, options,)
	function activateModtools () {
		const mt = activateOnce()
		if (!mt) { return }
		lifecycle.mount(mt.cleanup,)
		lifecycle.on(window, 'TBNewThings', mt.handleNewThings,)
		lifecycle.delegate<MouseEvent>(body, 'click', '.thing .entry', mt.handleThingEntry,)
		lifecycle.delegate(body, 'click', '.reported-stamp', mt.handleReportedStamp,)
		lifecycle.delegate(body, 'click', '.thing input[type=checkbox]', mt.handleThingCheckbox,)
		lifecycle.delegate(body, 'click', '.pretty-button', mt.handlePrettyButton,)
		if (mt.sidebarSort.handleSortClick) {
			lifecycle.delegate(body, 'click', '.toolbox-sort-subs', mt.sidebarSort.handleSortClick,)
		}
		// Baseline the queue against the mod log right away, so items the log already describes (spam
		// filter / AutoModerator removals awaiting review) aren't mistaken for fresh actions later.
		void mt.syncModlogActions()
	}

	if (setup.hasQueueToolsTab) {
		lifecycle.delegate(body, 'click', '.toolbox-queue-tools-tab', activateModtools,)
	}
	if (isModpage && options.autoActivate) {
		activateModtools()
	}

	return lifecycle.cleanup
}

export default self
