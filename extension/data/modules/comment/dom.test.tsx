/** Tests for comment flat view handlers. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

vi.mock('webextension-polyfill', () => ({
	default: {runtime: {getURL: (path: string,) => `chrome-extension://fake/${path}`,},},
}),)

const addContextItem = vi.hoisted(() => vi.fn())
const removeContextItem = vi.hoisted(() => vi.fn())
const showFlatViewOverlay = vi.hoisted(() => vi.fn())
const showContextPopup = vi.hoisted(() => vi.fn())
const getCommentContext = vi.hoisted(() => vi.fn())
const negativeTextFeedback = vi.hoisted(() => vi.fn())
const isModSub = vi.hoisted(() => vi.fn())
const highlight = vi.hoisted(() => vi.fn())
const getThingInfo = vi.hoisted(() => vi.fn())
const renderAtLocation = vi.hoisted(() => vi.fn())

vi.mock('../../api/resources/comments', () => ({getCommentContext,}),)
vi.mock('../../api/resources/modSubs', () => ({isModSub,}),)
vi.mock('../../util/reddit/thingInfo', () => ({getThingInfo,}),)
vi.mock('../../dom/uiLocations', () => ({renderAtLocation,}),)
vi.mock('../../store/contextMenu', () => ({addContextItem, removeContextItem,}),)
vi.mock('../../store/feedback', () => ({negativeTextFeedback,}),)
vi.mock('../../util/infra/logging', () => ({default: () => ({debug: vi.fn(),}),}),)
vi.mock('../../util/infra/platform', () => ({isOldReddit: true,}),)
vi.mock('../../util/ui/highlight', () => ({highlight,}),)
vi.mock('./components/ContextPopup', () => ({showContextPopup,}),)
vi.mock('./components/FlatViewOverlay', () => ({showFlatViewOverlay,}),)

import {applyHighlight, createFlatViewHandlers, createHighlightHandlers, openCommentContextPopup,} from './dom'

const mockLifecycle = {mount: vi.fn(),} as any

beforeEach(() => {
	document.body.innerHTML = ''
	vi.clearAllMocks()
},)

describe('comment flat view handlers', () => {
	it('adds a context menu item on subreddit comment listing pages', () => {
		createFlatViewHandlers(false,).handleNewPage(
			new CustomEvent('TBNewPage', {
				detail: {pageType: 'subredditCommentsPage',},
			},),
		)

		expect(addContextItem,).toHaveBeenCalledWith(
			'toolbox-flatview-link',
			expect.objectContaining({
				text: 'comment flat view',
			},),
		)
	})

	it('removes the context menu item on other page types', () => {
		createFlatViewHandlers(false,).handleNewPage(
			new CustomEvent('TBNewPage', {
				detail: {pageType: 'frontpage',},
			},),
		)

		expect(removeContextItem,).toHaveBeenCalledWith('toolbox-flatview-link',)
	})

	it('opens the flat view overlay with the configured popup behavior', () => {
		createFlatViewHandlers(true,).handleFlatViewClick(document.body, new Event('click',),)
		expect(showFlatViewOverlay,).toHaveBeenCalledWith(expect.any(Function,),)

		vi.clearAllMocks()
		createFlatViewHandlers(false,).handleFlatViewClick(document.body, new Event('click',),)
		expect(showFlatViewOverlay,).toHaveBeenCalledWith(false,)
	})
})

describe('comment highlight handlers', () => {
	it('highlights old Reddit comment markdown when the subreddit is moderated', async () => {
		isModSub.mockResolvedValue(true,)
		document.body.innerHTML = `
            <div class="entry">
                <div class="toolbox-thing-slot"></div>
                <div class="md">target text</div>
            </div>
        `
		const slot = document.querySelector('.toolbox-thing-slot',)!

		await applyHighlight(slot, 'testsub', ['target',],)

		expect(isModSub,).toHaveBeenCalledWith('testsub',)
		expect(highlight,).toHaveBeenCalledWith(document.querySelector('.md',), ['target',],)
	})

	it('does not highlight comments when the subreddit is not moderated', async () => {
		isModSub.mockResolvedValue(false,)
		document.body.innerHTML =
			'<div class="entry"><div class="toolbox-thing-slot"></div><div class="md">target</div></div>'

		await applyHighlight(document.querySelector('.toolbox-thing-slot',)!, 'testsub', ['target',],)

		expect(highlight,).not.toHaveBeenCalled()
	})
})

describe('comment context popup handlers', () => {
	it('normalizes reddit URLs and opens the context popup with API-sanitized data', async () => {
		getCommentContext.mockResolvedValue([
			{},
			{
				data: {
					children: [{
						data: {
							author: 'alice',
							subreddit: 'testsub',
						},
					},],
				},
			},
		],)

		openCommentContextPopup(
			't1_comment',
			'https://old.reddit.com/r/testsub/comments/post/-/comment/',
			new MouseEvent('click',),
		)
		await Promise.resolve()

		expect(getCommentContext,).toHaveBeenCalledWith('https://old.reddit.com/r/testsub/comments/post/-/comment/',)
		expect(showContextPopup,).toHaveBeenCalledWith(expect.objectContaining({
			title: 'Context for /u/alice in /r/testsub',
			highlightCommentId: 't1_comment',
		},),)
	})

	it('shows negative feedback when context content is inaccessible', async () => {
		getCommentContext.mockResolvedValue([{}, {data: {children: [],},},],)

		openCommentContextPopup('t1_comment', '/r/testsub/comments/post/-/comment/', new MouseEvent('click',),)
		await Promise.resolve()

		expect(negativeTextFeedback,).toHaveBeenCalledWith('Content inaccessible; removed or deleted?',)
		expect(showContextPopup,).not.toHaveBeenCalled()
	})
})
