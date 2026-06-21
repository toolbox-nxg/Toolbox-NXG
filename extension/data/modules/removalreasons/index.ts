/** Entry point for the Removal Reasons module; wires up remove button injection and click handling. */

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import type {ProposedAction,} from '../../util/wiki/schemas/proposals/schema'
import {registerReplayHandler,} from '../shared/proposals/gateway'
import {createRemovalReasonsHandlers,} from './dom'
import {replayRemovalProposal,} from './proposalAdapter'
import {RemovalReasonsSettings, settings,} from './settings'

// Replay an accepted removal-reason proposal by reconstructing the submission
// params (re-fetching item metadata from the proposal's itemId) and running the
// pipeline. Registered once; the gateway dispatches to it on accept.
registerReplayHandler('removal-reason', (subreddit, proposal, overrides,) => {
	const action = proposal.action as Extract<ProposedAction, {type: 'removal-reason'}>
	return replayRemovalProposal(subreddit, proposal, action.intent, overrides,)
},)

const self = new Module<RemovalReasonsSettings>({
	name: 'Removal Reasons',
	id: 'RemovalReasons',
	docSlug: 'removal-reasons',
	enabledByDefault: true,
	settings,
}, (s: RemovalReasonsSettings,) => {
	const lifecycle = createLifecycle()
	const handlers = createRemovalReasonsHandlers(s,)
	lifecycle.mount(handlers.cleanup,)

	lifecycle.on(document.body, 'click', handlers.handleClick, {capture: true,},)

	return lifecycle.cleanup
},)

export default self
