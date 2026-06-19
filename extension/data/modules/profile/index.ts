/** Entry point for the Profile Pro module, which provides an in-page user profile overlay. */
import './profile.css'

import {modSubCheck,} from '../../api/resources/modSubs'
import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {profile,} from '../../framework/moduleIds'
import createLogger from '../../util/infra/logging'
import {createProfileHandlers, registerProfileRenderers,} from './dom'
import {type ProfileSettings, settings,} from './settings'

const log = createLogger('Profile',)

export default new Module<ProfileSettings>({
	name: 'Profile Pro',
	id: profile,
	enabledByDefault: true,
	settings,
}, async (s: ProfileSettings,) => {
	log.debug('init',)
	if (!await modSubCheck()) {
		log.debug('mscheck failed',)
		return
	}

	log.debug('mscheck passed',)
	const lifecycle = createLifecycle()
	const handlers = createProfileHandlers(s,)

	if (s.directProfileToLegacy) {
		lifecycle.delegate<MouseEvent>(document.body, 'click', 'a', handlers.handleLinkClick,)
	}

	lifecycle.on(window, 'TBNewPage', handlers.handleNewPage,)

	if (s.profileButtonEnabled) {
		lifecycle.mount(registerProfileRenderers(s.subredditColor,),)
	}

	lifecycle.delegate(
		document.body,
		'click',
		'#toolbox-user-profile',
		handlers.handleProfileButtonClick,
	)
	lifecycle.on(window, 'TBHashParams', handlers.handleHashParams,)

	return lifecycle.cleanup
},)
