/** Entry point for the Subreddit Notes module, which lets moderators keep shared wiki-backed notes per subreddit. */
import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {subredditNotes,} from '../../framework/moduleIds'
import createLogger from '../../util/infra/logging'
import {isEmbedded,} from '../../util/infra/platform'
import {createNotesModbarSlot,} from './dom'
import {settings, SubredditNotesSettings,} from './settings'

const log = createLogger('SubredditNotes',)

export default new Module<SubredditNotesSettings>({
	name: 'Subreddit Notes',
	id: subredditNotes,
	enabledByDefault: false,
	settings,
}, (s: SubredditNotesSettings,) => {
	log.info('Subreddit notes loaded! Success!',)
	if (isEmbedded) {
		return
	}

	const lifecycle = createLifecycle()
	lifecycle.mount(createNotesModbarSlot(s,),)
	return lifecycle.cleanup
},)
