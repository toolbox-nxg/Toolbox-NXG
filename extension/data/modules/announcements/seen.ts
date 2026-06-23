/**
 * Persistence for which announcement notes the current user has already seen.
 * Kept in its own module (rather than display.ts) so both the display path and
 * the popup can use it without an import cycle.
 *
 * The seen list is stored under the Announcements module's settings namespace
 * (`Toolbox.Announcements.seenNotes`).
 */

import {announcements,} from '../../framework/moduleIds'
import {getSettingAsync, setSettingAsync,} from '../../util/persistence/settings'

/** Returns the ids of announcement notes the user has already seen. */
export async function getSeenIds (): Promise<string[]> {
	return getSettingAsync(announcements, 'seenNotes', [],) as Promise<string[]>
}

/**
 * Serializes markSeen's read-modify-write. The popup marks each note as the user
 * pages away from it, so several calls can land in quick succession; without a
 * queue each would read the list before the previous write committed and the
 * later write would drop the earlier id (lost update).
 */
let writeChain: Promise<void> = Promise.resolve()

/**
 * Records a single note id as seen, if it isn't already. Called as each note is
 * actually viewed in the popup - so notes the user never pages to stay unseen
 * and will reappear on a later page load. Writes are queued (see {@link writeChain})
 * so rapid successive calls don't overwrite each other.
 * @param id The note id to mark seen.
 */
export async function markSeen (id: string,): Promise<void> {
	const next = writeChain.then(async () => {
		const seenIds = await getSeenIds()
		if (seenIds.includes(id,)) {
			return
		}
		await setSettingAsync(announcements, 'seenNotes', [...seenIds, id,],)
	},)
	// Keep the chain usable even if this write rejects, while still surfacing the
	// failure to this caller.
	writeChain = next.catch(() => {},)
	return next
}
