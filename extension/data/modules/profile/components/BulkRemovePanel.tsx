/** Confirmation/progress panel that bulk-removes all of a user's content in one subreddit. */
import {useRef, useState,} from 'react'

import {ActionButton,} from '../../../shared/controls/ActionButton'
import {negativeTextFeedback,} from '../../../store/feedback'
import createLogger from '../../../util/infra/logging'
import {isTrainingCaptureActive,} from '../../shared/proposals/gateway'
import {bulkRemoveUserContent,} from './BulkRemovePanel.helpers'
import css from './ProfileOverlay.module.css'

const log = createLogger('Profile',)

/** Props for the BulkRemovePanel component. */
interface BulkRemovePanelProps {
	/** Reddit username whose content will be removed. */
	user: string
	/** Subreddit from which the user's content will be removed. */
	subreddit: string
	onClose: () => void
}

export function BulkRemovePanel ({user, subreddit, onClose,}: BulkRemovePanelProps,) {
	const [phase, setPhase,] = useState<'confirm' | 'running' | 'done'>('confirm',)
	const [scanned, setScanned,] = useState(0,)
	const [removed, setRemoved,] = useState(0,)
	const cancelRef = useRef(false,)

	async function execute () {
		// Training mode does not capture bulk actions; refuse rather than have the
		// per-item capture guard fail-close mid-scan.
		if (await isTrainingCaptureActive(subreddit,)) {
			negativeTextFeedback('Bulk removal isn\'t available in training mode',)
			onClose()
			return
		}
		cancelRef.current = false
		setPhase('running',)

		try {
			await bulkRemoveUserContent(subreddit, user, {
				isCancelled: () => cancelRef.current,
				onProgress: ({scanned: s, removed: r,},) => {
					setScanned(s,)
					setRemoved(r,)
				},
			},)
		} catch (err) {
			log.error('Bulk remove error:', err,)
		}

		setPhase('done',)
	}

	return (
		<div className={css.bulkRemovePanel}>
			{phase === 'confirm' && (
				<>
					<p className={css.bulkRemoveTitle}>
						Remove all posts &amp; comments by /u/{user} in /r/{subreddit}?
					</p>
					<p className={css.bulkRemoveNote}>
						This will scan the user&apos;s full history and remove every non-removed item in /r/{subreddit}.
						This cannot be undone automatically.
					</p>
					<div className={css.bulkRemoveActions}>
						<ActionButton type="button" onClick={execute}>Confirm remove all</ActionButton>
						<ActionButton type="button" onClick={onClose}>Cancel</ActionButton>
					</div>
				</>
			)}
			{phase === 'running' && (
				<>
					<p className={css.bulkRemoveTitle}>
						Removing content by /u/{user} in /r/{subreddit}...
					</p>
					<p className={css.bulkRemoveProgress}>
						{removed} removed &bull; {scanned} scanned
					</p>
					<ActionButton
						type="button"
						onClick={() => {
							cancelRef.current = true
						}}
					>
						Cancel
					</ActionButton>
				</>
			)}
			{phase === 'done' && (
				<>
					<p className={css.bulkRemoveTitle}>
						Done. Removed {removed} item{removed === 1 ? '' : 's'} from /r/{subreddit}.
					</p>
					<ActionButton type="button" onClick={onClose}>Close</ActionButton>
				</>
			)}
		</div>
	)
}
