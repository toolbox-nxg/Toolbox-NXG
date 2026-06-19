/** Tests for findCreditBarTargets. */

import {afterEach, describe, expect, it,} from 'vitest'
import {findCreditBarTargets, findHighlightCardTargets,} from './feed'

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
// findCreditBarTargets
// ---------------------------------------------------------------------------

describe('findCreditBarTargets', () => {
	it('finds a mod-notes credit bar target', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-prefixed-name="r/testsub">
                <div id="feed-post-credit-bar-abc">
                    <div class="created-separator"></div>
                    <mod-notes-opener user-name="alice" subreddit-name="testsub"
                        thing-id="t3_abc" post-id="t3_abc"></mod-notes-opener>
                </div>
            </shreddit-post>
        `,)
		const [target,] = findCreditBarTargets(root,)
		expect(target.kind,).toBe('mod-notes',)
		if (target.kind === 'mod-notes') {
			expect(target.author,).toBe('alice',)
			expect(target.subreddit,).toBe('testsub',)
			expect(target.thingId,).toBe('t3_abc',)
			expect(target.isCompact,).toBe(false,)
			expect(target.needsThingContainer,).toBe(true,)
		}
	})

	it('detects compact view correctly', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-prefixed-name="r/testsub" view-type="compactView">
                <div id="feed-post-credit-bar-abc">
                    <div class="created-separator"></div>
                    <mod-notes-opener user-name="alice" subreddit-name="testsub"
                        thing-id="t3_abc" post-id="t3_abc"></mod-notes-opener>
                </div>
            </shreddit-post>
        `,)
		const [target,] = findCreditBarTargets(root,)
		expect(target.kind,).toBe('mod-notes',)
		if (target.kind === 'mod-notes') {
			expect(target.isCompact,).toBe(true,)
		}
	})

	it('sets needsThingContainer to false when postEl already has one', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-prefixed-name="r/testsub">
                <div id="feed-post-credit-bar-abc">
                    <div class="created-separator"></div>
                    <mod-notes-opener user-name="alice" subreddit-name="testsub"
                        thing-id="t3_abc" post-id="t3_abc"></mod-notes-opener>
                </div>
                <div class="toolbox-thing-slot"></div>
            </shreddit-post>
        `,)
		const [target,] = findCreditBarTargets(root,)
		expect(target.kind,).toBe('mod-notes',)
		if (target.kind === 'mod-notes') {
			expect(target.needsThingContainer,).toBe(false,)
		}
	})

	it('finds a feed-only credit bar target', () => {
		const root = html(`
            <shreddit-post id="t3_abc" author="alice" subreddit-prefixed-name="r/testsub">
                <div id="feed-post-credit-bar-abc">
                    <div class="created-separator"></div>
                </div>
            </shreddit-post>
        `,)
		const [target,] = findCreditBarTargets(root,)
		expect(target.kind,).toBe('feed-only',)
		if (target.kind === 'feed-only') {
			expect(target.author,).toBe('alice',)
			expect(target.subreddit,).toBe('testsub',)
			expect(target.postId,).toBe('t3_abc',)
		}
	})

	it('skips credit bars without a .created-separator', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-prefixed-name="r/testsub">
                <div id="feed-post-credit-bar-abc">
                    <mod-notes-opener user-name="alice" subreddit-name="testsub"
                        thing-id="t3_abc" post-id="t3_abc"></mod-notes-opener>
                </div>
            </shreddit-post>
        `,)
		expect(findCreditBarTargets(root,),).toHaveLength(0,)
	})

	it('skips already-processed credit bars', () => {
		const root = html(`
            <shreddit-post id="t3_abc" subreddit-prefixed-name="r/testsub">
                <div id="feed-post-credit-bar-abc">
                    <span class="toolbox-author-slot"></span>
                    <div class="created-separator"></div>
                </div>
            </shreddit-post>
        `,)
		expect(findCreditBarTargets(root,),).toHaveLength(0,)
	})

	it('handles root being the credit bar itself', () => {
		const postEl = document.createElement('shreddit-post',)
		postEl.setAttribute('id', 't3_abc',)
		postEl.setAttribute('author', 'alice',)
		postEl.setAttribute('subreddit-prefixed-name', 'r/testsub',)

		const creditBar = document.createElement('div',)
		creditBar.id = 'feed-post-credit-bar-abc'
		creditBar.innerHTML = '<div class="created-separator"></div>'
		postEl.appendChild(creditBar,)
		document.body.appendChild(postEl,)

		const targets = findCreditBarTargets(creditBar,)
		expect(targets,).toHaveLength(1,)
		expect(targets[0].kind,).toBe('feed-only',)
	})

	it('detects hasNativeAuthor when slot="authorName" is present', () => {
		const root = html(`
            <shreddit-post id="t3_abc" author="alice" subreddit-prefixed-name="r/testsub">
                <div id="feed-post-credit-bar-abc">
                    <span slot="authorName">alice</span>
                    <div class="created-separator"></div>
                </div>
            </shreddit-post>
        `,)
		const [target,] = findCreditBarTargets(root,)
		expect(target.kind,).toBe('feed-only',)
		if (target.kind === 'feed-only') {
			expect(target.hasNativeAuthor,).toBe(true,)
		}
	})
})

