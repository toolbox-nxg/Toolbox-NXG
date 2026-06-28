/** API functions for Reddit's new modmail (Mod Conversations API). */

import {apiOauthGetJSON, apiOauthPOST, apiOauthPostJSON,} from '../transport/http'

/**
 * Creates a modmail conversation.
 * @param options Message options.
 * @param subreddit Name of the subreddit sending the message
 * @param to Recipient - bare username, `u/` username, `r/` subreddit, or `null` for internal
 * @param subject Subject of the message
 * @param body Body of the message
 * @param isAuthorHidden If true, author name is hidden from non-mods
 */
export function sendModmail ({subreddit, to, subject, body, isAuthorHidden,}: {
	subreddit: string
	to: string | null
	subject: string
	body: string
	isAuthorHidden: boolean
},): Promise<{conversation: {id: string; isInternal?: boolean}}> {
	return apiOauthPostJSON('/api/mod/conversations', {
		srName: subreddit,
		to: to ?? undefined,
		subject,
		body,
		// Form-encoded bodies have no boolean type; the API accepts 'true'/'false' strings.
		isAuthorHidden: String(isAuthorHidden,),
	},)
}

/**
 * Participant info embedded in a modmail conversation under its `user` key; this is what backs
 * Reddit's native user-info sidebar. The three `recent*` maps are keyed by Reddit fullname/id;
 * entries are left as `unknown` and narrowed defensively by the consumer, since this is untrusted
 * wire data.
 */
export interface ModmailParticipant {
	/** Recent submissions, keyed by post fullname. Each entry carries `title`, `permalink`, `subreddit`, `date`. */
	recentPosts?: Record<string, unknown>
	/** Recent comments, keyed by comment fullname. Each entry adds `comment` (the body) to the post fields. */
	recentComments?: Record<string, unknown>
	/** Recent modmail conversations, keyed by conversation id. Each entry carries `subject`, `permalink`, `date`. */
	recentConvos?: Record<string, unknown>
	/** Whether the participant is shadowbanned site-wide. */
	isShadowBanned?: boolean
	/** Whether the participant is suspended site-wide. */
	isSuspended?: boolean
}

/** Subset of the modmail conversation response that carries the participant's recent activity. */
interface ModmailConversationResponse {
	/** Participant info, including the `recent*` activity maps. Absent for internal/no-participant threads. */
	user?: ModmailParticipant
}

/**
 * Fetches participant info (recent posts, comments, and modmail conversations) for a modmail
 * conversation. The data is embedded in the conversation response under `user` - the same single
 * request that backs Reddit's native user-info sidebar - not on a separate per-user endpoint.
 * @param conversationId The modmail conversation id (the trailing path segment of a thread URL).
 * @returns The participant's recent-activity maps, or an empty object when the thread has no participant.
 */
export const getModmailParticipant = async (conversationId: string,): Promise<ModmailParticipant> => {
	const response = await apiOauthGetJSON<ModmailConversationResponse>(`/api/mod/conversations/${conversationId}`,)
	return response.user ?? {}
}

/** Archives a modmail conversation. */
export const archiveModmail = (conversationId: string,): Promise<Response> =>
	apiOauthPOST(`/api/mod/conversations/${conversationId}/archive`,)

/** Gets the number of unread modmail conversations by type. */
export const getModmailUnreadCount = (): Promise<Record<string, number>> =>
	apiOauthGetJSON('/api/mod/conversations/unread/count',)
