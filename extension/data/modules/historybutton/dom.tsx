/** DOM registration for the History Button module: renders the history button at author and hovercard locations. */
import {Provider,} from 'react-redux'

import {renderAtLocation,} from '../../dom/uiLocations'
import {createLifecycle,} from '../../framework/lifecycle'
import store from '../../store/index'

import {HistoryButtonUserRoot,} from './components/HistoryButtonUserRoot'

/**
 * Registers the history button at the `authorActions` UI location.
 * @returns A cleanup function to unregister the location rendering.
 */
export function createHistoryButtonHandlers () {
	const lifecycle = createLifecycle()

	renderAtLocation(
		'authorActions',
		{id: 'historybutton.author', order: 30, lifecycle,},
		({context,},) => {
			if (!context.author) { return null }
			return (
				<Provider store={store}>
					<HistoryButtonUserRoot
						user={context.author}
						subreddit={context.subreddit ?? null}
						author
					/>
				</Provider>
			)
		},
	)

	return lifecycle.cleanup
}
