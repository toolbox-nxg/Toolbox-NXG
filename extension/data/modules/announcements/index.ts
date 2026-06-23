/** Entry point for the Announcements module: shows announcement popups and, for toolbox_nxg mods, the composer button. */

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {displayAnnouncements,} from './display'
import {setupAnnouncementBuilder,} from './dom'
import {type AnnouncementsSettings, settings,} from './settings'

const self = new Module<AnnouncementsSettings>({
	name: 'Announcements',
	id: 'Announcements',
	docSlug: '', // No dedicated documentation page; suppresses the help link.
	enabledByDefault: true,
	settings,
}, async function init () {
	const lifecycle = createLifecycle()
	setupAnnouncementBuilder(lifecycle,)
	// Fire-and-forget: fetches the wiki and shows any unseen notes. No-op on dev builds.
	void displayAnnouncements()
	return lifecycle.cleanup
},)

export default self
