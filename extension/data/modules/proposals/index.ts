/**
 * Entry point for the Proposals module (training mode / second opinions). Mounts
 * the modbar review button. The capture runtime (gateway providers, guard
 * predicate) is wired separately in `init.ts` via `initProposalsRuntime` so it is
 * always active regardless of this module's enabled state - a trainee must never
 * be able to disable their own sandbox by turning a module off.
 */

import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {proposals,} from '../../framework/moduleIds'
import {isEmbedded,} from '../../util/infra/platform'
import {
	createProposalsInlineBadgeSlot,
	createProposalsModbarSlot,
	createProposalsSecondOpinionSlot,
	createTrainingModeIndicatorSlot,
} from './dom'

export default new Module({
	name: 'Proposals',
	id: proposals,
	docSlug: 'proposals',
	enabledByDefault: true,
}, () => {
	if (isEmbedded) {
		return
	}
	const lifecycle = createLifecycle()
	lifecycle.mount(createProposalsModbarSlot(),)
	lifecycle.mount(createTrainingModeIndicatorSlot(),)
	lifecycle.mount(createProposalsInlineBadgeSlot(),)
	lifecycle.mount(createProposalsSecondOpinionSlot(),)
	return lifecycle.cleanup
},)
