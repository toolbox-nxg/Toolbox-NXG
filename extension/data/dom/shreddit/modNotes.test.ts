/** Tests for findModNotesTargets. */

import {afterEach, describe, expect, it,} from 'vitest'
import {findModNotesTargets,} from './modNotes'

function html (markup: string,): Element {
	const container = document.createElement('div',)
	container.innerHTML = markup
	document.body.appendChild(container,)
	return container
}

afterEach(() => {
	document.body.innerHTML = ''
},)

describe('findModNotesTargets', () => {
	it('finds a basic post-author opener', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-prefixed-name="r/testsub">
                <mod-notes-opener user-name="alice" subreddit-name="testsub"
                    thing-id="t3_abc" post-id="t3_abc"></mod-notes-opener>
            </shreddit-post>
        `,)
		const [target,] = findModNotesTargets(root,)
		expect(target.author,).toBe('alice',)
		expect(target.subreddit,).toBe('testsub',)
		expect(target.thingId,).toBe('t3_abc',)
		expect(target.postId,).toBe('t3_abc',)
		expect(target.conversationId,).toBeNull()
	})

	it('finds a comment-author opener', () => {
		const root = html(`
            <shreddit-comment thingid="t1_xyz" postid="t3_abc"
                permalink="/r/testsub/comments/abc/comment/xyz/">
                <mod-notes-opener user-name="bob" subreddit-name="testsub"
                    thing-id="t1_xyz" post-id="t3_abc"></mod-notes-opener>
            </shreddit-comment>
        `,)
		const [target,] = findModNotesTargets(root,)
		expect(target.author,).toBe('bob',)
		expect(target.thingId,).toBe('t1_xyz',)
		expect(target.postId,).toBe('t3_abc',)
	})

	it('reads conversation-id for modmail openers', () => {
		const root = html(`
            <mod-notes-opener user-name="alice" subreddit-name="testsub"
                thing-id="t3_abc" post-id="t3_abc"
                conversation-id="conv123"></mod-notes-opener>
        `,)
		const [target,] = findModNotesTargets(root,)
		expect(target.conversationId,).toBe('conv123',)
	})

	it('skips openers inside feed credit bars', () => {
		const root = html(`
            <div id="feed-post-credit-bar-abc">
                <mod-notes-opener user-name="alice" subreddit-name="testsub"
                    thing-id="t3_abc" post-id="t3_abc"></mod-notes-opener>
            </div>
        `,)
		expect(findModNotesTargets(root,),).toHaveLength(0,)
	})

	it('skips openers in slot="content" (hover card)', () => {
		const root = html(`
            <div slot="content">
                <mod-notes-opener user-name="alice" subreddit-name="testsub"
                    thing-id="t3_abc" post-id="t3_abc"></mod-notes-opener>
            </div>
        `,)
		expect(findModNotesTargets(root,),).toHaveLength(0,)
	})

	it('skips openers in slot="commentAvatar"', () => {
		const root = html(`
            <div slot="commentAvatar">
                <mod-notes-opener user-name="alice" subreddit-name="testsub"
                    thing-id="t3_abc" post-id="t3_abc"></mod-notes-opener>
            </div>
        `,)
		expect(findModNotesTargets(root,),).toHaveLength(0,)
	})

	it('skips openers already marked with a .toolbox-author-slot sibling', () => {
		const root = html(`
            <mod-notes-opener user-name="alice" subreddit-name="testsub"
                thing-id="t3_abc" post-id="t3_abc"></mod-notes-opener>
            <span class="toolbox-author-slot"></span>
        `,)
		expect(findModNotesTargets(root,),).toHaveLength(0,)
	})

	it('skips openers with missing user-name or subreddit-name', () => {
		const root = html(`
            <mod-notes-opener subreddit-name="testsub" thing-id="t3_abc" post-id="t3_abc"></mod-notes-opener>
        `,)
		expect(findModNotesTargets(root,),).toHaveLength(0,)
	})

	it('sets thingAncestor when the ancestor has no .toolbox-thing-slot', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-prefixed-name="r/testsub">
                <mod-notes-opener user-name="alice" subreddit-name="testsub"
                    thing-id="t3_abc" post-id="t3_abc"></mod-notes-opener>
            </shreddit-post>
        `,)
		const [target,] = findModNotesTargets(root,)
		expect(target.thingAncestor,).not.toBeNull()
		expect(target.thingAncestor!.tagName.toLowerCase(),).toBe('shreddit-post',)
	})

	it('sets thingAncestor to null when the ancestor already has a .toolbox-thing-slot', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-prefixed-name="r/testsub">
                <mod-notes-opener user-name="alice" subreddit-name="testsub"
                    thing-id="t3_abc" post-id="t3_abc"></mod-notes-opener>
                <div class="toolbox-thing-slot"></div>
            </shreddit-post>
        `,)
		const [target,] = findModNotesTargets(root,)
		expect(target.thingAncestor,).toBeNull()
	})

	it('detects isRemoved via item-state="REMOVED"', () => {
		const root = html(`
            <shreddit-post id="t3_abc" item-state="REMOVED">
                <mod-notes-opener user-name="alice" subreddit-name="testsub"
                    thing-id="t3_abc" post-id="t3_abc"></mod-notes-opener>
            </shreddit-post>
        `,)
		const [target,] = findModNotesTargets(root,)
		expect(target.isRemoved,).toBe(true,)
	})

	it('detects isRemoved via moderation-verdict="MOD_REMOVED"', () => {
		const root = html(`
            <shreddit-post id="t3_abc" moderation-verdict="MOD_REMOVED">
                <mod-notes-opener user-name="alice" subreddit-name="testsub"
                    thing-id="t3_abc" post-id="t3_abc"></mod-notes-opener>
            </shreddit-post>
        `,)
		const [target,] = findModNotesTargets(root,)
		expect(target.isRemoved,).toBe(true,)
	})
})
