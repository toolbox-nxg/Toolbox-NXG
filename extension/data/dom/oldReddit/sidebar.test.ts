/** Tests for getSubscriptionBox. */

import {afterEach, describe, expect, it,} from 'vitest'
import {
	getSubscriptionBox,
	getSubscriptionBoxItems,
	getSubscriptionBoxLinks,
	getSubscriptionBoxTitleHeaders,
} from './sidebar'

afterEach(() => {
	document.body.innerHTML = ''
},)

describe('getSubscriptionBox', () => {
	it('returns .subscription-box when present', () => {
		document.body.innerHTML = `<ul class="subscription-box"><li>sub</li></ul>`
		expect(getSubscriptionBox(),).not.toBeNull()
	})

	it('returns null when absent', () => {
		expect(getSubscriptionBox(),).toBeNull()
	})
})

describe('getSubscriptionBoxTitleHeaders', () => {
	it('returns sidecontentbox title headers containing a subscription box', () => {
		document.body.innerHTML = `
            <div class="sidecontentbox">
                <div class="title">My Subreddits</div>
                <div class="subscription-box"></div>
            </div>
        `
		expect(getSubscriptionBoxTitleHeaders(),).toHaveLength(1,)
	})

	it('returns empty when no subscription-box sidecontentbox exists', () => {
		document.body.innerHTML = `<div class="sidecontentbox"><div class="title">other</div></div>`
		expect(getSubscriptionBoxTitleHeaders(),).toHaveLength(0,)
	})
})

describe('getSubscriptionBoxLinks', () => {
	it('returns a.title links within the subscription box', () => {
		document.body.innerHTML = `
            <ul class="subscription-box">
                <li><a class="title" href="/r/a">a</a></li>
                <li><a class="title" href="/r/b">b</a></li>
            </ul>
        `
		expect(getSubscriptionBoxLinks(),).toHaveLength(2,)
	})

	it('returns empty when no subscription box exists', () => {
		expect(getSubscriptionBoxLinks(),).toHaveLength(0,)
	})
})

describe('getSubscriptionBoxItems', () => {
	it('returns li elements within the subscription box', () => {
		document.body.innerHTML = `
            <ul class="subscription-box">
                <li>a</li><li>b</li><li>c</li>
            </ul>
        `
		expect(getSubscriptionBoxItems(),).toHaveLength(3,)
	})
})
