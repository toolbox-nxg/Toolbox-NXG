/** Tests for getCommentVisits. */

import {afterEach, describe, expect, it,} from 'vitest'
import {
	getActionReasonElements,
	getCommentVisits,
	getCommentVisitsBox,
	getCommentVisitsTitle,
	getModeratorActionElements,
	getOldCommentThings,
	getSpammedCommentEntries,
	getUncheckedCommentThings,
} from './comments'

afterEach(() => {
	document.body.innerHTML = ''
},)

describe('getCommentVisits', () => {
	it('returns the #comment-visits select element', () => {
		document.body.innerHTML = `<select id="comment-visits"></select>`
		expect(getCommentVisits(),).not.toBeNull()
		expect(getCommentVisits()?.tagName.toLowerCase(),).toBe('select',)
	})

	it('returns null when absent', () => {
		expect(getCommentVisits(),).toBeNull()
	})
})

describe('getCommentVisitsBox', () => {
	it('returns .comment-visits-box element', () => {
		document.body.innerHTML = `<div class="comment-visits-box"></div>`
		expect(getCommentVisitsBox(),).not.toBeNull()
	})

	it('returns null when absent', () => {
		expect(getCommentVisitsBox(),).toBeNull()
	})
})

describe('getCommentVisitsTitle', () => {
	it('returns .comment-visits-box .title element', () => {
		document.body.innerHTML = `<div class="comment-visits-box"><div class="title">title</div></div>`
		expect(getCommentVisitsTitle()?.textContent,).toBe('title',)
	})

	it('returns null when absent', () => {
		expect(getCommentVisitsTitle(),).toBeNull()
	})
})

describe('getOldCommentThings', () => {
	it('returns things that are neither new-comment nor link', () => {
		document.body.innerHTML = `
            <div class="thing comment"></div>
            <div class="thing comment new-comment"></div>
            <div class="thing link"></div>
        `
		expect(getOldCommentThings(),).toHaveLength(1,)
	})
})

describe('getModeratorActionElements', () => {
	it('returns .moderator and [data-subreddit="spam"] elements', () => {
		document.body.innerHTML = `
            <div class="moderator"></div>
            <div data-subreddit="spam"></div>
            <div class="regular"></div>
        `
		expect(getModeratorActionElements(),).toHaveLength(2,)
	})

	it('returns empty array when none', () => {
		expect(getModeratorActionElements(),).toHaveLength(0,)
	})
})

describe('getSpammedCommentEntries', () => {
	it('returns entries of spam comments on the comments page', () => {
		document.body.innerHTML = `
            <div class="comments-page">
                <div class="thing comment spam"><div class="entry"></div></div>
                <div class="thing comment"><div class="entry"></div></div>
            </div>
        `
		expect(getSpammedCommentEntries(),).toHaveLength(1,)
	})

	it('returns empty when not on comments page', () => {
		document.body.innerHTML = `<div class="thing comment spam"><div class="entry"></div></div>`
		expect(getSpammedCommentEntries(),).toHaveLength(0,)
	})
})

describe('getUncheckedCommentThings', () => {
	it('returns comment things missing the marker class', () => {
		document.body.innerHTML = `
            <div class="thing comment"></div>
            <div class="thing comment toolbox-comments-checked"></div>
        `
		expect(getUncheckedCommentThings(),).toHaveLength(1,)
	})

	it('accepts a custom marker', () => {
		document.body.innerHTML = `
            <div class="thing comment"></div>
            <div class="thing comment my-marker"></div>
        `
		expect(getUncheckedCommentThings('my-marker',),).toHaveLength(1,)
	})
})

describe('getActionReasonElements', () => {
	it('returns .action-reason elements', () => {
		document.body.innerHTML = `
            <div class="action-reason"><b>Automod action:</b> filtered</div>
            <div class="action-reason"><b>Automod action:</b> removed</div>
        `
		expect(getActionReasonElements(),).toHaveLength(2,)
	})

	it('returns empty when none', () => {
		expect(getActionReasonElements(),).toHaveLength(0,)
	})
})
