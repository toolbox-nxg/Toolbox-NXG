/** Tests for getThings. */

import {afterEach, describe, expect, it,} from 'vitest'
import {
	ensureThingAuthorContainer,
	ensureThingSlot,
	getCommentRemoveButton,
	getEntry,
	getLinkThings,
	getListingPageLinkThings,
	getNativeRemoveButton,
	getReportedStamp,
	getThingApproveButton,
	getThingAuthorContainer,
	getThingAuthorEl,
	getThingBigModButtons,
	getThingByFullname,
	getThingBylinkAnchor,
	getThingDomain,
	getThingDomainEl,
	getThingFlatListButtons,
	getThingFromDescendant,
	getThingFullname,
	getThingParentLinkThing,
	getThingRemovedBy,
	getThingRemovedInput,
	getThings,
	getThingSlot,
	getThingSubreddit,
	getThingSubredditName,
	getThingTitleAnchor,
	getUncheckedComments,
	getUncheckedLinkThings,
	markThingSeen,
} from './things'

afterEach(() => {
	document.body.innerHTML = ''
},)

const linkThing = `
    <div class="thing link unvoted"
         data-fullname="t3_abc"
         data-subreddit="testsub"
         data-type="link">
        <div class="entry">
            <ul class="flat-list buttons">
                <li title="removed by AutoModerator">[ removed by AutoModerator (remove not spam) ]</li>
            </ul>
            <span class="domain"><a href="/domain/example.com/">example.com</a></span>
            <a class="subreddit" href="/r/testsub">r/testsub</a>
            <div class="unvoted">
                <span class="score unvoted">42 points</span>
            </div>
        </div>
        <div class="menuarea modtools"></div>
        <div class="reported-stamp">3 reports</div>
    </div>
`

const commentThing = `
    <div class="thing comment"
         data-fullname="t1_xyz"
         data-subreddit="testsub"
         data-type="comment">
        <div class="entry"></div>
    </div>
`

describe('getThings', () => {
	it('returns all div.thing elements in the document', () => {
		document.body.innerHTML = linkThing + commentThing
		expect(getThings(),).toHaveLength(2,)
	})

	it('returns empty array when no things exist', () => {
		expect(getThings(),).toHaveLength(0,)
	})

	it('scopes to a container when provided', () => {
		document.body.innerHTML = `<div id="a">${linkThing}</div><div id="b">${commentThing}</div>`
		const container = document.getElementById('a',)!
		expect(getThings(container,),).toHaveLength(1,)
	})
})

describe('getLinkThings', () => {
	it('returns only div.thing.link elements', () => {
		document.body.innerHTML = linkThing + commentThing
		const links = getLinkThings()
		expect(links,).toHaveLength(1,)
		expect(links[0].classList.contains('link',),).toBe(true,)
	})
})

describe('getThingByFullname', () => {
	it('finds a thing by its data-fullname', () => {
		document.body.innerHTML = linkThing
		const thing = getThingByFullname('t3_abc',)
		expect(thing,).not.toBeNull()
		expect(thing!.getAttribute('data-fullname',),).toBe('t3_abc',)
	})

	it('returns null when no match', () => {
		document.body.innerHTML = linkThing
		expect(getThingByFullname('t3_nope',),).toBeNull()
	})
})

describe('getThingFullname', () => {
	it('returns data-fullname', () => {
		document.body.innerHTML = linkThing
		expect(getThingFullname(getThings()[0],),).toBe('t3_abc',)
	})

	it('returns null when attribute is missing', () => {
		expect(getThingFullname(document.createElement('div',),),).toBeNull()
	})
})

describe('getThingSubreddit', () => {
	it('returns data-subreddit', () => {
		document.body.innerHTML = linkThing
		expect(getThingSubreddit(getThings()[0],),).toBe('testsub',)
	})

	it('returns null when attribute is missing', () => {
		expect(getThingSubreddit(document.createElement('div',),),).toBeNull()
	})
})

