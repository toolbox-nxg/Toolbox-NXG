/** Entry point for the Syntax Highlighter module; activates on old Reddit stylesheet and wiki edit pages. */

import './syntax.css'
import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {createStylesheetBundle, createWikiBundle,} from './dom'
import {settings, type SyntaxSettings,} from './settings'

export default new Module<SyntaxSettings>({
	name: 'Syntax Highlighter',
	id: 'Syntax',
	enabledByDefault: true,
	oldReddit: true,
	settings,
}, (s,) => {
	const lifecycle = createLifecycle()

	const stylesheet = createStylesheetBundle(s,)
	if (stylesheet) {
		lifecycle.mount(stylesheet.destroy,)
	}

	const wiki = createWikiBundle(s,)
	if (wiki) {
		lifecycle.mount(wiki.destroy,)
	}

	return lifecycle.cleanup
},)
