/** Tests for getSiteTableThings. */

import {afterEach, describe, expect, it,} from 'vitest'
import {
	getAllThingCheckboxes,
	getCollapsedExpandButtons,
	getModReports,
	getPromotedAndRankEls,
	getSiteTableThings,
	getSpamThings,
	getThingCheckbox,
	getThingEditedTimestampEl,
	getThingFlatListContextLink,
	getThingMarkdownEls,
	getThingRemovedAtEl,
	getThingScoreTextEl,
	getThingSubredditEl,
	getThingTimestampEl,
	getThingTitleLinks,
	isThingPromotedPost,
} from './queue'

afterEach(() => {
	document.body.innerHTML = ''
},)

describe('getSiteTableThings', () => {
	it('returns .sitetable .thing elements', () => {
		document.body.innerHTML = `
            <div class="sitetable">
                <div class="thing link"></div>
                <div class="thing comment"></div>
            </div>
            <div class="thing link"></div>
        `
		expect(getSiteTableThings(),).toHaveLength(2,)
	})

	it('returns empty when no sitetable', () => {
		document.body.innerHTML = `<div class="thing link"></div>`
		expect(getSiteTableThings(),).toHaveLength(0,)
	})
})

describe('getThingCheckbox', () => {
	it('returns the checkbox input inside a thing', () => {
		document.body.innerHTML = `<div class="thing"><input type="checkbox" /></div>`
		const thing = document.querySelector('.thing',)!
		expect(getThingCheckbox(thing,),).not.toBeNull()
		expect(getThingCheckbox(thing,)?.type,).toBe('checkbox',)
	})

	it('returns null when absent', () => {
		document.body.innerHTML = `<div class="thing"></div>`
		expect(getThingCheckbox(document.querySelector('.thing',)!,),).toBeNull()
	})
})

describe('getAllThingCheckboxes', () => {
	it('returns all checkboxes within .thing elements', () => {
		document.body.innerHTML = `
            <div class="thing"><input type="checkbox" /></div>
            <div class="thing"><input type="checkbox" /></div>
            <div class="other"><input type="checkbox" /></div>
        `
		expect(getAllThingCheckboxes(),).toHaveLength(2,)
	})
})

describe('getThingTimestampEl', () => {
	it('returns the first non-edited time element in tagline', () => {
		document.body.innerHTML = `
            <div class="thing">
                <div class="entry">
                    <p class="tagline">
                        <time datetime="2024-01-01">Jan 1</time>
                        <time class="edited-timestamp" datetime="2024-01-02">edited</time>
                    </p>
                </div>
            </div>
        `
		const thing = document.querySelector('.thing',)!
		expect(getThingTimestampEl(thing,)?.getAttribute('datetime',),).toBe('2024-01-01',)
	})

	it('returns null when no timestamp exists', () => {
		document.body.innerHTML = `<div class="thing"><div class="entry"></div></div>`
		expect(getThingTimestampEl(document.querySelector('.thing',)!,),).toBeNull()
	})
})

describe('getThingEditedTimestampEl', () => {
	it('returns time.edited-timestamp', () => {
		document.body.innerHTML = `
            <div class="thing">
                <time class="edited-timestamp" datetime="2024-06-01">edited</time>
            </div>
        `
		expect(getThingEditedTimestampEl(document.querySelector('.thing',)!,),).not.toBeNull()
	})

	it('returns null when absent', () => {
		document.body.innerHTML = `<div class="thing"></div>`
		expect(getThingEditedTimestampEl(document.querySelector('.thing',)!,),).toBeNull()
	})
})

describe('getThingRemovedAtEl', () => {
	it('returns li[title^="removed at"]', () => {
		document.body.innerHTML = `
            <div class="thing">
                <li title="removed at 2024-01-01 12:00">removed</li>
            </div>
        `
		expect(getThingRemovedAtEl(document.querySelector('.thing',)!,),).not.toBeNull()
	})

	it('returns null when absent', () => {
		document.body.innerHTML = `<div class="thing"></div>`
		expect(getThingRemovedAtEl(document.querySelector('.thing',)!,),).toBeNull()
	})
})

describe('getThingFlatListContextLink', () => {
	it('returns .flat-list.buttons .first a', () => {
		document.body.innerHTML = `
            <div class="thing">
                <ul class="flat-list buttons">
                    <li class="first"><a href="/r/test/comments/abc/">context</a></li>
                </ul>
            </div>
        `
		expect(getThingFlatListContextLink(document.querySelector('.thing',)!,),).not.toBeNull()
	})

	it('returns null when absent', () => {
		document.body.innerHTML = `<div class="thing"></div>`
		expect(getThingFlatListContextLink(document.querySelector('.thing',)!,),).toBeNull()
	})
})

