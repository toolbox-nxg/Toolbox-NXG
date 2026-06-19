/** Tests for the comment action-row helpers. */

import {afterEach, describe, expect, it, vi,} from 'vitest'

import {
	clickNativeVoteButton,
	getCommentActionRow,
	getNativeReplyButton,
	isNativeRowExpanded,
	NATIVE_ROW_EXPANDED_CLASS,
	readVoteState,
	setNativeRowExpanded,
} from './commentActionRow'

afterEach(() => {
	document.body.innerHTML = ''
},)

/** Builds a detached element tree from markup. */
function html (markup: string,): Element {
	const container = document.createElement('div',)
	container.innerHTML = markup
	document.body.appendChild(container,)
	return container
}

describe('getCommentActionRow', () => {
	it('returns the comment\'s own action row, not a nested reply\'s', () => {
		const root = html(`
			<shreddit-comment thingid="t1_parent">
				<div slot="actionRow">
					<shreddit-comment-action-row comment-id="t1_parent"></shreddit-comment-action-row>
				</div>
				<shreddit-comment thingid="t1_child">
					<div slot="actionRow">
						<shreddit-comment-action-row comment-id="t1_child"></shreddit-comment-action-row>
					</div>
				</shreddit-comment>
			</shreddit-comment>
		`,)
		const parent = root.querySelector('shreddit-comment[thingid="t1_parent"]',)!
		const row = getCommentActionRow(parent,)
		expect(row?.getAttribute('comment-id',),).toBe('t1_parent',)
	})

	it('returns null when the action row is not present yet', () => {
		const root = html('<shreddit-comment thingid="t1_x"></shreddit-comment>',)
		expect(getCommentActionRow(root.firstElementChild!,),).toBeNull()
	})
})

describe('readVoteState', () => {
	it('reads score and vote-state', () => {
		const root = html('<shreddit-comment-action-row score="8" vote-state="UP"></shreddit-comment-action-row>',)
		expect(readVoteState(root.firstElementChild,),).toEqual({score: 8, state: 'UP',},)
	})

	it('maps DOWN and defaults unknown states to NONE', () => {
		const down = html('<shreddit-comment-action-row score="3" vote-state="DOWN"></shreddit-comment-action-row>',)
		expect(readVoteState(down.firstElementChild,).state,).toBe('DOWN',)
		const weird = html(
			'<shreddit-comment-action-row score="3" vote-state="WHATEVER"></shreddit-comment-action-row>',
		)
		expect(readVoteState(weird.firstElementChild,).state,).toBe('NONE',)
	})

	it('returns null score when hidden or missing', () => {
		const hidden = html('<shreddit-comment-action-row vote-state="NONE"></shreddit-comment-action-row>',)
		expect(readVoteState(hidden.firstElementChild,).score,).toBeNull()
	})

	it('returns a neutral, score-hidden info for a null row', () => {
		expect(readVoteState(null,),).toEqual({score: null, state: 'NONE',},)
	})
})

describe('getNativeReplyButton', () => {
	it('finds the reply button inside the comment-reply slot', () => {
		const root = html(`
			<shreddit-comment-action-row>
				<span slot="comment-reply"><button data-testid="r">Reply</button></span>
			</shreddit-comment-action-row>
		`,)
		expect(getNativeReplyButton(root.firstElementChild,)?.getAttribute('data-testid',),).toBe('r',)
	})

	it('returns null for a null action row', () => {
		expect(getNativeReplyButton(null,),).toBeNull()
	})
})

describe('clickNativeVoteButton', () => {
	/** Builds a comment whose action row holds a vote host with up/down buttons in its shadow root. */
	function makeVotingComment (): {comment: Element; up: HTMLElement; down: HTMLElement} {
		const root = html(`
			<shreddit-comment thingid="t1_c">
				<shreddit-comment-action-row comment-id="t1_c">
					<shreddit-vote-animations></shreddit-vote-animations>
				</shreddit-comment-action-row>
			</shreddit-comment>
		`,)
		const comment = root.firstElementChild!
		const voteHost = comment.querySelector('shreddit-vote-animations',)!
		const shadow = voteHost.attachShadow({mode: 'open',},)
		shadow.innerHTML = '<button upvote></button><button downvote></button>'
		return {
			comment,
			up: shadow.querySelector('button[upvote]',)!,
			down: shadow.querySelector('button[downvote]',)!,
		}
	}

	it('clicks the upvote / downvote button in the vote host shadow root', () => {
		const {comment, up, down,} = makeVotingComment()
		const upClick = vi.fn()
		const downClick = vi.fn()
		up.addEventListener('click', upClick,)
		down.addEventListener('click', downClick,)

		expect(clickNativeVoteButton(comment, 'up',),).toBe(true,)
		expect(upClick,).toHaveBeenCalledTimes(1,)
		expect(clickNativeVoteButton(comment, 'down',),).toBe(true,)
		expect(downClick,).toHaveBeenCalledTimes(1,)
	})

	it('returns false when the vote control is absent', () => {
		const root = html('<shreddit-comment thingid="t1_c"></shreddit-comment>',)
		expect(clickNativeVoteButton(root.firstElementChild!, 'up',),).toBe(false,)
	})
})

describe('setNativeRowExpanded / isNativeRowExpanded', () => {
	it('toggles the expanded class', () => {
		const root = html('<shreddit-comment thingid="t1_x"></shreddit-comment>',)
		const comment = root.firstElementChild!
		expect(isNativeRowExpanded(comment,),).toBe(false,)
		setNativeRowExpanded(comment, true,)
		expect(comment.classList.contains(NATIVE_ROW_EXPANDED_CLASS,),).toBe(true,)
		expect(isNativeRowExpanded(comment,),).toBe(true,)
		setNativeRowExpanded(comment, false,)
		expect(isNativeRowExpanded(comment,),).toBe(false,)
	})
})
