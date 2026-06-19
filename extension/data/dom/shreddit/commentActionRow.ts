/**
 * Helpers for reading and driving a Shreddit comment's native `<shreddit-comment-action-row>`.
 *
 * The Toolbox recreates the everyday comment controls (vote/reply/report/share) in its own row and
 * collapses the native row by default (see `toolbox-buttons.css`). These helpers let the recreated
 * controls read the native vote state and drive the native reply/overflow controls when needed, and
 * toggle the collapse. The native-element selectors are intentionally isolated here (and flagged
 * best-effort) so a Shreddit markup change is a one-file fix; they are exercised against fixtures in
 * `commentActionRow.test.ts`.
 */

/** CSS hook the Expand toggle flips on a `shreddit-comment` to reveal its collapsed native row. */
export const NATIVE_ROW_EXPANDED_CLASS = 'toolbox-native-row-expanded'

/** Native vote state, as stamped on the action row's `vote-state` attribute. */
export type NativeVoteState = 'UP' | 'DOWN' | 'NONE'

/** A comment's current vote state and score (`score` is `null` when Reddit hides it). */
export interface CommentVoteInfo {
	/** Current score, or `null` when the comment's score is hidden. */
	score: number | null
	/** Which arrow (if any) the current user has active. */
	state: NativeVoteState
}

/**
 * Returns a comment's OWN `<shreddit-comment-action-row>` (not a nested reply's), matched by the
 * action row's `comment-id` to the comment's `thingid`. Returns `null` when the row isn't present
 * yet (Shreddit lazy-renders comment rows).
 * @param comment A `shreddit-comment` element.
 */
export function getCommentActionRow (comment: Element,): Element | null {
	const commentId = comment.getAttribute('thingid',)
	for (const row of comment.querySelectorAll('shreddit-comment-action-row',)) {
		if (row.getAttribute('comment-id',) === commentId) { return row }
	}
	return null
}

/**
 * Reads a `score` attribute off an element and parses it to a number, returning
 * `null` when the attribute is absent, empty, or non-numeric (Reddit hides the
 * score by omitting/blanking the attribute).
 * @param el The element carrying a `score` attribute, or `null`.
 */
export function parseScoreAttr (el: Element | null,): number | null {
	const rawScore = el?.getAttribute('score',)
	const parsed = rawScore === null || rawScore === undefined || rawScore === '' ? Number.NaN : Number(rawScore,)
	return Number.isFinite(parsed,) ? parsed : null
}

/**
 * Reads the current score + vote direction off a comment action row.
 * @param actionRow A `shreddit-comment-action-row`, or `null` (returns a neutral, score-hidden info).
 */
export function readVoteState (actionRow: Element | null,): CommentVoteInfo {
	if (!actionRow) { return {score: null, state: 'NONE',} }
	const score = parseScoreAttr(actionRow,)
	const stateAttr = (actionRow.getAttribute('vote-state',) ?? 'NONE').toUpperCase()
	const state: NativeVoteState = stateAttr === 'UP' ? 'UP' : stateAttr === 'DOWN' ? 'DOWN' : 'NONE'
	return {score, state,}
}

/**
 * Finds a comment's native Reply control (a light-DOM child slotted into `comment-reply`). Returns
 * the innermost clickable `<button>` when present, else the slotted host. Best-effort selectors.
 * @param actionRow A `shreddit-comment-action-row`, or `null`.
 */
export function getNativeReplyButton (actionRow: Element | null,): HTMLElement | null {
	if (!actionRow) { return null }
	return actionRow.querySelector<HTMLElement>(
		'[slot="comment-reply"] button, button[data-post-click-location="comments-action-reply"], button[aria-label*="reply" i]',
	)
		?? actionRow.querySelector<HTMLElement>('[slot="comment-reply"]',)
}

/**
 * Casts a vote by clicking the comment's native up/down vote button (Reddit's own vote path, which
 * works regardless of the OAuth token's scopes - unlike the REST `/api/vote` endpoint, which the
 * Shreddit web token isn't authorized for). The vote control is a `<shreddit-vote-animations>` whose
 * arrow `<button>`s live in its shadow root; we look in both the action row's light DOM and its
 * shadow for the host. Best-effort selectors - isolated here for an easy fix if Shreddit changes.
 * @param comment A `shreddit-comment` element.
 * @param direction `'up'` to click upvote, `'down'` to click downvote (both toggle, like Reddit).
 * @returns `true` when a native vote button was found and clicked.
 */
export function clickNativeVoteButton (comment: Element, direction: 'up' | 'down',): boolean {
	const actionRow = getCommentActionRow(comment,)
	if (!actionRow) { return false }
	const voteHost = actionRow.querySelector('shreddit-vote-animations',)
		?? actionRow.shadowRoot?.querySelector('shreddit-vote-animations',)
		?? null
	if (!voteHost) { return false }
	const selector = direction === 'up' ? 'button[upvote]' : 'button[downvote]'
	const button = voteHost.shadowRoot?.querySelector<HTMLElement>(selector,)
		?? voteHost.querySelector<HTMLElement>(selector,)
	if (!button) { return false }
	button.click()
	return true
}

/**
 * Shows or hides a comment's native action row inline (the CSS collapse rule keys off
 * {@link NATIVE_ROW_EXPANDED_CLASS}).
 * @param comment A `shreddit-comment` element.
 * @param on `true` to reveal the native row, `false` to collapse it.
 */
export function setNativeRowExpanded (comment: Element, on: boolean,): void {
	comment.classList.toggle(NATIVE_ROW_EXPANDED_CLASS, on,)
}

/**
 * Whether a comment's native action row is currently expanded.
 * @param comment A `shreddit-comment` element.
 */
export function isNativeRowExpanded (comment: Element,): boolean {
	return comment.classList.contains(NATIVE_ROW_EXPANDED_CLASS,)
}
