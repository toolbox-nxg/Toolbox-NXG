/** Data shapes for user history information fetched and displayed by the History Button module. */

/** Basic Reddit account info for a user. */
export interface UserInfo {
	/** Account creation date; pass through {@linkcode util/data/time!niceDateDiff} for a human-readable age. */
	createdAt: Date
	submissionKarma: number
	commentKarma: number
}

/** Aggregated submission history for a user, broken down by domain and subreddit. */
export interface SubmissionHistoryData {
	/** Total number of submissions retrieved. */
	total: number
	/** Submission counts keyed by submission domain. */
	domains: Record<string, {count: number}>
	/** Submission counts and total karma keyed by subreddit. */
	subreddits: Record<string, {count: number; karma: number}>
	/** External domains linked in selfpost bodies, keyed by hostname. */
	textLinkDomains: Record<string, {count: number}>
}

/** Aggregated comment history for a user, broken down by subreddit and linked domain. */
export interface CommentHistoryData {
	/** Total number of comments retrieved. */
	total: number
	/** Comment counts keyed by subreddit. */
	subreddits: Record<string, number>
	/** External domains linked in comment bodies. */
	linkDomains: Record<string, {count: number}>
}
