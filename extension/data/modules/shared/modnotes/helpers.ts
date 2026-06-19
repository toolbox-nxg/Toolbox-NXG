/** Helper utilities for resolving mod note context URLs. */

import {getInfo,} from '../../../api/resources/things'
import {link,} from '../../../util/reddit/pageContext'
import {ModNote,} from './schema'

const submissionFullnamesCache: Record<string, Promise<string>> = Object.create(null,)

/** Gets the fullname of a comment's corresponding submission. */
export function getSubmissionFullname (commentFullname: string,): Promise<string> {
	const cached = submissionFullnamesCache[commentFullname]
	if (cached) {
		return cached
	}
	const submissionFullnamePromise = getInfo<{link_id: string}>(commentFullname,)
		.then((info,) => info.data.link_id)
	submissionFullnamesCache[commentFullname] = submissionFullnamePromise
	return submissionFullnamePromise
}

/** Gets a link to the context item of a note. */
export async function getContextURL (note: ModNote,): Promise<string | null> {
	const itemFullname = note.user_note_data?.reddit_id || note.mod_action_data?.reddit_id
	if (!itemFullname) {
		return null
	}
	const [itemType, itemID,] = itemFullname.split('_',)
	if (itemType === 't3') {
		return link(`/comments/${itemID}`,)
	}
	if (itemType === 't1') {
		const submissionFullname = await getSubmissionFullname(itemFullname,)
		return link(`/comments/${submissionFullname.replace('t3_', '',)}/_/${itemID}`,)
	}
	return null
}