describe('getThingSubredditName', () => {
	it('returns subreddit name without r/ prefix', () => {
		document.body.innerHTML = linkThing
		expect(getThingSubredditName(getThings()[0],),).toBe('testsub',)
	})

	it('returns null when a.subreddit is absent', () => {
		document.body.innerHTML = commentThing
		expect(getThingSubredditName(getThings()[0],),).toBeNull()
	})

	it('strips r/ prefix from the link text', () => {
		document.body.innerHTML = `<div class="thing link"><a class="subreddit">r/askreddit</a></div>`
		expect(getThingSubredditName(getThings()[0],),).toBe('askreddit',)
	})
})

describe('getThingDomain', () => {
	it('parses the domain from span.domain a href', () => {
		document.body.innerHTML = linkThing
		expect(getThingDomain(getThings()[0],),).toBe('example.com',)
	})

	it('returns null when domain element is absent', () => {
		document.body.innerHTML = commentThing
		expect(getThingDomain(getThings()[0],),).toBeNull()
	})

	it('parses /r/ subreddit links', () => {
		document.body.innerHTML = `
            <div class="thing link">
                <div class="entry">
                    <span class="domain"><a href="/r/programming/">r/programming</a></span>
                </div>
            </div>
        `
		expect(getThingDomain(getThings()[0],),).toBe('/r/programming',)
	})
})

describe('getThingDomainEl', () => {
	it('returns the span.domain element', () => {
		document.body.innerHTML = linkThing
		const element = getThingDomainEl(getThings()[0],)
		expect(element,).not.toBeNull()
		expect(element!.tagName.toLowerCase(),).toBe('span',)
		expect(element!.classList.contains('domain',),).toBe(true,)
	})

	it('returns null when the entry or domain span is absent', () => {
		document.body.innerHTML = commentThing
		expect(getThingDomainEl(getThings()[0],),).toBeNull()
	})
})

describe('getEntry', () => {
	it('returns the .entry element', () => {
		document.body.innerHTML = linkThing
		expect(getEntry(getThings()[0],),).not.toBeNull()
	})

	it('returns null when absent', () => {
		expect(getEntry(document.createElement('div',),),).toBeNull()
	})
})

describe('getReportedStamp', () => {
	it('returns .reported-stamp', () => {
		document.body.innerHTML = linkThing
		const stamp = getReportedStamp(getThings()[0],)
		expect(stamp,).not.toBeNull()
		expect(stamp!.textContent,).toContain('reports',)
	})

	it('returns null when absent', () => {
		document.body.innerHTML = commentThing
		expect(getReportedStamp(getThings()[0],),).toBeNull()
	})
})

describe('getThingRemovedBy', () => {
	it('returns the removal text from .flat-list li[title]', () => {
		document.body.innerHTML = linkThing
		expect(getThingRemovedBy(getThings()[0],),).toBe('[ removed by AutoModerator (remove not spam) ]',)
	})

	it('returns null when no li[title] is present', () => {
		document.body.innerHTML = commentThing
		expect(getThingRemovedBy(getThings()[0],),).toBeNull()
	})
})

describe('getThingFromDescendant', () => {
	it('returns the nearest .thing ancestor', () => {
		document.body.innerHTML = linkThing
		const entry = document.querySelector('.entry',)!
		const thing = getThingFromDescendant(entry,)
		expect(thing,).not.toBeNull()
		expect(thing!.classList.contains('thing',),).toBe(true,)
	})

	it('returns null when there is no .thing ancestor', () => {
		const element = document.createElement('span',)
		document.body.appendChild(element,)
		expect(getThingFromDescendant(element,),).toBeNull()
	})
})

