/** DOM integration for the Mod Button module - registers mod button renderers at all supported UI locations. */

import {useEffect, useState,} from 'react'

import {getModSubs,} from '../../api/resources/modSubs'
import {renderAtLocation,} from '../../dom/uiLocations'
import {type UILocationContext,} from '../../dom/uiLocations'
import {createLifecycle,} from '../../framework/lifecycle'
import createLogger from '../../util/infra/logging'
import {ModButtonUserRoot,} from './components/ModButtonUserRoot'
import {type ModButtonSettings,} from './settings'

const log = createLogger('ModButton',)

/** Renders ModButtonUserRoot after confirming the user mods at least one sub. */
function ModButtonEntry ({context, settings, setLastAction, setSavedSubs,}: {
	context: UILocationContext
	settings: ModButtonSettings
	setLastAction: (action: string,) => void
	setSavedSubs: (subs: string[],) => void
},) {
	const [ready, setReady,] = useState(false,)

	useEffect(() => {
		let alive = true
		getModSubs(false,).then((subs: unknown,) => {
			if (alive && (subs as string[]).length) { setReady(true,) }
		},).catch((error: unknown,) => log.error(error,))
		return () => {
			alive = false
		}
	}, [],)

	if (!ready || !context.author || !context.subreddit) { return null }

	const {savedSubs, rememberLastAction, globalButton, excludeGlobal, lastAction,} = settings
	return (
		<ModButtonUserRoot
			author={context.author}
			subreddit={context.subreddit}
			parentId={context.thingId ?? 'unknown'}
			savedSubs={savedSubs}
			rememberLastAction={rememberLastAction}
			globalButton={globalButton}
			excludeGlobal={excludeGlobal}
			lastAction={lastAction}
			setLastAction={setLastAction}
			setSavedSubs={setSavedSubs}
			authorButton
		/>
	)
}

/**
 * Registers mod button renderers at the `authorActions` UI location.
 * @param s The resolved mod button settings.
 * @param setLastAction Callback to persist the last-used action type.
 * @param setSavedSubs Callback to persist the pinned-subs list.
 * @returns A cleanup function to pass to `lifecycle.mount` in `index.ts`.
 */
export function createModButtonHandlers (
	s: ModButtonSettings,
	setLastAction: (action: string,) => void,
	setSavedSubs: (subs: string[],) => void,
) {
	const lifecycle = createLifecycle()
	log.debug('registering mod button renderers',)

	renderAtLocation(
		'authorActions',
		{id: 'modbutton.author', order: 20, lifecycle,},
		({context,},) => (
			<ModButtonEntry
				context={context}
				settings={s}
				setLastAction={setLastAction}
				setSavedSubs={setSavedSubs}
			/>
		),
	)
	return lifecycle.cleanup
}
