/** Entry point for the Toolbox background service worker: registers all message handlers and event listeners. */

import {registerCacheHandlers,} from './handlers/cache'
import {registerGlobalMessageHandlers,} from './handlers/globalmessage'
import {registerModqueueHandlers,} from './handlers/modqueue'
import {registerNotificationHandlers,} from './handlers/notifications'
import {registerReloadHandlers,} from './handlers/reload'
import {registerSettingsHandlers,} from './handlers/settings'
import {registerUrlChangedListeners,} from './handlers/url_changed'
import {registerUsernoteHandlers,} from './handlers/usernotes'
import {registerWebrequestHandlers,} from './handlers/webrequest'

// These registration functions attach browser listeners and are intended to run exactly once per service-worker instance.
registerCacheHandlers()
registerGlobalMessageHandlers()
registerModqueueHandlers()
registerNotificationHandlers()
registerReloadHandlers()
registerSettingsHandlers()
registerUsernoteHandlers()
registerWebrequestHandlers()

// url_changed uses browser.webNavigation listeners, not message handlers.
registerUrlChangedListeners()
