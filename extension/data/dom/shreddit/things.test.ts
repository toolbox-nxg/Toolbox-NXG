/** Tests for getThingFromDescendant. */

import {afterEach, describe, expect, it,} from 'vitest'
import {
	collectMatches,
	findCommentFlatListTargets,
	findPostFlatListTargets,
	getNativeApproveButton,
	getNativeRemoveButton,
	getShredditPostDomain,
	getThingContext,
	getThingFromDescendant,
	getThings,
	getThingSubreddit,
	isThingRemoved,
	subredditFromPermalink,
	suppressNativeOverflowModActions,
} from './things'

afterEach(() => {
	document.body.innerHTML = ''
},)

// ---------------------------------------------------------------------------
// getThingFromDescendant
// ---------------------------------------------------------------------------

describe('getThingFromDescendant', () => {
	it('finds the nearest shreddit-post ancestor', () => {
		const post = document.createElement('shreddit-post',)
		const child = document.createElement('span',)
		post.appendChild(child,)
		document.body.appendChild(post,)
		expect(getThingFromDescendant(child,),).toBe(post,)
	})

	it('finds the nearest shreddit-comment ancestor', () => {
		const comment = document.createElement('shreddit-comment',)
		const child = document.createElement('span',)
		comment.appendChild(child,)
		document.body.appendChild(comment,)
		expect(getThingFromDescendant(child,),).toBe(comment,)
	})

	it('prefers the nearest ancestor when nested', () => {
		const post = document.createElement('shreddit-post',)
		const comment = document.createElement('shreddit-comment',)
		const child = document.createElement('span',)
		comment.appendChild(child,)
		post.appendChild(comment,)
		document.body.appendChild(post,)
		expect(getThingFromDescendant(child,),).toBe(comment,)
	})

	it('returns null when there is no thing ancestor', () => {
		const div = document.createElement('div',)
		document.body.appendChild(div,)
		expect(getThingFromDescendant(div,),).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// getShredditPostDomain
// ---------------------------------------------------------------------------

describe('getShredditPostDomain', () => {
	/** Builds a `shreddit-post` with the given attributes for domain extraction. */
	function makePost (attrs: {subreddit?: string; href?: string},): Element {
		const post = document.createElement('shreddit-post',)
		if (attrs.subreddit !== undefined) { post.setAttribute('subreddit-name', attrs.subreddit,) }
		if (attrs.href !== undefined) { post.setAttribute('content-href', attrs.href,) }
		return post
	}

	it('returns the hostname for a link post', () => {
		const post = makePost({subreddit: 'pics', href: 'https://imgur.com/abc',},)
		expect(getShredditPostDomain(post,),).toBe('imgur.com',)
	})

	it('strips a leading www. so it matches old Reddit display domains', () => {
		const post = makePost({subreddit: 'news', href: 'https://www.nytimes.com/story',},)
		expect(getShredditPostDomain(post,),).toBe('nytimes.com',)
	})

	it('preserves non-www subdomains', () => {
		const post = makePost({subreddit: 'pics', href: 'https://i.imgur.com/abc.jpg',},)
		expect(getShredditPostDomain(post,),).toBe('i.imgur.com',)
	})

	it('lowercases the hostname', () => {
		const post = makePost({subreddit: 'pics', href: 'https://WWW.Example.COM/x',},)
		expect(getShredditPostDomain(post,),).toBe('example.com',)
	})

	it('returns self.<subreddit> for a reddit permalink', () => {
		const post = makePost({subreddit: 'aww', href: 'https://www.reddit.com/r/aww/comments/1',},)
		expect(getShredditPostDomain(post,),).toBe('self.aww',)
	})

	it('returns self.<subreddit> when content-href is missing', () => {
		const post = makePost({subreddit: 'aww',},)
		expect(getShredditPostDomain(post,),).toBe('self.aww',)
	})

	it('returns self.<subreddit> for an unparseable href', () => {
		const post = makePost({subreddit: 'aww', href: 'not a url',},)
		expect(getShredditPostDomain(post,),).toBe('self.aww',)
	})

	it('returns null when the subreddit name is unavailable', () => {
		const post = makePost({},)
		expect(getShredditPostDomain(post,),).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// getThings / getThingSubreddit
// ---------------------------------------------------------------------------

describe('getThings', () => {
	it('returns div.thing elements', () => {
		document.body.innerHTML = '<div class="thing"></div><div class="thing"></div>'
		expect(getThings(document.body,),).toHaveLength(2,)
	})

	it('returns empty array when none present', () => {
		expect(getThings(document.body,),).toHaveLength(0,)
	})
})

describe('getThingSubreddit', () => {
	it('returns the data-subreddit attribute', () => {
		const thing = document.createElement('div',)
		thing.setAttribute('data-subreddit', 'testsub',)
		expect(getThingSubreddit(thing,),).toBe('testsub',)
	})

	it('returns null when attribute is absent', () => {
		expect(getThingSubreddit(document.createElement('div',),),).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// isThingRemoved
// ---------------------------------------------------------------------------

describe('isThingRemoved', () => {
	it('returns true for the legacy removed attribute', () => {
		const el = document.createElement('shreddit-post',)
		el.setAttribute('removed', '',)
		expect(isThingRemoved(el,),).toBe(true,)
	})

	it('returns true for item-state="REMOVED"', () => {
		const el = document.createElement('shreddit-post',)
		el.setAttribute('item-state', 'REMOVED',)
		expect(isThingRemoved(el,),).toBe(true,)
	})

	it('returns true for moderation-verdict="MOD_REMOVED"', () => {
		const el = document.createElement('shreddit-post',)
		el.setAttribute('moderation-verdict', 'MOD_REMOVED',)
		expect(isThingRemoved(el,),).toBe(true,)
	})

	it('returns false for an unmoderated element', () => {
		const el = document.createElement('shreddit-post',)
		el.setAttribute('item-state', 'UNMODERATED',)
		el.setAttribute('moderation-verdict', 'MOD_APPROVED',)
		expect(isThingRemoved(el,),).toBe(false,)
	})

	it('returns false when no removal signals are present', () => {
		expect(isThingRemoved(document.createElement('shreddit-post',),),).toBe(false,)
	})
})

// ---------------------------------------------------------------------------
// subredditFromPermalink
// ---------------------------------------------------------------------------

describe('subredditFromPermalink', () => {
	it('extracts subreddit from a standard permalink', () => {
		expect(subredditFromPermalink('/r/testsub/comments/abc123/post_title/',),).toBe('testsub',)
	})

	it('extracts subreddit from a comment permalink', () => {
		expect(subredditFromPermalink('/r/dirtypenpals/comments/1tranwv/comment/oomeanv/',),).toBe('dirtypenpals',)
	})

	it('returns empty string for an empty input', () => {
		expect(subredditFromPermalink('',),).toBe('',)
	})

	it('returns empty string for a malformed permalink', () => {
		expect(subredditFromPermalink('/u/someuser',),).toBe('',)
	})
})

// ---------------------------------------------------------------------------
// findPostFlatListTargets
// ---------------------------------------------------------------------------

function html (markup: string,): Element {
	const container = document.createElement('div',)
	container.innerHTML = markup
	document.body.appendChild(container,)
	return container
}

describe('findPostFlatListTargets', () => {
	it('finds a post with a mod-content-actions child', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-name="testsub">
                <mod-content-actions slot="mod-content-actions"></mod-content-actions>
            </shreddit-post>
        `,)
		const [target,] = findPostFlatListTargets(root,)
		expect(target.thingId,).toBe('t3_abc',)
		expect(target.subreddit,).toBe('testsub',)
		expect(target.isRemoved,).toBe(false,)
	})

	it('reports isRemoved correctly', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-name="testsub" item-state="REMOVED">
                <mod-content-actions slot="mod-content-actions"></mod-content-actions>
            </shreddit-post>
        `,)
		const [target,] = findPostFlatListTargets(root,)
		expect(target.isRemoved,).toBe(true,)
	})

	it('skips when the post already has a toolbox-flat-list-slot', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-name="testsub">
                <mod-content-actions slot="mod-content-actions"></mod-content-actions>
                <span class="toolbox-flat-list-slot"></span>
            </shreddit-post>
        `,)
		expect(findPostFlatListTargets(root,),).toHaveLength(0,)
	})

	it('skips when a slot already lives in the post\'s toolbox-thing-slot', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-name="testsub">
                <mod-content-actions slot="mod-content-actions"></mod-content-actions>
                <div class="toolbox-thing-slot"><span class="toolbox-flat-list-slot"></span></div>
            </shreddit-post>
        `,)
		expect(findPostFlatListTargets(root,),).toHaveLength(0,)
	})

	it('skips posts missing mod-content-actions child', () => {
		const root = html(`<shreddit-post id="t3_abc" subreddit-name="testsub"></shreddit-post>`,)
		expect(findPostFlatListTargets(root,),).toHaveLength(0,)
	})

	it('skips posts missing id or subreddit-name', () => {
		const root = html(`
            <shreddit-post>
                <mod-content-actions slot="mod-content-actions"></mod-content-actions>
            </shreddit-post>
        `,)
		expect(findPostFlatListTargets(root,),).toHaveLength(0,)
	})

	it('handles root being a shreddit-post itself', () => {
		const root = document.createElement('shreddit-post',)
		root.setAttribute('id', 't3_abc',)
		root.setAttribute('subreddit-name', 'testsub',)
		const mca = document.createElement('mod-content-actions',)
		mca.setAttribute('slot', 'mod-content-actions',)
		root.appendChild(mca,)
		document.body.appendChild(root,)
		expect(findPostFlatListTargets(root,),).toHaveLength(1,)
	})
})

// ---------------------------------------------------------------------------
// findCommentFlatListTargets
// ---------------------------------------------------------------------------

describe('findCommentFlatListTargets', () => {
	it('finds a comment action row with a mod-content-actions child', () => {
		const root = html(`
            <shreddit-comment thingid="t1_xyz" postid="t3_abc"
                permalink="/r/testsub/comments/abc/comment/xyz/">
                <shreddit-comment-action-row slot="actionRow" comment-id="t1_xyz">
                    <mod-content-actions slot="mod-content-actions"></mod-content-actions>
                </shreddit-comment-action-row>
            </shreddit-comment>
        `,)
		const [target,] = findCommentFlatListTargets(root,)
		expect(target.thingId,).toBe('t1_xyz',)
		expect(target.postId,).toBe('t3_abc',)
		expect(target.subreddit,).toBe('testsub',)
		expect(target.isRemoved,).toBe(false,)
		// Anchored on the action row (so the slot lands under this comment's bar, not the nest end).
		expect(target.actionRow.tagName.toLowerCase(),).toBe('shreddit-comment-action-row',)
	})

	it('skips when a slot already sits before the action row (real-DOM shape)', () => {
		const root = html(`
            <shreddit-comment thingid="t1_xyz" postid="t3_abc"
                permalink="/r/testsub/comments/abc/comment/xyz/">
                <div slot="actionRow">
                    <span class="toolbox-flat-list-slot"></span>
                    <shreddit-comment-action-row slot="actionRow" comment-id="t1_xyz">
                        <mod-content-actions slot="mod-content-actions"></mod-content-actions>
                    </shreddit-comment-action-row>
                </div>
            </shreddit-comment>
        `,)
		expect(findCommentFlatListTargets(root,),).toHaveLength(0,)
	})

	it('skips when the comment already has a toolbox-flat-list-slot', () => {
		const root = html(`
            <shreddit-comment thingid="t1_xyz" postid="t3_abc"
                permalink="/r/testsub/comments/abc/comment/xyz/">
                <shreddit-comment-action-row slot="actionRow" comment-id="t1_xyz">
                    <mod-content-actions slot="mod-content-actions"></mod-content-actions>
                </shreddit-comment-action-row>
                <span class="toolbox-flat-list-slot"></span>
            </shreddit-comment>
        `,)
		expect(findCommentFlatListTargets(root,),).toHaveLength(0,)
	})

	it('does not treat a nested reply\'s slot as the parent comment\'s', () => {
		const root = html(`
            <shreddit-comment thingid="t1_parent" postid="t3_abc"
                permalink="/r/testsub/comments/abc/comment/parent/">
                <shreddit-comment-action-row slot="actionRow" comment-id="t1_parent">
                    <mod-content-actions slot="mod-content-actions"></mod-content-actions>
                </shreddit-comment-action-row>
                <shreddit-comment thingid="t1_child" postid="t3_abc"
                    permalink="/r/testsub/comments/abc/comment/child/">
                    <span class="toolbox-flat-list-slot"></span>
                </shreddit-comment>
            </shreddit-comment>
        `,)
		// The parent still needs a slot even though a nested reply already carries one.
		const ids = findCommentFlatListTargets(root,).map((t,) => t.thingId)
		expect(ids,).toContain('t1_parent',)
	})

	it('skips when postId or subreddit cannot be resolved', () => {
		const root = html(`
            <shreddit-comment-action-row comment-id="t1_xyz">
                <mod-content-actions slot="mod-content-actions"></mod-content-actions>
            </shreddit-comment-action-row>
        `,)
		expect(findCommentFlatListTargets(root,),).toHaveLength(0,)
	})
})

// ---------------------------------------------------------------------------
// collectMatches
// ---------------------------------------------------------------------------

describe('collectMatches', () => {
	it('includes the root itself when it matches', () => {
		const post = document.createElement('shreddit-post',)
		document.body.appendChild(post,)
		expect(collectMatches(post, 'shreddit-post',),).toEqual([post,],)
	})

	it('includes matching descendants', () => {
		const wrapper = document.createElement('div',)
		const a = document.createElement('shreddit-post',)
		const b = document.createElement('shreddit-post',)
		wrapper.append(a, b,)
		document.body.appendChild(wrapper,)
		expect(collectMatches(wrapper, 'shreddit-post',),).toEqual([a, b,],)
	})

	it('includes both the matching root and its matching descendants', () => {
		const outer = document.createElement('div',)
		outer.className = 'x'
		const inner = document.createElement('div',)
		inner.className = 'x'
		outer.appendChild(inner,)
		document.body.appendChild(outer,)
		expect(collectMatches(outer, '.x',),).toEqual([outer, inner,],)
	})

	it('accepts a Document root', () => {
		const post = document.createElement('shreddit-post',)
		document.body.appendChild(post,)
		expect(collectMatches(document, 'shreddit-post',),).toEqual([post,],)
	})

	it('returns an empty array when nothing matches', () => {
		const div = document.createElement('div',)
		document.body.appendChild(div,)
		expect(collectMatches(div, 'shreddit-post',),).toEqual([],)
	})
})

// ---------------------------------------------------------------------------
// getThingContext
// ---------------------------------------------------------------------------

describe('getThingContext', () => {
	it('extracts comment context from thingid and permalink', () => {
		const comment = document.createElement('shreddit-comment',)
		comment.setAttribute('thingid', 't1_abc',)
		comment.setAttribute('permalink', '/r/mysub/comments/xyz/title/abc/',)
		expect(getThingContext(comment,),).toEqual({thingId: 't1_abc', subreddit: 'mysub', isComment: true,},)
	})

	it('extracts post context from id and subreddit-prefixed-name', () => {
		const post = document.createElement('shreddit-post',)
		post.setAttribute('id', 't3_def',)
		post.setAttribute('subreddit-prefixed-name', 'r/mysub',)
		expect(getThingContext(post,),).toEqual({thingId: 't3_def', subreddit: 'mysub', isComment: false,},)
	})

	it('falls back to subreddit-name when the prefixed attribute is absent', () => {
		const item = document.createElement('mod-queue-list-item',)
		item.setAttribute('id', 't1_ghi',)
		item.setAttribute('subreddit-name', 'othersub',)
		expect(getThingContext(item,),).toEqual({thingId: 't1_ghi', subreddit: 'othersub', isComment: true,},)
	})

	it('returns null when the fullname is missing', () => {
		const post = document.createElement('shreddit-post',)
		post.setAttribute('subreddit-prefixed-name', 'r/mysub',)
		expect(getThingContext(post,),).toBeNull()
	})

	it('returns null when the subreddit is missing', () => {
		const comment = document.createElement('shreddit-comment',)
		comment.setAttribute('thingid', 't1_abc',)
		expect(getThingContext(comment,),).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// getNativeRemoveButton
// ---------------------------------------------------------------------------

describe('getNativeRemoveButton', () => {
	it('prefers the mod-action-button custom element', () => {
		const thing = document.createElement('shreddit-post',)
		const modAction = document.createElement('mod-action-button',)
		modAction.setAttribute('data-mod-action', 'mod-remove-content',)
		const testId = document.createElement('button',)
		testId.setAttribute('data-testid', 'remove',)
		thing.append(modAction, testId,)
		expect(getNativeRemoveButton(thing,),).toBe(modAction,)
	})

	it('falls back to the data-testid button', () => {
		const thing = document.createElement('shreddit-post',)
		const testId = document.createElement('button',)
		testId.setAttribute('data-testid', 'remove',)
		thing.appendChild(testId,)
		expect(getNativeRemoveButton(thing,),).toBe(testId,)
	})

	it('falls back to the data-item-id button', () => {
		const thing = document.createElement('shreddit-post',)
		const itemId = document.createElement('button',)
		itemId.setAttribute('data-item-id', 'remove',)
		thing.appendChild(itemId,)
		expect(getNativeRemoveButton(thing,),).toBe(itemId,)
	})

	it('returns null when no remove control exists', () => {
		const thing = document.createElement('shreddit-post',)
		expect(getNativeRemoveButton(thing,),).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// getNativeApproveButton
// ---------------------------------------------------------------------------

describe('getNativeApproveButton', () => {
	it('prefers the mod-action-button custom element', () => {
		const thing = document.createElement('shreddit-post',)
		const modAction = document.createElement('mod-action-button',)
		modAction.setAttribute('data-mod-action', 'mod-approve-content',)
		const testId = document.createElement('button',)
		testId.setAttribute('data-testid', 'approve',)
		thing.append(modAction, testId,)
		expect(getNativeApproveButton(thing,),).toBe(modAction,)
	})

	it('falls back to the data-testid button', () => {
		const thing = document.createElement('shreddit-post',)
		const testId = document.createElement('button',)
		testId.setAttribute('data-testid', 'approve',)
		thing.appendChild(testId,)
		expect(getNativeApproveButton(thing,),).toBe(testId,)
	})

	it('falls back to the data-item-id button', () => {
		const thing = document.createElement('shreddit-post',)
		const itemId = document.createElement('button',)
		itemId.setAttribute('data-item-id', 'approve',)
		thing.appendChild(itemId,)
		expect(getNativeApproveButton(thing,),).toBe(itemId,)
	})

	it('returns null when no approve control exists', () => {
		const thing = document.createElement('shreddit-post',)
		expect(getNativeApproveButton(thing,),).toBeNull()
	})

	it('does not mistake a remove control for approve', () => {
		const thing = document.createElement('shreddit-post',)
		const modAction = document.createElement('mod-action-button',)
		modAction.setAttribute('data-mod-action', 'mod-remove-content',)
		thing.appendChild(modAction,)
		expect(getNativeApproveButton(thing,),).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// suppressNativeOverflowModActions
// ---------------------------------------------------------------------------

describe('suppressNativeOverflowModActions', () => {
	it('removes should-include-mod-actions from the overflow menu and restores it on cleanup', () => {
		const post = document.createElement('shreddit-post',)
		const menu = document.createElement('unpacking-overflow-menu',)
		menu.setAttribute('should-include-mod-actions', '',)
		post.appendChild(menu,)

		const restore = suppressNativeOverflowModActions(post,)
		expect(menu.hasAttribute('should-include-mod-actions',),).toBe(false,)

		restore()
		expect(menu.hasAttribute('should-include-mod-actions',),).toBe(true,)
	})

	it('strips every overflow menu under the thing', () => {
		const post = document.createElement('shreddit-post',)
		for (let i = 0; i < 2; i++) {
			const menu = document.createElement('unpacking-overflow-menu',)
			menu.setAttribute('should-include-mod-actions', '',)
			post.appendChild(menu,)
		}

		suppressNativeOverflowModActions(post,)
		expect(post.querySelectorAll('unpacking-overflow-menu[should-include-mod-actions]',),).toHaveLength(0,)
	})

	it('is a no-op (no throw) when the thing has no overflow menu', () => {
		const post = document.createElement('shreddit-post',)
		expect(() => suppressNativeOverflowModActions(post,)()).not.toThrow()
	})
})