describe('getThingBigModButtons', () => {
	it('returns .big-mod-buttons within entry', () => {
		document.body.innerHTML = `
            <div class="thing"><div class="entry"><div class="big-mod-buttons"></div></div></div>
        `
		expect(getThingBigModButtons(document.querySelector('.thing',)!,),).not.toBeNull()
	})

	it('returns null when absent', () => {
		document.body.innerHTML = `<div class="thing"><div class="entry"></div></div>`
		expect(getThingBigModButtons(document.querySelector('.thing',)!,),).toBeNull()
	})
})

describe('getThingApproveButton', () => {
	it('returns the .positive button in entry buttons', () => {
		document.body.innerHTML = `
            <div class="thing"><div class="entry"><ul class="buttons"><li class="positive"></li></ul></div></div>
        `
		expect(getThingApproveButton(document.querySelector('.thing',)!,),).not.toBeNull()
	})
})

describe('getThingRemovedInput', () => {
	it('returns input[value="removed"] in entry', () => {
		document.body.innerHTML = `
            <div class="thing"><div class="entry"><input value="removed"></div></div>
        `
		expect(getThingRemovedInput(document.querySelector('.thing',)!,),).not.toBeNull()
	})
})

describe('getThingBylinkAnchor', () => {
	it('returns a.bylink within a thing', () => {
		document.body.innerHTML = `<div class="thing"><a class="bylink" href="/r/a/comments/b">link</a></div>`
		const thing = document.querySelector('.thing',)!
		expect(getThingBylinkAnchor(thing,),).not.toBeNull()
		expect(getThingBylinkAnchor(thing,)?.href,).toContain('/comments/b',)
	})

	it('returns null when absent', () => {
		document.body.innerHTML = `<div class="thing"></div>`
		expect(getThingBylinkAnchor(document.querySelector('.thing',)!,),).toBeNull()
	})
})