// ---------------------------------------------------------------------------
// findHighlightCardTargets
// ---------------------------------------------------------------------------

describe('findHighlightCardTargets', () => {
	it('finds a highlight card with all required attributes', () => {
		const root = html(`
            <community-highlight-card author-id="alice"
                id="highlight_card_t3_abc"
                subreddit-prefixed-name="r/testsub">
                <div slot="label">
                    <img alt="alice" src="https://example.com/avatar.jpg">
                </div>
            </community-highlight-card>
        `,)
		const [target,] = findHighlightCardTargets(root,)
		expect(target.author,).toBe('alice',)
		expect(target.subreddit,).toBe('testsub',)
		expect(target.postId,).toBe('t3_abc',)
		expect(target.avatarSrc,).toBe('https://example.com/avatar.jpg',)
		expect(target.titleEl,).toBeNull()
	})

	it('returns the existing title slot element when present', () => {
		const root = html(`
            <community-highlight-card author-id="alice"
                id="highlight_card_t3_abc"
                subreddit-prefixed-name="r/testsub">
                <div slot="label">
                    <img alt="alice" src="https://example.com/avatar.jpg">
                </div>
                <h2 slot="title">Post title</h2>
            </community-highlight-card>
        `,)
		const [target,] = findHighlightCardTargets(root,)
		expect(target.titleEl,).not.toBeNull()
		expect(target.titleEl!.tagName.toLowerCase(),).toBe('h2',)
	})

	it('skips cards without author-id attribute', () => {
		const root = html(`
            <community-highlight-card id="highlight_card_t3_abc"
                subreddit-prefixed-name="r/testsub">
                <div slot="label"><img alt="alice" src="x.jpg"></div>
            </community-highlight-card>
        `,)
		expect(findHighlightCardTargets(root,),).toHaveLength(0,)
	})

	it('skips already-processed cards', () => {
		const root = html(`
            <community-highlight-card author-id="alice"
                id="highlight_card_t3_abc"
                subreddit-prefixed-name="r/testsub">
                <div slot="label"><img alt="alice" src="x.jpg"></div>
                <span class="toolbox-author-slot"></span>
            </community-highlight-card>
        `,)
		expect(findHighlightCardTargets(root,),).toHaveLength(0,)
	})

	it('skips cards without a label slot', () => {
		const root = html(`
            <community-highlight-card author-id="alice"
                id="highlight_card_t3_abc"
                subreddit-prefixed-name="r/testsub">
            </community-highlight-card>
        `,)
		expect(findHighlightCardTargets(root,),).toHaveLength(0,)
	})

	it('skips cards where the label slot has no img[alt]', () => {
		const root = html(`
            <community-highlight-card author-id="alice"
                id="highlight_card_t3_abc"
                subreddit-prefixed-name="r/testsub">
                <div slot="label"><span>no image here</span></div>
            </community-highlight-card>
        `,)
		expect(findHighlightCardTargets(root,),).toHaveLength(0,)
	})

	it('handles root being the highlight card itself', () => {
		const card = document.createElement('community-highlight-card',)
		card.setAttribute('author-id', 'alice',)
		card.setAttribute('id', 'highlight_card_t3_abc',)
		card.setAttribute('subreddit-prefixed-name', 'r/testsub',)
		card.innerHTML = '<div slot="label"><img alt="alice" src="x.jpg"></div>'
		document.body.appendChild(card,)

		const targets = findHighlightCardTargets(card,)
		expect(targets,).toHaveLength(1,)
		expect(targets[0].author,).toBe('alice',)
	})
})
