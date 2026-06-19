/** Tests for findProfileCommentTargets. */

import {afterEach, describe, expect, it,} from 'vitest'
import {findProfileCommentTargets,} from './userpage'

function html (markup: string,): Element {
	const container = document.createElement('div',)
	container.innerHTML = markup
	document.body.appendChild(container,)
	return container
}

afterEach(() => {
	document.body.innerHTML = ''
},)

describe('findProfileCommentTargets', () => {
	it('finds a profile comment with all required data', () => {
		const root = html(`
            <shreddit-profile-comment
                comment-id="t1_xyz"
                href="/r/testsub/comments/abc123/post_title/xyz/">
                <div id="poster-info-t1_xyz">
                    <a href="/user/alice">alice</a>
                </div>
            </shreddit-profile-comment>
        `,)
		const [target,] = findProfileCommentTargets(root,)
		expect(target.author,).toBe('alice',)
		expect(target.subreddit,).toBe('testsub',)
		expect(target.thingId,).toBe('t1_xyz',)
		expect(target.postId,).toBe('t3_abc123',)
	})

	it('skips already-processed elements', () => {
		const root = html(`
            <shreddit-profile-comment
                comment-id="t1_xyz"
                href="/r/testsub/comments/abc123/post_title/xyz/">
                <div class="toolbox-thing-slot"></div>
                <div id="poster-info-t1_xyz">
                    <a href="/user/alice">alice</a>
                </div>
            </shreddit-profile-comment>
        `,)
		expect(findProfileCommentTargets(root,),).toHaveLength(0,)
	})

	it('skips elements with a non-comment-id (t3_ prefix)', () => {
		const root = html(`
            <shreddit-profile-comment
                comment-id="t3_xyz"
                href="/r/testsub/comments/abc123/post_title/xyz/">
                <div id="poster-info-t3_xyz">
                    <a href="/user/alice">alice</a>
                </div>
            </shreddit-profile-comment>
        `,)
		expect(findProfileCommentTargets(root,),).toHaveLength(0,)
	})

	it('skips elements with a malformed href', () => {
		const root = html(`
            <shreddit-profile-comment comment-id="t1_xyz" href="/u/alice">
                <div id="poster-info-t1_xyz">
                    <a href="/user/alice">alice</a>
                </div>
            </shreddit-profile-comment>
        `,)
		expect(findProfileCommentTargets(root,),).toHaveLength(0,)
	})

	it('skips elements with no poster-info author link', () => {
		const root = html(`
            <shreddit-profile-comment
                comment-id="t1_xyz"
                href="/r/testsub/comments/abc123/post_title/xyz/">
            </shreddit-profile-comment>
        `,)
		expect(findProfileCommentTargets(root,),).toHaveLength(0,)
	})

	it('handles root being the profile comment itself', () => {
		const el = document.createElement('shreddit-profile-comment',)
		el.setAttribute('comment-id', 't1_xyz',)
		el.setAttribute('href', '/r/testsub/comments/abc123/post_title/xyz/',)
		el.innerHTML = '<div id="poster-info-t1_xyz"><a href="/user/alice">alice</a></div>'
		document.body.appendChild(el,)

		const targets = findProfileCommentTargets(el,)
		expect(targets,).toHaveLength(1,)
		expect(targets[0].author,).toBe('alice',)
	})
})
