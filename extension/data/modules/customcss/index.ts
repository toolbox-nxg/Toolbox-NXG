/** Entry point for the Custom CSS module, which applies the moderator's own stylesheet to Reddit and Toolbox. */
import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {customCss,} from '../../framework/moduleIds'
import {createCustomCssHandlers,} from './dom'
import {type CustomCssSettings, settings,} from './settings'

const self = new Module<CustomCssSettings>({
	name: 'Custom CSS',
	id: customCss,
	docSlug: 'custom-css',
	// Opt-in: unsupported by design, and switching it off is the quick way to rule the
	// moderator's own CSS out when something looks broken.
	enabledByDefault: false,
	settings,
}, ({css,},) => {
	const lifecycle = createLifecycle()

	const {applyCustomCss, cleanup,} = createCustomCssHandlers()
	applyCustomCss(css,)
	lifecycle.mount(self.onChange('css', applyCustomCss,),)
	lifecycle.mount(cleanup,)

	return lifecycle.cleanup
},)

export default self
