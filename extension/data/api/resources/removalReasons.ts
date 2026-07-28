/** API functions for reading Reddit's native subreddit removal reasons and registering them on removed items. */

import {assertActionAllowed,} from '../../util/infra/captureGuard'
import {postRedditApiVoid,} from '../parsers/redditMutation'
import {apiOauthGetJSON,} from '../transport/http'

/** A single native Reddit removal reason as configured in the subreddit's mod tools. */
export interface NativeRemovalReason {
	/** Reddit's opaque id for the reason, registered on removed items via the modactions API. */
	id: string
	title: string
	message: string
}

/**
 * Response shape of `GET /api/v1/{subreddit}/removal_reasons`: reasons keyed by id
 * plus an `order` array giving the moderator-configured display order.
 */
interface NativeRemovalReasonsResponse {
	data: Record<string, NativeRemovalReason>
	order: string[]
}

/**
 * Gets a subreddit's native (Reddit-configured) removal reasons, in the
 * moderator-configured display order. Returns an empty array when the subreddit
 * has none configured.
 */
export const getNativeRemovalReasons = async (subreddit: string,): Promise<NativeRemovalReason[]> => {
	const response = await apiOauthGetJSON<NativeRemovalReasonsResponse>(
		`/api/v1/${subreddit}/removal_reasons`,
	)
	const byId = response.data ?? {}
	// `order` is the source of truth for display order; fall back to insertion order if it is
	// absent or stale. `noUncheckedIndexedAccess` widens the lookup to `| undefined`, so drop
	// any id in `order` that no longer has a matching entry.
	const ids = response.order?.length ? response.order : Object.keys(byId,)
	return ids.map((id,) => byId[id]).filter((reason,): reason is NativeRemovalReason => Boolean(reason,))
}

/**
 * Registers a native removal reason against an already-removed item, recording it in
 * the subreddit's mod log. This only records the reason; it sends no message to the
 * user (message delivery is a separate endpoint).
 * @param options Registration options.
 * @param itemId Fullname of the already-removed item (e.g. `t3_abc123`).
 * @param reasonId Reddit reason id from {@link getNativeRemovalReasons}.
 * @param modNote Optional private mod note to attach to the removal.
 */
export const applyNativeRemovalReason = ({
	itemId,
	reasonId,
	modNote,
}: {
	itemId: string
	reasonId: string
	modNote?: string
},): Promise<void> => {
	// Registering a removal reason is a real moderation action; gate it by the training-mode
	// capture guard so a sandboxed trainee is blocked (the proposals gateway captures it properly).
	assertActionAllowed('applyNativeRemovalReason', {fullname: itemId,},)
	return postRedditApiVoid('/api/v1/modactions/removal_reasons', {
		type: 'json',
		data: {item_ids: [itemId,], reason_id: reasonId, ...(modNote ? {mod_note: modNote,} : {}),},
	},)
}
