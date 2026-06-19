/** Entry point for the Domain Tagger module, which color-tags link domains on post listings for moderators. */
import './domaintagger.css'

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {domainTagger,} from '../../framework/moduleIds'
import {isOldReddit,} from '../../util/infra/platform'
import {onSharedMutation,} from '../../util/ui/dom'
import {createDomainTaggerHandlers,} from './dom'
import {DomainTaggerSettings, settings,} from './settings'

export default new Module<DomainTaggerSettings>({
	name: 'Domain Tagger',
	id: domainTagger,
	enabledByDefault: true,
	settings,
}, (s,) => {
	const lifecycle = createLifecycle()
	const handlers = createDomainTaggerHandlers(s,)

	handlers.applyDisplayClass()
	lifecycle.mount(handlers.cleanup,)

	lifecycle.delegate<MouseEvent>(document.body, 'click', '.add-domain-tag', handlers.handleTagButtonClick,)

	if (isOldReddit) {
		handlers.handleNewThings()
		lifecycle.on(window, 'TBNewThings', handlers.handleNewThings,)
	} else {
		handlers.initShreddit()
		lifecycle.mount(onSharedMutation(handlers.handleShredditMutations,),)
	}

	return lifecycle.cleanup
},)