describe('getSpamThings', () => {
	it('returns .thing.spam elements', () => {
		document.body.innerHTML = `
            <div class="thing spam"></div>
            <div class="thing link"></div>
        `
		expect(getSpamThings(),).toHaveLength(1,)
	})

	it('scopes to a container', () => {
		document.body.innerHTML = `
            <div id="a"><div class="thing spam"></div></div>
            <div id="b"><div class="thing spam"></div></div>
        `
		expect(getSpamThings(document.getElementById('a',)!,),).toHaveLength(1,)
	})
})

describe('getModReports', () => {
	it('returns .report-reasons .mod-report elements', () => {
		document.body.innerHTML = `
            <div class="report-reasons">
                <div class="mod-report">AutoModerator: spam</div>
                <div class="user-report">user report</div>
            </div>
        `
		expect(getModReports(),).toHaveLength(1,)
	})

	it('returns empty when none', () => {
		expect(getModReports(),).toHaveLength(0,)
	})
})

describe('getCollapsedExpandButtons', () => {
	it('returns .entry .collapsed a.expand elements', () => {
		document.body.innerHTML = `
            <div class="entry">
                <div class="collapsed"><a class="expand">[+]</a></div>
            </div>
        `
		expect(getCollapsedExpandButtons(),).toHaveLength(1,)
	})

	it('returns empty when none', () => {
		expect(getCollapsedExpandButtons(),).toHaveLength(0,)
	})
})

describe('isThingPromotedPost', () => {
	it('returns true when .parent ends with [promoted post]', () => {
		document.body.innerHTML = `
            <div class="thing"><div class="parent">[promoted post]</div></div>
        `
		expect(isThingPromotedPost(document.querySelector('.thing',)!,),).toBe(true,)
	})

	it('returns false when .parent does not end with [promoted post]', () => {
		document.body.innerHTML = `
            <div class="thing"><div class="parent">some context</div></div>
        `
		expect(isThingPromotedPost(document.querySelector('.thing',)!,),).toBe(false,)
	})

	it('returns false when .parent is absent', () => {
		document.body.innerHTML = `<div class="thing"></div>`
		expect(isThingPromotedPost(document.querySelector('.thing',)!,),).toBe(false,)
	})
})

describe('getThingSubredditEl', () => {
	it('returns the .subreddit element within a thing', () => {
		document.body.innerHTML = `
            <div class="thing"><a class="subreddit" href="/r/test">r/test</a></div>
        `
		expect(getThingSubredditEl(document.querySelector('.thing',)!,),).not.toBeNull()
	})

	it('returns null when absent', () => {
		document.body.innerHTML = `<div class="thing"></div>`
		expect(getThingSubredditEl(document.querySelector('.thing',)!,),).toBeNull()
	})
})

describe('getPromotedAndRankEls', () => {
	it('returns promoted sitetables and rank elements', () => {
		document.body.innerHTML = `
            <div id="siteTable_promoted"></div>
            <div id="siteTable_organic"></div>
            <span class="rank">1</span>
            <span class="rank">2</span>
        `
		expect(getPromotedAndRankEls(),).toHaveLength(4,)
	})

	it('returns empty when none present', () => {
		expect(getPromotedAndRankEls(),).toHaveLength(0,)
	})
})

describe('getThingMarkdownEls', () => {
	it('returns all .md elements within a thing', () => {
		document.body.innerHTML = `
            <div class="thing">
                <div class="md"><p>body</p></div>
                <div class="md"><p>more</p></div>
            </div>
        `
		expect(getThingMarkdownEls(document.querySelector('.thing',)!,),).toHaveLength(2,)
	})
})

describe('getThingTitleLinks', () => {
	it('returns a.title links within a thing', () => {
		document.body.innerHTML = `
            <div class="thing"><a class="title" href="/r/a/b">Post Title</a></div>
        `
		const thing = document.querySelector('.thing',)!
		expect(getThingTitleLinks(thing,),).toHaveLength(1,)
		expect(getThingTitleLinks(thing,)[0].textContent,).toBe('Post Title',)
	})
})

describe('getThingScoreTextEl', () => {
	it('returns the active score element', () => {
		document.body.innerHTML = `
            <div class="thing unvoted">
                <div class="unvoted"><span class="score unvoted" title="42">42 points</span></div>
            </div>
        `
		const thing = document.querySelector('.thing',)!
		expect(getThingScoreTextEl(thing,),).not.toBeNull()
		expect(getThingScoreTextEl(thing,)?.getAttribute('title',),).toBe('42',)
	})

	it('returns null when no vote-state score is present', () => {
		document.body.innerHTML = `<div class="thing"></div>`
		expect(getThingScoreTextEl(document.querySelector('.thing',)!,),).toBeNull()
	})
})
