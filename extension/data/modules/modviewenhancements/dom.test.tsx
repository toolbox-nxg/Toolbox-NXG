/** Tests for highlightedMatches - [] word highlighting in bot reports. */

import {afterEach, beforeEach, describe, expect, it, vi,} from 'vitest'

// External API / side-effect mocks
vi.mock('../../api/resources/modSubs', () => ({isModSub: vi.fn().mockResolvedValue(false,),}),)
vi.mock('../../api/resources/subreddits', () => ({getModLog: vi.fn().mockResolvedValue({data: {children: [],},},),}),)
vi.mock('../../util/persistence/settings', () => ({
	getSettingAsync: vi.fn().mockResolvedValue([],),
}),)
vi.mock('../../util/infra/logging', () => ({default: () => ({debug: vi.fn(), warn: vi.fn(), error: vi.fn(),}),}),)
vi.mock('../../util/ui/reactMount', () => ({mountToTarget: vi.fn(),}),)
vi.mock('./botIcon', () => ({iconBot: '',}),)

// Mutable page context so individual tests can simulate the queue vs. off-queue (subreddit) pages.
// `isModpage` mirrors the real export, which is a (truthy) RegExpMatchArray or (falsy) null.
const mockPageContext = vi.hoisted(() => ({
	isCommentsPage: false as unknown,
	isMod: true,
	isModpage: [true,] as unknown,
}))
vi.mock('../../util/reddit/pageContext', () => mockPageContext,)

vi.mock('../../dom/shreddit/queue', () => ({
	getQueueItemReasons: vi.fn(() => []),
	getQueueItemScore: vi.fn(() => 0),
	getQueueItemSubreddit: vi.fn(() => null),
	getQueueItemTextBodyEl: vi.fn(() => null),
	getQueueItems: vi.fn(() => []),
}),)

vi.mock('../../dom/oldReddit/page', () => ({
	getCurrentSubredditName: vi.fn(() => null),
	getSiteTable: vi.fn(() => null),
}),)

// Use real DOM accessors for the core selectors so we can test them with real DOM
import {createModViewEnhancementsHandlers,} from './dom'

const defaultOptions = {
	highlightNegativePosts: false,
	showAutomodActionReason: false,
	subredditColor: false,
	subredditColorSalt: '',
	subredditColorOverrides: {},
	highlightAutomodMatches: true,
	highlightAutomodMatchesSubreddit: false,
	botCheckmark: ['AutoModerator',],
}

/** Builds a single old-Reddit `.thing` with a title, a bot mod-report, and optional self-text body. */
function buildThing (titleText: string, reportText: string, bodyText = '',) {
	document.body.innerHTML = `
        <div class="thing link" id="thing_t3_test">
            <div class="entry">
                <p class="title"><a class="title" href="#">${titleText}</a></p>
                ${bodyText ? `<div class="md"><p>${bodyText}</p></div>` : ''}
            </div>
            <div class="report-reasons">
                <div class="mod-report">${reportText}</div>
            </div>
        </div>
    `
}

beforeEach(() => {
	document.body.innerHTML = ''
	vi.clearAllMocks()
	// Reset page context to "on the old Reddit mod queue" before each test.
	mockPageContext.isCommentsPage = false
	mockPageContext.isMod = true
	mockPageContext.isModpage = [true,]
},)

afterEach(() => {
	document.body.innerHTML = ''
},)

