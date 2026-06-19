/** Tests for queue sorting. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

vi.mock('../../../util/reddit/pageContext', () => ({
	isModpage: false,
}),)

import {appendNewItems, groupBySubreddit, groupThings, sortThings, ungroupBySubreddit,} from './queueSorting'

beforeEach(() => {
	document.body.innerHTML = ''
},)

function thingIds (): string[] {
	return Array.from(document.querySelectorAll('#siteTable > .thing, .toolbox-comment-group > .thing',),)
		.map((element,) => element.getAttribute('data-fullname',) ?? '')
}

describe('queue sorting', () => {
	it('groups comments and links by thread id', () => {
		document.body.innerHTML = `
            <div id="siteTable" class="sitetable">
                <div class="thing comment" data-fullname="t1_a">
                    <ul class="flat-list buttons"><li class="first"><a href="/r/test/comments/post1/title/comment/">context</a></li></ul>
                </div>
                <div class="thing link" data-fullname="t3_post2"></div>
                <div class="thing comment" data-fullname="t1_b">
                    <ul class="flat-list buttons"><li class="first"><a href="/r/test/comments/post1/title/comment2/">context</a></li></ul>
                </div>
            </div>
        `

		groupThings()

		// Only post1 gets a wrapper — it has associated comments. post2 is a lone link with no
		// comments in the queue, so it stays as a direct sitetable child rather than a single-item group.
		const groups = Array.from(document.querySelectorAll<HTMLElement>('.toolbox-comment-group',),)
		expect(groups.map((group,) => group.dataset.id),).toEqual(['post1',],)
		expect(
			Array.from(groups[0]!.querySelectorAll('.thing',),).map((element,) =>
				element.getAttribute('data-fullname',)
			),
		)
			.toEqual(['t1_a', 't1_b',],)
		expect(document.querySelector('#siteTable > .thing[data-fullname="t3_post2"]',),).not.toBeNull()
	})

	it('removes existing groups before regrouping', () => {
		document.body.innerHTML = `
            <div id="siteTable" class="sitetable">
                <div class="toolbox-comment-group" data-id="old"></div>
                <div class="thing link" data-fullname="t3_post"></div>
            </div>
        `

		groupThings()

		// The old group is cleared, and the lone link has no comments so it stays unwrapped.
		expect(document.querySelectorAll('.toolbox-comment-group',),).toHaveLength(0,)
		expect(document.querySelector('#siteTable > .thing[data-fullname="t3_post"]',),).not.toBeNull()
	})

	it('groups items by subreddit after comment groups were created', () => {
		document.body.innerHTML = `
            <div id="siteTable" class="sitetable">
                <div class="toolbox-comment-group" data-id="post1">
                    <div class="thing comment" data-fullname="t1_a"><a class="subreddit">r/alpha</a></div>
                    <div class="thing comment" data-fullname="t1_b"><a class="subreddit">r/beta</a></div>
                    <hr />
                </div>
                <div class="toolbox-comment-group" data-id="post2">
                    <div class="thing comment" data-fullname="t1_c"><a class="subreddit">r/alpha</a></div>
                    <hr />
                </div>
            </div>
        `
		const sitetable = document.querySelector('#siteTable',)!

		groupBySubreddit(sitetable,)

		expect(document.querySelectorAll('.toolbox-comment-group',),).toHaveLength(0,)
		const groups = Array.from(document.querySelectorAll<HTMLElement>('.toolbox-sub-group',),)
		expect(groups.map((group,) => group.dataset.sub),).toEqual(['r/alpha', 'r/beta',],)
		expect(
			Array.from(groups[0]!.querySelectorAll('.thing',),).map((element,) =>
				element.getAttribute('data-fullname',)
			),
		)
			.toEqual(['t1_a', 't1_c',],)
		expect(groups[1]!.querySelector('.thing',)?.getAttribute('data-fullname',),).toBe('t1_b',)
	})

	it('sorts things by age ascending and descending', () => {
		document.body.innerHTML = `
            <div id="siteTable" class="sitetable">
                <div class="thing" data-fullname="t3_new"><p class="tagline"><time datetime="2024-01-03T00:00:00Z"></time></p></div>
                <div class="thing" data-fullname="t3_old"><p class="tagline"><time datetime="2024-01-01T00:00:00Z"></time></p></div>
                <div class="thing" data-fullname="t3_mid"><p class="tagline"><time datetime="2024-01-02T00:00:00Z"></time></p></div>
            </div>
        `

		sortThings('age', true, false,)
		expect(thingIds(),).toEqual(['t3_old', 't3_mid', 't3_new',],)

		sortThings('age', false, false,)
		expect(thingIds(),).toEqual(['t3_new', 't3_mid', 't3_old',],)
	})

	it('sorts by edited timestamp falling back to creation timestamp', () => {
		document.body.innerHTML = `
            <div id="siteTable" class="sitetable">
                <div class="thing" data-fullname="t3_a">
                    <p class="tagline"><time class="edited-timestamp" datetime="2024-01-05T00:00:00Z"></time></p>
                </div>
                <div class="thing" data-fullname="t3_b">
                    <p class="tagline"><time datetime="2024-01-02T00:00:00Z"></time></p>
                </div>
            </div>
        `

		sortThings('edited', true, false,)

		expect(thingIds(),).toEqual(['t3_b', 't3_a',],)
	})

	it('sorts by score and report count', () => {
		document.body.innerHTML = `
            <div id="siteTable" class="sitetable">
                <div class="thing" data-fullname="t3_low"><span class="score unvoted" title="2"></span><span class="reported-stamp">5 reports</span></div>
                <div class="thing" data-fullname="t3_high"><span class="score unvoted" title="8"></span><span class="reported-stamp">1 report</span></div>
            </div>
        `

		sortThings('score', true, false,)
		expect(thingIds(),).toEqual(['t3_low', 't3_high',],)

		sortThings('reports', true, false,)
		expect(thingIds(),).toEqual(['t3_high', 't3_low',],)
	})

	function makeThing (fullname: string, subreddit?: string,): HTMLElement {
		const thing = document.createElement('div',)
		thing.className = 'thing'
		thing.setAttribute('data-fullname', fullname,)
		if (subreddit) {
			const sub = document.createElement('a',)
			sub.className = 'subreddit'
			sub.textContent = subreddit
			thing.appendChild(sub,)
		}
		return thing
	}

	it('pins new items in a "New Items" section at the bottom of the queue', () => {
		document.body.innerHTML = `
            <div id="siteTable" class="sitetable">
                <div class="thing" data-fullname="t3_existing"></div>
            </div>
        `
		const sitetable = document.querySelector('#siteTable',)!

		appendNewItems(sitetable, [makeThing('t3_n1',),],)

		const section = sitetable.querySelector(':scope > .toolbox-new-items-group',)
		expect(section,).not.toBeNull()
		expect(sitetable.lastElementChild,).toBe(section,)
		expect(section?.querySelector('.toolbox-new-items-header',)?.textContent,).toBe('New Items',)
		expect(section?.querySelector('.thing',)?.getAttribute('data-fullname',),).toBe('t3_n1',)

		// A later tick reuses the same section and keeps it at the bottom.
		appendNewItems(sitetable, [makeThing('t3_n2',),],)
		expect(sitetable.querySelectorAll('.toolbox-new-items-group',),).toHaveLength(1,)
		expect(
			Array.from(section!.querySelectorAll('.thing',),).map((el,) => el.getAttribute('data-fullname',)),
		).toEqual(['t3_n1', 't3_n2',],)
		expect(sitetable.lastElementChild,).toBe(section,)
	})

	it('keeps the "New Items" section pinned at the bottom and ungrouped when grouping by subreddit', () => {
		document.body.innerHTML = `
            <div id="siteTable" class="sitetable">
                <div class="thing" data-fullname="t3_a"><a class="subreddit">r/alpha</a></div>
                <div class="thing" data-fullname="t3_b"><a class="subreddit">r/beta</a></div>
            </div>
        `
		const sitetable = document.querySelector('#siteTable',)!
		appendNewItems(sitetable, [makeThing('t3_new', 'r/alpha',),],)

		groupBySubreddit(sitetable,)

		const section = sitetable.querySelector(':scope > .toolbox-new-items-group',)
		expect(section,).not.toBeNull()
		expect(sitetable.lastElementChild,).toBe(section,)
		// The new item stays in the section and is NOT folded into the r/alpha group.
		expect(section?.querySelector('.thing',)?.getAttribute('data-fullname',),).toBe('t3_new',)
		const alphaGroup = sitetable.querySelector('.toolbox-sub-group[data-sub="r/alpha"]',)
		expect(
			Array.from(alphaGroup!.querySelectorAll('.thing',),).map((el,) => el.getAttribute('data-fullname',)),
		).toEqual(['t3_a',],)
	})

	it('re-pins the "New Items" section last after ungrouping', () => {
		document.body.innerHTML = `
            <div id="siteTable" class="sitetable">
                <div class="thing" data-fullname="t3_a"><a class="subreddit">r/alpha</a></div>
            </div>
        `
		const sitetable = document.querySelector('#siteTable',)!
		appendNewItems(sitetable, [makeThing('t3_new', 'r/alpha',),],)
		groupBySubreddit(sitetable,)

		ungroupBySubreddit(sitetable,)

		const section = sitetable.querySelector(':scope > .toolbox-new-items-group',)
		expect(section,).not.toBeNull()
		expect(sitetable.lastElementChild,).toBe(section,)
	})

	it('dissolves the "New Items" section and merges its items into a resort', () => {
		document.body.innerHTML = `
            <div id="siteTable" class="sitetable">
                <div class="thing" data-fullname="t3_mid"><p class="tagline"><time datetime="2024-01-02T00:00:00Z"></time></p></div>
                <div class="toolbox-new-items-group">
                    <div class="toolbox-new-items-header">New Items</div>
                    <div class="thing" data-fullname="t3_new"><p class="tagline"><time datetime="2024-01-03T00:00:00Z"></time></p></div>
                    <div class="thing" data-fullname="t3_old"><p class="tagline"><time datetime="2024-01-01T00:00:00Z"></time></p></div>
                </div>
            </div>
        `

		sortThings('age', true, false,)

		expect(document.querySelectorAll('.toolbox-new-items-group',),).toHaveLength(0,)
		expect(thingIds(),).toEqual(['t3_old', 't3_mid', 't3_new',],)
	})
})
