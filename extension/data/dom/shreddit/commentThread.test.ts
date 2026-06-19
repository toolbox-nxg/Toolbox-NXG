/** Tests for findCommentSortTargets. */

import {afterEach, describe, expect, it, vi,} from 'vitest'
import {
	findCommentSortTargets,
	findComposerTargets,
	findInlineReplyComposerTargets,
	findTopLevelComposerHosts,
} from './commentThread'

function html (markup: string,): Element {
	const container = document.createElement('div',)
	container.innerHTML = markup
	document.body.appendChild(container,)
	return container
}

afterEach(() => {
	document.body.innerHTML = ''
	vi.restoreAllMocks()
},)

// ---------------------------------------------------------------------------
// findCommentSortTargets
// ---------------------------------------------------------------------------

describe('findCommentSortTargets', () => {
	it('finds a div[slot="comment-sort"] with a shreddit-comment-tree ancestor', () => {
		const root = html(`
            <shreddit-comment-tree post-id="t3_abc"
                permalink="/r/testsub/comments/abc/title/">
                <shreddit-comments-sort-dropdown>
                    <div slot="comment-sort"></div>
                </shreddit-comments-sort-dropdown>
            </shreddit-comment-tree>
        `,)
		const [target,] = findCommentSortTargets(root,)
		expect(target.postId,).toBe('t3_abc',)
		expect(target.subreddit,).toBe('testsub',)
	})

	it('skips when toolbox-thread-controls-slot child already present', () => {
		const root = html(`
            <shreddit-comment-tree post-id="t3_abc"
                permalink="/r/testsub/comments/abc/title/">
                <shreddit-comments-sort-dropdown>
                    <div slot="comment-sort">
                        <span class="toolbox-thread-controls-slot"></span>
                    </div>
                </shreddit-comments-sort-dropdown>
            </shreddit-comment-tree>
        `,)
		expect(findCommentSortTargets(root,),).toHaveLength(0,)
	})

	it('falls back to document-level shreddit-comment-tree when no ancestor found', () => {
		// Tree at top of document, sort div injected elsewhere in the page
		const tree = document.createElement('shreddit-comment-tree',)
		tree.setAttribute('post-id', 't3_abc',)
		tree.setAttribute('permalink', '/r/testsub/comments/abc/title/',)
		document.body.appendChild(tree,)

		const sortDiv = document.createElement('div',)
		sortDiv.setAttribute('slot', 'comment-sort',)
		document.body.appendChild(sortDiv,)

		const [target,] = findCommentSortTargets(sortDiv,)
		expect(target?.postId,).toBe('t3_abc',)
	})

	it('skips when shreddit-comment-tree has no post-id or subreddit', () => {
		const root = html(`
            <shreddit-comment-tree>
                <div slot="comment-sort"></div>
            </shreddit-comment-tree>
        `,)
		expect(findCommentSortTargets(root,),).toHaveLength(0,)
	})

	it('handles root being the sort div itself', () => {
		const tree = document.createElement('shreddit-comment-tree',)
		tree.setAttribute('post-id', 't3_abc',)
		tree.setAttribute('permalink', '/r/testsub/comments/abc/title/',)
		const sortDiv = document.createElement('div',)
		sortDiv.setAttribute('slot', 'comment-sort',)
		tree.appendChild(sortDiv,)
		document.body.appendChild(tree,)
		expect(findCommentSortTargets(sortDiv,),).toHaveLength(1,)
	})
})

// ---------------------------------------------------------------------------
// findComposerTargets
// ---------------------------------------------------------------------------