describe('highlightedMatches - [] word highlighting in bot reports', () => {
	it('step 1: getModReports finds .report-reasons .mod-report', () => {
		buildThing('Post Title', 'AutoModerator: [spam word] reason text',)
		const modReport = document.querySelector('.report-reasons .mod-report',)!
		expect(modReport,).not.toBeNull()
		expect(modReport.textContent,).toContain('[spam word]',)
	})

	it('step 2: getThingFromDescendant finds .thing from .mod-report', () => {
		buildThing('Post Title', 'AutoModerator: [spam word] reason text',)
		const modReport = document.querySelector('.report-reasons .mod-report',)!
		const thing = modReport.closest('.thing',)
		expect(thing,).not.toBeNull()
	})

	it('step 3: getThingTitleLinks finds a.title inside .thing', () => {
		buildThing('Post Title', 'AutoModerator: [spam word] reason text',)
		const thing = document.querySelector('.thing',)!
		const titleLinks = thing.querySelectorAll('a.title',)
		expect(titleLinks.length,).toBeGreaterThan(0,)
	})

	it('step 4: highlight actually wraps matched words in spans', async () => {
		buildThing('This post is spam word text', 'AutoModerator: [spam word] reason',)

		createModViewEnhancementsHandlers(defaultOptions,)

		// Let the async highlightedMatches and its await complete
		await Promise.resolve()
		await Promise.resolve()

		const titleLink = document.querySelector('a.title',)!
		const span = titleLink.querySelector('span.toolbox-highlight-action-reason',)
		expect(span,).not.toBeNull()
		expect(span?.textContent?.toLowerCase(),).toContain('spam',)
	})

	it('does not highlight when botCheckmark does not match reporter', async () => {
		buildThing('This post contains spam word', 'AutoModerator: [spam word] reason',)

		createModViewEnhancementsHandlers({...defaultOptions, botCheckmark: ['DifferentBot',],},)

		await Promise.resolve()
		await Promise.resolve()

		const titleLink = document.querySelector('a.title',)!
		expect(titleLink.querySelector('span.toolbox-highlight-action-reason',),).toBeNull()
	})

	it('does not highlight when report has no [] patterns', async () => {
		buildThing('Some post title', 'AutoModerator: plain text reason no brackets',)

		createModViewEnhancementsHandlers(defaultOptions,)

		await Promise.resolve()
		await Promise.resolve()

		const titleLink = document.querySelector('a.title',)!
		expect(titleLink.querySelector('span.toolbox-highlight-action-reason',),).toBeNull()
	})

	it('highlights in .md body when word appears in self-text', async () => {
		buildThing('Link post', 'AutoModerator: [badword] reason', 'This post contains badword in it',)

		createModViewEnhancementsHandlers(defaultOptions,)

		await Promise.resolve()
		await Promise.resolve()

		const md = document.querySelector('.md',)!
		const span = md.querySelector('span.toolbox-highlight-action-reason',)
		expect(span,).not.toBeNull()
		expect(span?.textContent?.toLowerCase(),).toContain('badword',)
	})
})

describe('off-queue highlighting (subreddit/comment pages)', () => {
	beforeEach(() => {
		// Simulate a regular subreddit page viewed as a mod (not the queue).
		mockPageContext.isModpage = null
		mockPageContext.isMod = true
	},)

	it('highlights bot report matches when highlightAutomodMatchesSubreddit is on', async () => {
		buildThing('This post is spam word text', 'AutoModerator: [spam word] reason',)

		createModViewEnhancementsHandlers({
			...defaultOptions,
			highlightAutomodMatches: false,
			highlightAutomodMatchesSubreddit: true,
		},)

		await Promise.resolve()
		await Promise.resolve()

		const titleLink = document.querySelector('a.title',)!
		const span = titleLink.querySelector('span.toolbox-highlight-action-reason',)
		expect(span,).not.toBeNull()
		expect(span?.textContent?.toLowerCase(),).toContain('spam',)
	})

	it('does not highlight off-queue when the subreddit setting is off', async () => {
		buildThing('This post is spam word text', 'AutoModerator: [spam word] reason',)

		createModViewEnhancementsHandlers({
			...defaultOptions,
			highlightAutomodMatches: true,
			highlightAutomodMatchesSubreddit: false,
		},)

		await Promise.resolve()
		await Promise.resolve()

		const titleLink = document.querySelector('a.title',)!
		expect(titleLink.querySelector('span.toolbox-highlight-action-reason',),).toBeNull()
	})

	it('does not highlight off-queue for non-mods even when the setting is on', async () => {
		mockPageContext.isMod = false
		buildThing('This post is spam word text', 'AutoModerator: [spam word] reason',)

		createModViewEnhancementsHandlers({
			...defaultOptions,
			highlightAutomodMatches: false,
			highlightAutomodMatchesSubreddit: true,
		},)

		await Promise.resolve()
		await Promise.resolve()

		const titleLink = document.querySelector('a.title',)!
		expect(titleLink.querySelector('span.toolbox-highlight-action-reason',),).toBeNull()
	})
})
