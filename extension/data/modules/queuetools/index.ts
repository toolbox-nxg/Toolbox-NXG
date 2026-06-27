/** Entry point for the Queue Tools module, which adds action tables, ignored-report buttons, and queue creatures. */
import './queuetools.css'
import './old_queuetools.css'

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {createQueueHandlers,} from './dom'
import {settings,} from './settings'
import type {QueueToolsSettings,} from './settings'

const self: Module<QueueToolsSettings> = new Module({
	name: 'Queue Tools',
	id: 'QueueTools',
	docSlug: 'queue-tools',
	enabledByDefault: true,
	settings,
}, init,)

function init (options: QueueToolsSettings,) {
	const lifecycle = createLifecycle()
	const {
		showRecentActionsOnApproved,
		showRecentActionsOnRemoved,
		showReportReasons,
		expandActionReasonQueue,
		queueCreature,
	} = options

	const queueHandlers = createQueueHandlers({
		showRecentActionsOnApproved,
		showRecentActionsOnRemoved,
		showReportReasons,
		queueCreature,
		expandActionReasonQueue,
	},)
	lifecycle.mount(queueHandlers.cleanup,)
	lifecycle.on(window, 'TBNewPage', queueHandlers.handleNewPage,)

	return lifecycle.cleanup
}

export default self
