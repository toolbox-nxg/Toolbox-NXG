/** Tests for findUsernameTargets. */

import {afterEach, describe, expect, it,} from 'vitest'
import {findCommentMetaTargets, findUsernameTargets, getCommentEntryByCommentId,} from './comments'

function html (markup: string,): Element {
	const container = document.createElement('div',)
	container.innerHTML = markup
	document.body.appendChild(container,)
	return container
}

afterEach(() => {
	document.body.innerHTML = ''
},)

// ---------------------------------------------------------------------------
// findUsernameTargets
// ---------------------------------------------------------------------------

describe('findUsernameTargets', () => {
	it('finds a u/ span inside a shreddit-post', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-prefixed-name="r/testsub">
                <span dir="auto">u/alice</span>
            </shreddit-post>
        `,)
		const [target,] = findUsernameTargets(root,)
		expect(target.author,).toBe('alice',)
		expect(target.subreddit,).toBe('testsub',)
		expect(target.postId,).toBe('t3_abc',)
		expect(target.commentId,).toBeUndefined()
	})

	it('finds a u/ span inside a shreddit-comment using permalink for subreddit', () => {
		const root = html(`
            <shreddit-comment thingid="t1_xyz" postid="t3_abc"
                permalink="/r/testsub/comments/abc/comment/xyz/">
                <span dir="auto">u/bob</span>
            </shreddit-comment>
        `,)
		const [target,] = findUsernameTargets(root,)
		expect(target.author,).toBe('bob',)
		expect(target.subreddit,).toBe('testsub',)
		expect(target.commentId,).toBe('t1_xyz',)
		expect(target.postId,).toBe('t3_abc',)
	})

	it('falls back to ancestor shreddit-post subreddit-name when comment has no permalink', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-name="testsub" subreddit-prefixed-name="r/testsub">
                <shreddit-comment thingid="t1_xyz" postid="t3_abc">
                    <span dir="auto">u/carol</span>
                </shreddit-comment>
            </shreddit-post>
        `,)
		const [target,] = findUsernameTargets(root,)
		expect(target.subreddit,).toBe('testsub',)
	})

	it('skips comment u/ spans with no subreddit resolvable', () => {
		const root = html(`
            <shreddit-comment thingid="t1_xyz" postid="t3_abc">
                <span dir="auto">u/nobody</span>
            </shreddit-comment>
        `,)
		expect(findUsernameTargets(root,),).toHaveLength(0,)
	})

	it('ignores spans not starting with u/', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-prefixed-name="r/testsub">
                <span dir="auto">some text</span>
            </shreddit-post>
        `,)
		expect(findUsernameTargets(root,),).toHaveLength(0,)
	})

	it('ignores spans inside mod-notes-opener', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-prefixed-name="r/testsub">
                <mod-notes-opener>
                    <span dir="auto">u/alice</span>
                </mod-notes-opener>
            </shreddit-post>
        `,)
		expect(findUsernameTargets(root,),).toHaveLength(0,)
	})

	it('ignores spans in slot="content" (hover card)', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-prefixed-name="r/testsub">
                <div slot="content">
                    <span dir="auto">u/alice</span>
                </div>
            </shreddit-post>
        `,)
		expect(findUsernameTargets(root,),).toHaveLength(0,)
	})

	it('skips already-processed spans', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-prefixed-name="r/testsub">
                <span dir="auto">u/alice</span>
                <span class="toolbox-author-slot"></span>
            </shreddit-post>
        `,)
		expect(findUsernameTargets(root,),).toHaveLength(0,)
	})

	it('ignores u/ spans not inside a shreddit element', () => {
		const root = html(`<span dir="auto">u/alice</span>`,)
		expect(findUsernameTargets(root,),).toHaveLength(0,)
	})
})

// ---------------------------------------------------------------------------
// getCommentEntryByCommentId
// ---------------------------------------------------------------------------

describe('getCommentEntryByCommentId', () => {
	it('finds a comment entry by id', () => {
		const root = html(`<div data-comment-id="t1_abc"></div>`,)
		const el = getCommentEntryByCommentId(root, 't1_abc',)
		expect(el,).not.toBeNull()
		expect(el!.getAttribute('data-comment-id',),).toBe('t1_abc',)
	})

	it('returns null when comment id is not found', () => {
		const root = html(`<div data-comment-id="t1_other"></div>`,)
		expect(getCommentEntryByCommentId(root, 't1_abc',),).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// findCommentMetaTargets
// ---------------------------------------------------------------------------

describe('findCommentMetaTargets', () => {
	it('finds a commentMeta div with shreddit-comment-badges', () => {
		const root = html(`
            <shreddit-comment thingid="t1_xyz" postid="t3_abc"
                permalink="/r/testsub/comments/abc/comment/xyz/">
                <div slot="commentMeta">
                    <shreddit-comment-badges thing-id="t1_xyz"></shreddit-comment-badges>
                </div>
            </shreddit-comment>
        `,)
		const [target,] = findCommentMetaTargets(root,)
		expect(target.thingId,).toBe('t1_xyz',)
		expect(target.postId,).toBe('t3_abc',)
		expect(target.subreddit,).toBe('testsub',)
		expect(target.badges.tagName.toLowerCase(),).toBe('shreddit-comment-badges',)
	})

	it('skips when toolbox-tagline-status-slot sibling already present', () => {
		const root = html(`
            <shreddit-comment thingid="t1_xyz" postid="t3_abc"
                permalink="/r/testsub/comments/abc/comment/xyz/">
                <div slot="commentMeta">
                    <shreddit-comment-badges thing-id="t1_xyz"></shreddit-comment-badges>
                    <span class="toolbox-tagline-status-slot"></span>
                </div>
            </shreddit-comment>
        `,)
		expect(findCommentMetaTargets(root,),).toHaveLength(0,)
	})

	it('skips when shreddit-comment-badges is absent', () => {
		const root = html(`
            <shreddit-comment thingid="t1_xyz" postid="t3_abc"
                permalink="/r/testsub/comments/abc/comment/xyz/">
                <div slot="commentMeta"></div>
            </shreddit-comment>
        `,)
		expect(findCommentMetaTargets(root,),).toHaveLength(0,)
	})

	it('skips when not inside a shreddit-comment', () => {
		const root = html(`
            <div slot="commentMeta">
                <shreddit-comment-badges></shreddit-comment-badges>
            </div>
        `,)
		expect(findCommentMetaTargets(root,),).toHaveLength(0,)
	})

	it('skips when thingid, postid, or subreddit is missing', () => {
		const root = html(`
            <shreddit-comment>
                <div slot="commentMeta">
                    <shreddit-comment-badges></shreddit-comment-badges>
                </div>
            </shreddit-comment>
        `,)
		expect(findCommentMetaTargets(root,),).toHaveLength(0,)
	})
})
