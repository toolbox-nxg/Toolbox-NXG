/** Entry point for the General Settings module, which holds cross-module preferences like notification style and context menu behavior. */
import {Module,} from '../../framework/module'
import {GenSettings, settings,} from './settings'

const self = new Module<GenSettings>({
	name: 'General Settings',
	id: 'GenSettings',
	alwaysEnabled: true,
	settings,
},)

// Spans settings for several modules, so it's positioned outside the per-module
// list in the settings window
self.sort = {
	location: 'beforeModules',
	order: 2, // below core settings, above toggle modules
}

export default self
