/** Entry point for the Developer Tools module, which exposes API context inspection and UI testing utilities. */
import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {devtools,} from '../../framework/moduleIds'
import {removeContextItem,} from '../../store/contextMenu'
import {addCommentTesterContextItem, registerApiInfoButtons, showCommentUITester,} from './dom'
import {DevToolsSettings, settings,} from './settings'

export default new Module<DevToolsSettings>({
	name: 'Developer Tools',
	id: devtools,
	docSlug: 'devtools',
	enabledByDefault: true,
	debug: true,
	settings,
}, ({apiHelper, commentUItester,},) => {
	const lifecycle = createLifecycle()

	if (apiHelper) {
		lifecycle.mount(registerApiInfoButtons(),)
	}

	if (commentUItester) {
		addCommentTesterContextItem()
		lifecycle.mount(() => {
			removeContextItem('toolbox-testCommentUI-link',)
		},)
		lifecycle.delegate(document.body, 'click', '#toolbox-testCommentUI-link', () => showCommentUITester(),)
	}

	return lifecycle.cleanup
},)
