/** Shared types for the TBComment and TBSubmission React components. */

/** Display and behavior options for TBComment. */
export interface CommentOptions {
	/** Show a "parent" link to the parent comment or post. */
	parentLink?: boolean
	/** Show a "context" link with `?context=3`. */
	contextLink?: boolean
	/**
	 * Show a "context-popup" link. Pass `true` to use the default click behavior,
	 * or a callback `(commentId, permalink, event) => void` for custom handling.
	 */
	contextPopup?: boolean | ((commentId: string, permalink: string, event: MouseEvent,) => void)
	/** Show a "full comments" link back to the thread. */
	fullCommentsLink?: boolean
	/** Show the parent submission title and author above the comment. */
	overviewData?: boolean
	/** Add 1 to the API-reported depth when computing indent classes. */
	commentDepthPlus?: boolean
	/** Use numeric depth class instead of odd/even alternation. */
	noOddEven?: boolean
	/** Color the left border based on the subreddit name. */
	subredditColor?: boolean
}

/** Display options for TBSubmission. */
export interface SubmissionOptions {
	/** Color the left border based on the subreddit name. */
	subredditColor?: boolean
	/** Show the post flair badge next to the title. */
	showPostFlair?: boolean
}

/** Moderation state of a Reddit thing. */
export type ThingStatus = 'spammed' | 'removed' | 'approved' | 'neutral'
