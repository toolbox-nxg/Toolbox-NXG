/**
 * A small centered spinner used for the proposals drawer's in-pane loading states
 * (the sidebar list, the target preview, the author panel). Replaces the bare
 * "Loading..." text so an in-flight fetch reads as motion rather than a frozen panel.
 */

import css from './ProposalsReviewPopup.module.css'

/** Props for the in-pane spinner. */
interface Props {
	/** Optional label shown next to the spinner (e.g. "Loading target..."). */
	label?: string
}

/** Renders a centered ring spinner with an optional label. */
export function ProposalSpinner ({label,}: Props,) {
	return (
		<div className={css.loadingRow} role="status">
			<span className={css.loadingSpinner} aria-hidden="true" />
			{label && <span>{label}</span>}
		</div>
	)
}
