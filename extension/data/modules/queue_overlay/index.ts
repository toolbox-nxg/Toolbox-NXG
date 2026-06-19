/** Entry point for the Queue Overlay module, which opens mod queues in an in-page overlay. */
import './queue_overlay.css'

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {queueOverlay,} from '../../framework/moduleIds'
import {currentPlatform, isEmbedded, RedditPlatform,} from '../../util/infra/platform'
import {isModpage,} from '../../util/reddit/pageContext'
import {createQueueOverlayHandlers,} from './dom'
import {QueueOverlaySettings, settings,} from './settings'

export default new Module<QueueOverlaySettings>({
	name: 'Queue Overlay',
	id: queueOverlay,
	enabledByDefault: true,
	settings,
}, async ({overlayFromBarRedesign, overlayFromBarOld,},) => {
	const lifecycle = createLifecycle()

	if (isModpage && isEmbedded) {
		document.querySelectorAll('head link[href*="//www.redditstatic.com/embedded."]',).forEach((el,) => el.remove())
		document.body.classList.add('toolbox-embedded-queues',)
		document.querySelectorAll('.drop-choices a.choice',).forEach((el,) => el.setAttribute('target', '_self',))
		lifecycle.mount(() => {
			document.body.classList.remove('toolbox-embedded-queues',)
		},)
	}

	const handlers = await createQueueOverlayHandlers()

	if (
		(currentPlatform === RedditPlatform.Old && overlayFromBarOld)
		|| (currentPlatform === RedditPlatform.Shreddit && overlayFromBarRedesign)
	) {
		lifecycle.delegate(
			document.body,
			'click',
			'#toolbox-modqueue, #toolbox-queueCount',
			handlers.handleModqueueClick,
		)
		lifecycle.delegate(
			document.body,
			'click',
			'#toolbox-unmoderated, #toolbox-unmoderatedCount',
			handlers.handleUnmoderatedClick,
		)
		lifecycle.on(document, 'tb:mysubs-open-queue', handlers.handleOpenQueueEvent,)
	}

	return lifecycle.cleanup
},)