describe('getThingParentLinkThing', () => {
	it('returns the nearest div.link[data-fullname] ancestor', () => {
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_abc">
                <div class="thing comment" data-fullname="t1_xyz"></div>
            </div>
        `
		const comment = document.querySelector('.comment',)!
		const parent = getThingParentLinkThing(comment,)
		expect(parent,).not.toBeNull()
		expect(parent!.getAttribute('data-fullname',),).toBe('t3_abc',)
	})

	it('returns null for top-level things', () => {
		document.body.innerHTML = `<div class="thing link" data-fullname="t3_abc"></div>`
		expect(getThingParentLinkThing(document.querySelector('.thing',)!,),).toBeNull()
	})
})

describe('getThingSlot', () => {
	it('returns .toolbox-thing-slot within entry', () => {
		document.body.innerHTML = `
            <div class="thing"><div class="entry"><div class="toolbox-thing-slot"></div></div></div>
        `
		expect(getThingSlot(document.querySelector('.thing',)!,),).not.toBeNull()
	})

	it('returns null when absent', () => {
		document.body.innerHTML = `<div class="thing"><div class="entry"></div></div>`
		expect(getThingSlot(document.querySelector('.thing',)!,),).toBeNull()
	})
})

describe('ensureThingSlot', () => {
	it('creates the container when absent', () => {
		document.body.innerHTML = `<div class="thing"><div class="entry"></div></div>`
		const thing = document.querySelector('.thing',)!
		const container = ensureThingSlot(thing,)
		expect(container,).not.toBeNull()
		expect(container!.className,).toBe('toolbox-thing-slot',)
		expect(container!.querySelector('span[data-name="toolbox"]',),).not.toBeNull()
	})

	it('is idempotent — returns same node on second call', () => {
		document.body.innerHTML = `<div class="thing"><div class="entry"></div></div>`
		const thing = document.querySelector('.thing',)!
		expect(ensureThingSlot(thing,),).toBe(ensureThingSlot(thing,),)
	})

	it('returns null when no entry exists', () => {
		document.body.innerHTML = `<div class="thing"></div>`
		expect(ensureThingSlot(document.querySelector('.thing',)!,),).toBeNull()
	})
})

describe('getThingFlatListButtons', () => {
	it('returns .flat-list within a thing', () => {
		document.body.innerHTML = `<div class="thing"><ul class="flat-list"></ul></div>`
		expect(getThingFlatListButtons(document.querySelector('.thing',)!,),).not.toBeNull()
	})
})

describe('getThingTitleAnchor', () => {
	it('returns a.title within a thing', () => {
		document.body.innerHTML = `<div class="thing"><a class="title" href="/r/a/b">Title</a></div>`
		expect(getThingTitleAnchor(document.querySelector('.thing',)!,)?.textContent,).toBe('Title',)
	})

	it('returns null when absent', () => {
		document.body.innerHTML = `<div class="thing"></div>`
		expect(getThingTitleAnchor(document.querySelector('.thing',)!,),).toBeNull()
	})
})

describe('getListingPageLinkThings', () => {
	it('returns .listing-page .content .thing.link elements', () => {
		document.body.innerHTML = `
            <div class="listing-page">
                <div class="content">
                    <div class="thing link"></div>
                    <div class="thing comment"></div>
                </div>
            </div>
        `
		expect(getListingPageLinkThings(),).toHaveLength(1,)
	})

	it('returns empty when not on listing page', () => {
		document.body.innerHTML = `<div class="thing link"></div>`
		expect(getListingPageLinkThings(),).toHaveLength(0,)
	})
})

describe('getUncheckedLinkThings', () => {
	it('returns link things without the given marker', () => {
		document.body.innerHTML = `
            <div class="thing link"></div>
            <div class="thing link toolbox-done"></div>
        `
		expect(getUncheckedLinkThings('toolbox-done',),).toHaveLength(1,)
	})
})

describe('getUncheckedComments', () => {
	it('returns div.comment elements without the given marker', () => {
		document.body.innerHTML = `
            <div class="comment"></div>
            <div class="comment toolbox-lock-button"></div>
        `
		expect(getUncheckedComments('toolbox-lock-button',),).toHaveLength(1,)
	})
})

describe('getCommentRemoveButton', () => {
	it('returns the remove button anchor within a comment', () => {
		document.body.innerHTML = `
            <div class="comment">
                <div class="entry">
                    <ul class="buttons">
                        <li><a data-event-action="remove">remove</a></li>
                    </ul>
                </div>
            </div>
        `
		expect(getCommentRemoveButton(document.querySelector('.comment',)!,),).not.toBeNull()
	})

	it('returns null when absent', () => {
		document.body.innerHTML = `<div class="comment"><div class="entry"></div></div>`
		expect(getCommentRemoveButton(document.querySelector('.comment',)!,),).toBeNull()
	})
})

describe('getThingAuthorEl', () => {
	it('returns the .author element', () => {
		document.body.innerHTML = `
            <div class="thing">
                <div class="entry">
                    <p class="tagline"><a class="author">user123</a></p>
                </div>
            </div>
        `
		expect(getThingAuthorEl(document.querySelector('.thing',)!,)?.textContent,).toBe('user123',)
	})

	it('returns a [deleted] span when no .author present', () => {
		document.body.innerHTML = `
            <div class="thing">
                <div class="entry">
                    <p class="tagline"><span>[deleted]</span></p>
                </div>
            </div>
        `
		expect(getThingAuthorEl(document.querySelector('.thing',)!,)?.textContent,).toBe('[deleted]',)
	})

	it('returns null when no author or entry', () => {
		document.body.innerHTML = `<div class="thing"></div>`
		expect(getThingAuthorEl(document.querySelector('.thing',)!,),).toBeNull()
	})
})

describe('getThingAuthorContainer / ensureThingAuthorContainer', () => {
	it('getThingAuthorContainer returns null before creation', () => {
		document.body.innerHTML = `
            <div class="thing">
                <div class="entry"><p class="tagline"><a class="author">u</a></p></div>
            </div>
        `
		expect(getThingAuthorContainer(document.querySelector('.thing',)!,),).toBeNull()
	})

	it('ensureThingAuthorContainer creates and inserts the container', () => {
		document.body.innerHTML = `
            <div class="thing">
                <div class="entry"><p class="tagline"><a class="author">u</a></p></div>
            </div>
        `
		const thing = document.querySelector('.thing',)!
		const container = ensureThingAuthorContainer(thing,)
		expect(container,).not.toBeNull()
		expect(container?.className,).toBe('toolbox-author-slot',)
		expect(ensureThingAuthorContainer(thing,),).toBe(container,)
	})

	it('returns null when there is no author element', () => {
		document.body.innerHTML = `<div class="thing"><div class="entry"></div></div>`
		expect(ensureThingAuthorContainer(document.querySelector('.thing',)!,),).toBeNull()
	})
})

describe('markThingSeen', () => {
	it('adds the default marker class', () => {
		document.body.innerHTML = `<div class="thing"></div>`
		const thing = document.querySelector('.thing',)!
		expect(thing.classList.contains('toolbox-seen',),).toBe(false,)
		markThingSeen(thing,)
		expect(thing.classList.contains('toolbox-seen',),).toBe(true,)
	})

	it('uses a custom marker class', () => {
		document.body.innerHTML = `<div class="thing"></div>`
		const thing = document.querySelector('.thing',)!
		markThingSeen(thing, 'toolbox-custom',)
		expect(thing.classList.contains('toolbox-custom',),).toBe(true,)
		expect(thing.classList.contains('toolbox-seen',),).toBe(false,)
	})
})

// ---------------------------------------------------------------------------
// getNativeRemoveButton
// ---------------------------------------------------------------------------

describe('getNativeRemoveButton', () => {
	it('picks the remove button by data-event-action over the spam button', () => {
		const thing = document.createElement('div',)
		thing.className = 'thing'
		thing.innerHTML = `
			<div class="entry">
				<span class="remove-button"><a data-event-action="spam">spam</a></span>
				<span class="remove-button"><a data-event-action="remove">remove</a></span>
			</div>
		`
		document.body.appendChild(thing,)
		const result = getNativeRemoveButton(thing,)
		expect(result?.querySelector('a',)?.textContent,).toBe('remove',)
	})

	it('identifies the remove button via the hidden spam input', () => {
		const thing = document.createElement('div',)
		thing.className = 'thing'
		thing.innerHTML = `
			<div class="entry">
				<span class="remove-button"><input name="spam" value="false"><a>remove</a></span>
			</div>
		`
		document.body.appendChild(thing,)
		expect(getNativeRemoveButton(thing,),).not.toBeNull()
	})

	it('falls back to the first remove-button when none is identifiable', () => {
		const thing = document.createElement('div',)
		thing.className = 'thing'
		thing.innerHTML = `
			<div class="entry">
				<span class="remove-button"><a>mystery</a></span>
			</div>
		`
		document.body.appendChild(thing,)
		expect(getNativeRemoveButton(thing,)?.querySelector('a',)?.textContent,).toBe('mystery',)
	})

	it('falls back to the bare data-event-action link on listing pages', () => {
		const thing = document.createElement('div',)
		thing.className = 'thing'
		thing.innerHTML = `
			<div class="entry">
				<ul><li><a data-event-action="remove">remove</a></li></ul>
			</div>
		`
		document.body.appendChild(thing,)
		expect(getNativeRemoveButton(thing,)?.textContent,).toBe('remove',)
	})

	it('returns null when no remove control exists', () => {
		const thing = document.createElement('div',)
		thing.className = 'thing'
		thing.innerHTML = '<div class="entry"></div>'
		document.body.appendChild(thing,)
		expect(getNativeRemoveButton(thing,),).toBeNull()
	})
})
