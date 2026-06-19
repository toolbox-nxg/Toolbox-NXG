/** Registers the Old Reddit module, which bootstraps all toolbox UI location slots on old.reddit.com. */

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {oldReddit,} from '../../framework/moduleIds'
import {createOldRedditHandlers,} from './dom'
import {type OldRedditSettings, settings,} from './settings'

const self = new Module<OldRedditSettings>({
	name: 'Old Reddit',
	id: oldReddit,
	alwaysEnabled: true,
	oldReddit: true,
	settings,
}, (s,) => {
	const lifecycle = createLifecycle()
	const handlers = createOldRedditHandlers(s,)

	lifecycle.mount(handlers.cleanup,)
	// TBNewThings only fires for things added after init; the timeout seeds the first pass
	// over whatever is already in the DOM when the module loads.
	lifecycle.timeout(handlers.thingCrawler, 500,)
	lifecycle.timeout(handlers.userListCrawler, 500,)
	lifecycle.on(window, 'TBNewThings', handlers.thingCrawler,)
	if (handlers.resObserverTarget) {
		lifecycle.observe(handlers.resObserverTarget, handlers.resObserverCallback, {childList: true, subtree: true,},)
	}

	return lifecycle.cleanup
},)

export default self
