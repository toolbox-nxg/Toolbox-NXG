/** Tests for getSiteTable. */

import {afterEach, describe, expect, it,} from 'vitest'
import {
	getContentContainer,
	getContentMenuarea,
	getContentNextPrevLinks,
	getCurrentSubredditName,
	getMenuarea,
	getNestedCommentDistinguishToggles,
	getQueueEmptyMessage,
	getQueueTabMenu,
	getSiteTable,
	getUnseenContentThings,
} from './page'

afterEach(() => {
	document.body.innerHTML = ''
},)

describe('getSiteTable', () => {
	it('returns #siteTable', () => {
		document.body.innerHTML = `<div id="siteTable"></div>`
		expect(getSiteTable(),).not.toBeNull()
	})

	it('returns null when absent', () => {
		expect(getSiteTable(),).toBeNull()
	})
})

describe('getQueueEmptyMessage', () => {
	it('returns p#noresults when present', () => {
		document.body.innerHTML = `<p id="noresults">Nothing here.</p>`
		const element = getQueueEmptyMessage()
		expect(element,).not.toBeNull()
		expect(element!.tagName.toLowerCase(),).toBe('p',)
	})

	it('returns null when absent', () => {
		expect(getQueueEmptyMessage(),).toBeNull()
	})
})

describe('getQueueTabMenu', () => {
	it('returns .tabmenu when present', () => {
		document.body.innerHTML = `<ul class="tabmenu"><li>item</li></ul>`
		expect(getQueueTabMenu(),).not.toBeNull()
	})

	it('returns null when absent', () => {
		expect(getQueueTabMenu(),).toBeNull()
	})
})

describe('getCurrentSubredditName', () => {
	it('returns the subreddit name from the sidebar titlebox', () => {
		document.body.innerHTML = `
            <div class="side">
                <div class="titlebox">
                    <h1 class="redditname"><a href="/r/testsub">testsub</a></h1>
                </div>
            </div>
        `
		expect(getCurrentSubredditName(),).toBe('testsub',)
	})

	it('returns null when the sidebar titlebox is absent', () => {
		expect(getCurrentSubredditName(),).toBeNull()
	})
})

describe('getMenuarea', () => {
	it('returns the .menuarea element', () => {
		document.body.innerHTML = `<div class="menuarea"></div>`
		expect(getMenuarea(),).not.toBeNull()
	})

	it('returns null when absent', () => {
		expect(getMenuarea(),).toBeNull()
	})
})

describe('getContentContainer', () => {
	it('returns div.content', () => {
		document.body.innerHTML = `<div class="content"></div>`
		expect(getContentContainer(),).not.toBeNull()
	})

	it('returns null when absent', () => {
		expect(getContentContainer(),).toBeNull()
	})
})

describe('getUnseenContentThings', () => {
	it('returns things in div.content without .toolbox-seen', () => {
		document.body.innerHTML = `
            <div class="content">
                <div class="thing"></div>
                <div class="thing toolbox-seen"></div>
            </div>
        `
		expect(getUnseenContentThings(),).toHaveLength(1,)
	})
})

describe('getContentMenuarea', () => {
	it('returns .content .menuarea when present', () => {
		document.body.innerHTML = `<div class="content"><div class="menuarea"></div></div>`
		expect(getContentMenuarea(),).not.toBeNull()
	})

	it('returns null when absent', () => {
		document.body.innerHTML = `<div class="menuarea"></div>`
		expect(getContentMenuarea(),).toBeNull()
	})
})

describe('getContentNextPrevLinks', () => {
	it('returns .content > .nextprev elements', () => {
		document.body.innerHTML = `
            <div class="content">
                <div class="nextprev">prev | next</div>
            </div>
        `
		expect(getContentNextPrevLinks(),).toHaveLength(1,)
	})

	it('returns empty when not a direct child of content', () => {
		document.body.innerHTML = `
            <div class="content">
                <div><div class="nextprev">nested</div></div>
            </div>
        `
		expect(getContentNextPrevLinks(),).toHaveLength(0,)
	})
})

describe('getNestedCommentDistinguishToggles', () => {
	it('returns distinguish toggle elements in nested comment listings', () => {
		document.body.innerHTML = `
            <div class="sitetable nestedlisting">
                <div class="comment">
                    <div class="entry">
                        <ul class="buttons">
                            <li class="toggle"><a>mod</a></li>
                        </ul>
                    </div>
                </div>
            </div>
        `
		expect(getNestedCommentDistinguishToggles(),).toHaveLength(1,)
	})

	it('returns empty when no nested listing exists', () => {
		expect(getNestedCommentDistinguishToggles(),).toHaveLength(0,)
	})
})