describe('findComposerTargets', () => {
	it('finds a shreddit-composer with a cancel button and comment-composer-host ancestor', () => {
		vi.spyOn(window, 'location', 'get',).mockReturnValue(
			{pathname: '/r/testsub/comments/abc/title/',} as Location,
		)
		const root = html(`
            <comment-composer-host post-id="t3_abc">
                <shreddit-composer>
                    <button id="comment-composer-cancel-button" slot="cancel-button"></button>
                </shreddit-composer>
            </comment-composer-host>
        `,)
		const [target,] = findComposerTargets(root,)
		expect(target.postId,).toBe('t3_abc',)
		expect(target.subreddit,).toBe('testsub',)
	})

	it('skips when toolbox-composer-controls-slot sibling already present', () => {
		vi.spyOn(window, 'location', 'get',).mockReturnValue(
			{pathname: '/r/testsub/comments/abc/title/',} as Location,
		)
		const root = html(`
            <comment-composer-host post-id="t3_abc">
                <shreddit-composer>
                    <span class="toolbox-composer-controls-slot" slot="cancel-button"></span>
                    <button id="comment-composer-cancel-button" slot="cancel-button"></button>
                </shreddit-composer>
            </comment-composer-host>
        `,)
		expect(findComposerTargets(root,),).toHaveLength(0,)
	})

	it('skips when cancel button is absent', () => {
		vi.spyOn(window, 'location', 'get',).mockReturnValue(
			{pathname: '/r/testsub/comments/abc/title/',} as Location,
		)
		const root = html(`
            <comment-composer-host post-id="t3_abc">
                <shreddit-composer></shreddit-composer>
            </comment-composer-host>
        `,)
		expect(findComposerTargets(root,),).toHaveLength(0,)
	})

	it('skips when post-id is missing from comment-composer-host', () => {
		vi.spyOn(window, 'location', 'get',).mockReturnValue(
			{pathname: '/r/testsub/comments/abc/title/',} as Location,
		)
		const root = html(`
            <comment-composer-host>
                <shreddit-composer>
                    <button id="comment-composer-cancel-button" slot="cancel-button"></button>
                </shreddit-composer>
            </comment-composer-host>
        `,)
		expect(findComposerTargets(root,),).toHaveLength(0,)
	})

	it('skips when subreddit cannot be resolved from pathname', () => {
		vi.spyOn(window, 'location', 'get',).mockReturnValue(
			{pathname: '/user/someuser/',} as Location,
		)
		const root = html(`
            <comment-composer-host post-id="t3_abc">
                <shreddit-composer>
                    <button id="comment-composer-cancel-button" slot="cancel-button"></button>
                </shreddit-composer>
            </comment-composer-host>
        `,)
		expect(findComposerTargets(root,),).toHaveLength(0,)
	})
})

// ---------------------------------------------------------------------------
// findInlineReplyComposerTargets
// ---------------------------------------------------------------------------

describe('findInlineReplyComposerTargets', () => {
	it('finds the container and thingid for an inline reply form', () => {
		const root = html(`
			<shreddit-comment thingid="t1_abc">
				<div class="reply-form"><span>Comment as</span></div>
			</shreddit-comment>
		`,)
		const targets = findInlineReplyComposerTargets(root,)
		expect(targets,).toHaveLength(1,)
		expect(targets[0]!.thingId,).toBe('t1_abc',)
		expect(targets[0]!.container,).toBe(root.querySelector('.reply-form',),)
	})

	it('ignores "Comment as" labels outside a shreddit-comment', () => {
		const root = html('<div><span>Comment as</span></div>',)
		expect(findInlineReplyComposerTargets(root,),).toEqual([],)
	})

	it('ignores comments without a thingid', () => {
		const root = html(`
			<shreddit-comment>
				<div><span>Comment as</span></div>
			</shreddit-comment>
		`,)
		expect(findInlineReplyComposerTargets(root,),).toEqual([],)
	})

	it('ignores spans with other text', () => {
		const root = html(`
			<shreddit-comment thingid="t1_abc">
				<div><span>Reply</span></div>
			</shreddit-comment>
		`,)
		expect(findInlineReplyComposerTargets(root,),).toEqual([],)
	})
})

// ---------------------------------------------------------------------------
// findTopLevelComposerHosts
// ---------------------------------------------------------------------------

describe('findTopLevelComposerHosts', () => {
	it('finds composer hosts carrying a post-id', () => {
		const root = html('<comment-composer-host post-id="t3_xyz"></comment-composer-host>',)
		const targets = findTopLevelComposerHosts(root,)
		expect(targets,).toHaveLength(1,)
		expect(targets[0]!.postId,).toBe('t3_xyz',)
		expect(targets[0]!.composerEl,).toBe(root.querySelector('comment-composer-host',),)
	})

	it('finds the root itself when it is the composer host', () => {
		const hostEl = document.createElement('comment-composer-host',)
		hostEl.setAttribute('post-id', 't3_root',)
		document.body.appendChild(hostEl,)
		const targets = findTopLevelComposerHosts(hostEl,)
		expect(targets,).toHaveLength(1,)
		expect(targets[0]!.composerEl,).toBe(hostEl,)
	})

	it('ignores hosts without a post-id', () => {
		const root = html('<comment-composer-host></comment-composer-host>',)
		expect(findTopLevelComposerHosts(root,),).toEqual([],)
	})
})
