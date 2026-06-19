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

/** Archives a modmail conversation. */
export const archiveModmail = (conversationId: string,): Promise<Response> =>
	apiOauthPOST(`/api/mod/conversations/${conversationId}/archive`,)

/** Gets the number of unread modmail conversations by type. */
export const getModmailUnreadCount = (): Promise<Record<string, number>> =>
	apiOauthGetJSON('/api/mod/conversations/unread/count',)
