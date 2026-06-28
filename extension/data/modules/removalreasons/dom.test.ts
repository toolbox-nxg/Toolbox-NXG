/** Tests for createRemovalReasonsHandlers. */

import {beforeEach, describe, expect, it, vi,} from 'vitest'

const platform = vi.hoisted(() => ({isOldReddit: true,}))
const showRemovalReasonsOverlay = vi.hoisted(() => vi.fn(() => vi.fn()))
const getApiThingInfo = vi.hoisted(() => vi.fn())
const getConfig = vi.hoisted(() => vi.fn())
const getThingFromDescendant = vi.hoisted(() => vi.fn((element: Element,) => element.closest('.thing',)))
const removeThing = vi.hoisted(() => vi.fn())
// Renderer registry for the uiLocations mock — keyed by location name.
const uiLocMock = vi.hoisted(() => ({renderers: new Map<string, (...args: unknown[]) => unknown>(),}))

vi.mock('webextension-polyfill', () => ({
	default: {runtime: {getURL: (path: string,) => `chrome-extension://fake/${path}`,},},
}),)

vi.mock('../../dom/oldReddit/things', async (importOriginal,) => ({
	...await importOriginal<typeof import('../../dom/oldReddit/things')>(),
	getThingFromDescendant,
}),)

vi.mock('../../dom/shreddit/things', async (importOriginal,) => ({
	...await importOriginal<typeof import('../../dom/shreddit/things')>(),
	getThingFromDescendant,
	subredditFromPermalink: vi.fn((permalink: string,) => permalink.match(/^\/r\/([^/]+)/,)?.[1] ?? ''),
}),)

vi.mock('../../util/infra/platform', () => ({
	RedditPlatform: {Old: 'old', Shreddit: 'shreddit',},
	get isOldReddit () {
		return platform.isOldReddit
	},
}),)

vi.mock('../../util/reddit/thingInfo', () => ({
	getApiThingInfo,
}),)

// Keep pageDetails real, but force a known page subreddit so the data-subreddit
// fallback in the shift-remove paths can be exercised.
vi.mock('../../util/reddit/pageContext', async (importOriginal,) => ({
	...await importOriginal<typeof import('../../util/reddit/pageContext')>(),
	postSite: 'testsub',
}),)

vi.mock('../../api/resources/things', () => ({
	getThingInfo: vi.fn(),
	removeThing,
}),)

vi.mock('../config/moduleapi', () => ({
	getConfig,
}),)

// Personal usernote-requirement settings: return each setting's default so the
// overlay's "leave usernote" gating is computed without touching storage.
vi.mock('../../util/persistence/settings', () => ({
	getModuleSettingAsync: vi.fn(async (_moduleID: string, _setting: string, defaultVal: unknown,) => defaultVal),
}),)

vi.mock('./components/RemovalReasonsOverlay', () => ({
	showRemovalReasonsOverlay,
}),)

// Synchronous stub: immediately renders React elements as plain DOM so tests can
// inspect the result without needing act() or awaiting microtasks.
vi.mock('../../dom/uiLocations', () => ({
	provideLocation: vi.fn((location: string, slot: Element, context: unknown,) => {
		const render = uiLocMock.renderers.get(location,)
		if (render) {
			const element = render({context, target: slot,},) as {type: string; props: Record<string, unknown>} | null
			if (element && typeof element.type === 'string') {
				const el = document.createElement(element.type,)
				for (const [key, val,] of Object.entries(element.props,)) {
					if (key === 'children') { el.textContent = String(val,) }
					else if (key === 'className') { el.className = String(val,) }
					else if (key.startsWith('data-',)) { el.setAttribute(key, String(val,),) }
				}
				slot.appendChild(el,)
			}
		}
		return vi.fn(() => slot.remove())
	},),
	renderAtLocation: vi.fn((location: string, _options: unknown, render: (...args: unknown[]) => unknown,) => {
		uiLocMock.renderers.set(location, render,)
		return vi.fn()
	},),
}),)

import {createRemovalReasonsHandlers, injectRemoveButton,} from './dom'
import {settings as settingDefs,} from './settings'
import type {RemovalReasonsSettings,} from './settings'

const handlerSettings: RemovalReasonsSettings = {
	alwaysShow: true,
	commentReasons: true,
	customRemovalReason: 'Custom reason',
	displayMode: 'Popup',
	silentRemoveDeletedUsers: false,
	reasonType: 'reply_with_a_comment_to_the_item_that_is_removed',
	reasonAsSub: false,
	reasonAutoArchive: false,
	reasonSticky: false,
	reasonCommentAsSubreddit: false,
	actionLock: false,
	actionLockComment: false,
	disableRemoveButton: false,
	preselectSuggestedReasons: true,
}

function setRemovalConfig () {
	getConfig.mockResolvedValue({
		removalReasons: {
			pmsubject: '',
			logreason: '',
			header: '',
			footer: '',
			logsub: '',
			logtitle: '',
			reasons: [{
				text: 'Rule reason',
				title: '',
				removePosts: true,
				removeComments: true,
				flairText: '',
				flairCSS: '',
			},],
		},
	},)
}

function setThingInfo (kind = 'submission',) {
	getApiThingInfo.mockResolvedValue({
		subreddit: 'testsub',
		id: kind === 'comment' ? 't1_comment' : 't3_post',
		user: 'testuser',
		title: 'Test title',
		kind,
		mod: 'testmod',
		permalink: 'https://reddit.test/item',
		postlink: 'https://reddit.test/post',
		domain: 'reddit.test',
		body: 'body text',
		raw_body: 'body text',
	},)
}

function makeThingInfo (id: string, kind = 'submission',) {
	return {
		subreddit: 'testsub',
		id,
		user: 'testuser',
		title: 'Test title',
		kind,
		mod: 'testmod',
		permalink: 'https://reddit.test/item',
		postlink: 'https://reddit.test/post',
		domain: 'reddit.test',
		body: 'body text',
		raw_body: 'body text',
	}
}

function makeClick (target: Element, shiftKey = false,) {
	const event = new MouseEvent('click', {bubbles: true, cancelable: true, shiftKey,},)
	Object.defineProperty(event, 'target', {value: target,},)
	vi.spyOn(event, 'preventDefault',)
	vi.spyOn(event, 'stopPropagation',)
	vi.spyOn(event, 'stopImmediatePropagation',)
	return event
}

beforeEach(() => {
	document.body.innerHTML = ''
	document.body.style.overflow = ''
	platform.isOldReddit = true
	vi.clearAllMocks()
	uiLocMock.renderers.clear()
	showRemovalReasonsOverlay.mockImplementation((props,) => vi.fn(() => props.onClose?.()))
	setRemovalConfig()
	setThingInfo()
	removeThing.mockResolvedValue({},)
	// Register the thingNativeActionReplacement renderer so injectRemoveButton works.
	createRemovalReasonsHandlers(handlerSettings,)
},)

describe('createRemovalReasonsHandlers', () => {
	it('defaults displayMode to Drawer', () => {
		expect(settingDefs.find((setting,) => setting.id === 'displayMode'),).toMatchObject({
			type: 'selector',
			default: 'Drawer',
			values: ['Drawer', 'Popup (legacy)',],
		},)
	})

	it('defaults silentRemoveDeletedUsers to disabled', () => {
		expect(settingDefs.find((setting,) => setting.id === 'silentRemoveDeletedUsers'),).toMatchObject({
			type: 'boolean',
			default: false,
		},)
	})

	it('opens the overlay for old Reddit remove clicks without confirming removal', async () => {
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_post" data-subreddit="testsub">
                <span class="remove-button">
                    <button class="togglebutton">remove</button>
                    <button class="yes">yes</button>
                </span>
            </div>
        `
		const removeButton = document.querySelector('.togglebutton',)!
		const yesButton = document.querySelector<HTMLButtonElement>('.yes',)!
		const yesClick = vi.spyOn(yesButton, 'click',)
		const event = makeClick(removeButton,)

		await createRemovalReasonsHandlers(handlerSettings,).handleClick(event,)

		expect(event.preventDefault,).toHaveBeenCalledOnce()
		expect(event.stopPropagation,).toHaveBeenCalledOnce()
		expect(event.stopImmediatePropagation,).toHaveBeenCalledOnce()
		expect(yesClick,).not.toHaveBeenCalled()
		expect(showRemovalReasonsOverlay,).toHaveBeenCalledWith(expect.objectContaining({displayMode: 'Popup',},),)
		expect(document.body.style.overflow,).toBe('hidden',)
		showRemovalReasonsOverlay.mock.calls[0]![0].onClose()
		expect(document.body.style.overflow,).toBe('',)
	})

	it('hides old Reddit native remove buttons and inserts a Toolbox remove button', () => {
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_post" data-subreddit="testsub">
                <div class="entry">
                    <ul class="buttons">
                        <li class="remove-button">
                            <button class="togglebutton">remove</button>
                            <button class="yes">yes</button>
                        </li>
                    </ul>
                    <span data-name="toolbox"></span>
                </div>
            </div>
        `
		const target = document.querySelector<HTMLElement>('[data-name="toolbox"]',)!

		injectRemoveButton('t3_post', 'testsub', target,)

		expect(document.querySelector<HTMLElement>('.remove-button',)!.hidden,).toBe(true,)
		expect(document.querySelector('.toolbox-removal-reason-remove',)?.textContent,).toBe('remove',)
	})

	it('hides the native remove link and inserts a Toolbox button on subreddit listing pages (no .remove-button wrapper)', () => {
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_post" data-subreddit="testsub">
                <div class="entry">
                    <ul class="flat-list buttons">
                        <li><a href="#" class="togglebutton access-required" data-event-action="spam">spam</a></li>
                        <li><a href="#" class="togglebutton access-required" data-event-action="remove">remove</a></li>
                        <li><a href="#">approve</a></li>
                    </ul>
                    <span data-name="toolbox"></span>
                </div>
            </div>
        `
		const target = document.querySelector<HTMLElement>('[data-name="toolbox"]',)!

		injectRemoveButton('t3_post', 'testsub', target,)

		const nativeRemoveLi = document.querySelector<HTMLElement>('[data-event-action="remove"]',)!.closest('li',)!
		const toolboxSlot = document.querySelector<HTMLElement>('.toolbox-removal-reason-remove-slot',)!

		expect(nativeRemoveLi.hidden,).toBe(true,)
		expect(toolboxSlot.previousElementSibling,).toBe(nativeRemoveLi,)
		expect(document.querySelector('.toolbox-removal-reason-remove',)?.textContent,).toBe('remove',)
		// Flat-list remove sits among plain text links, so it must NOT get pretty-button styling.
		expect(document.querySelector('.toolbox-removal-reason-remove',)?.classList.contains('pretty-button',),)
			.toBe(false,)
	})

	it('hides reported-content pretty remove buttons and inserts a matching Toolbox button', () => {
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_post" data-subreddit="testsub">
                <div class="entry">
                    <div class="big-mod-buttons">
                        <span>
                            <a
                                class="pretty-button access-required neutral"
                                href="#"
                                data-event-action="remove"
                                hidden=""
                            >remove</a>
                        </span>
                    </div>
                    <span data-name="toolbox"></span>
                </div>
            </div>
        `
		const target = document.querySelector<HTMLElement>('[data-name="toolbox"]',)!

		injectRemoveButton('t3_post', 'testsub', target,)

		const nativeRemoveButton = document.querySelector<HTMLElement>('[data-event-action="remove"]',)!
		const toolboxButton = document.querySelector<HTMLElement>('.toolbox-removal-reason-remove',)!

		expect(nativeRemoveButton.hidden,).toBe(true,)
		expect(nativeRemoveButton.style.getPropertyValue('display',),).toBe('none',)
		expect(nativeRemoveButton.style.getPropertyPriority('display',),).toBe('important',)
		expect(document.querySelector('.toolbox-removal-reason-remove-slot',)?.previousElementSibling,).toBe(
			nativeRemoveButton,
		)
		expect(toolboxButton.classList.contains('toolbox-removal-reason-remove',),).toBe(true,)
		expect(toolboxButton.textContent,).toBe('remove',)
		expect(document.querySelector('.toolbox-removal-reason-remove-item',),).toBeNull()
		// Replacing a `.big-mod-buttons` pretty-button: the Toolbox button must carry the native
		// pretty-button classes so it matches its spam/approve siblings visually.
		expect(toolboxButton.classList.contains('pretty-button',),).toBe(true,)
		expect(toolboxButton.classList.contains('neutral',),).toBe(true,)
	})

	it('replaces the old Reddit remove button instead of the spam button when both are present', () => {
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_post" data-subreddit="testsub">
                <div class="entry">
                    <ul class="buttons">
                        <li>
                            <form class="toggle remove-button" hidden="">
                                <input type="hidden" name="executed" value="spammed">
                                <span class="option main active">
                                    <a class="togglebutton" data-event-action="spam">spam</a>
                                </span>
                            </form>
                        </li>
                        <li>
                            <form class="toggle remove-button">
                                <input type="hidden" name="executed" value="removed">
                                <input type="hidden" name="spam" value="False">
                                <span class="option main active">
                                    <a class="togglebutton" data-event-action="remove">remove</a>
                                </span>
                            </form>
                        </li>
                    </ul>
                    <span data-name="toolbox"></span>
                </div>
            </div>
        `
		const target = document.querySelector<HTMLElement>('[data-name="toolbox"]',)!

		injectRemoveButton('t3_post', 'testsub', target,)

		const nativeButtons = document.querySelectorAll<HTMLElement>('.remove-button',)
		const toolboxSlot = document.querySelector<HTMLElement>('.toolbox-removal-reason-remove-slot',)!
		// The <li> containers, not the inner forms, are what get hidden/replaced
		const removeButtonLi = nativeButtons[1]!.closest('li',)!
		const spamButtonLi = nativeButtons[0]!.closest('li',)!

		expect(removeButtonLi.hidden,).toBe(true,)
		expect(spamButtonLi.hidden,).toBe(false,)
		expect(toolboxSlot.previousElementSibling,).toBe(removeButtonLi,)
		expect(spamButtonLi.nextElementSibling,).not.toBe(toolboxSlot,)
		expect(document.querySelectorAll('.toolbox-removal-reason-remove',),).toHaveLength(1,)
	})

	it('opens the overlay from the Toolbox remove button', async () => {
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_post" data-subreddit="testsub">
                <div class="entry">
                    <ul class="buttons">
                        <li class="remove-button">
                            <button class="togglebutton">remove</button>
                            <button class="yes">yes</button>
                        </li>
                    </ul>
                    <span data-name="toolbox"></span>
                </div>
            </div>
        `
		const target = document.querySelector<HTMLElement>('[data-name="toolbox"]',)!
		const handlers = createRemovalReasonsHandlers(handlerSettings,)
		injectRemoveButton('t3_post', 'testsub', target,)
		const yesButton = document.querySelector<HTMLButtonElement>('.yes',)!
		const yesClick = vi.spyOn(yesButton, 'click',)
		const event = makeClick(document.querySelector('.toolbox-removal-reason-remove',)!,)

		await handlers.handleClick(event,)

		expect(event.preventDefault,).toHaveBeenCalledOnce()
		expect(yesClick,).not.toHaveBeenCalled()
		expect(showRemovalReasonsOverlay,).toHaveBeenCalledOnce()
	})

	it('marks the clicked Toolbox remove button as pending until the overlay closes', async () => {
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_post" data-subreddit="testsub">
                <div class="entry">
                    <ul class="buttons">
                        <li class="remove-button">
                            <button class="togglebutton">remove</button>
                            <button class="yes">yes</button>
                        </li>
                    </ul>
                    <span data-name="toolbox"></span>
                </div>
            </div>
        `
		const target = document.querySelector<HTMLElement>('[data-name="toolbox"]',)!
		const handlers = createRemovalReasonsHandlers(handlerSettings,)
		injectRemoveButton('t3_post', 'testsub', target,)
		const removeButton = document.querySelector<HTMLElement>('.toolbox-removal-reason-remove',)!

		await handlers.handleClick(makeClick(removeButton,),)

		expect(removeButton.textContent,).toBe('pending',)
		showRemovalReasonsOverlay.mock.calls[0]![0].onClose()
		expect(removeButton.textContent,).toBe('remove',)
	})

	it('opens drawer mode without locking body overflow from the stored selector value', async () => {
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_post" data-subreddit="testsub">
                <span class="remove-button">
                    <button class="togglebutton">remove</button>
                </span>
            </div>
        `
		const event = makeClick(document.querySelector('.togglebutton',)!,)

		await createRemovalReasonsHandlers({...handlerSettings, displayMode: 'drawer' as 'Drawer',},).handleClick(
			event,
		)

		expect(showRemovalReasonsOverlay,).toHaveBeenCalledWith(expect.objectContaining({displayMode: 'drawer',},),)
		expect(document.body.style.overflow,).toBe('',)
	})

	it('silently removes deleted-user content when the setting is enabled', async () => {
		getApiThingInfo.mockResolvedValue({...makeThingInfo('t3_post',), user: '',},)
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_post" data-subreddit="testsub">
                <span class="remove-button">
                    <button class="togglebutton">remove</button>
                </span>
            </div>
        `
		const event = makeClick(document.querySelector('.togglebutton',)!,)

		await createRemovalReasonsHandlers({
			...handlerSettings,
			silentRemoveDeletedUsers: true,
		},).handleClick(event,)

		expect(removeThing,).toHaveBeenCalledWith('t3_post', false,)
		expect(showRemovalReasonsOverlay,).not.toHaveBeenCalled()
	})

	it('still opens Add removal reason for deleted-user content when silent removal is enabled', async () => {
		platform.isOldReddit = false
		getApiThingInfo.mockResolvedValue({...makeThingInfo('t1_comment', 'comment',), user: '',},)
		document.body.innerHTML = `
            <div class="toolbox-frontend-container" data-toolbox-type="TBcomment">
                <span
                    class="toolbox-general-button toolbox-add-removal-reason"
                    data-id="t1_comment"
                    data-subreddit="testsub"
                >Add removal reason</span>
            </div>
        `
		const event = makeClick(document.querySelector('.toolbox-add-removal-reason',)!,)

		await createRemovalReasonsHandlers({
			...handlerSettings,
			silentRemoveDeletedUsers: true,
		},).handleClick(event,)

		expect(removeThing,).not.toHaveBeenCalled()
		expect(showRemovalReasonsOverlay,).toHaveBeenCalledOnce()
	})

	it('closes the existing drawer before opening a drawer for another item', async () => {
		getApiThingInfo
			.mockResolvedValueOnce(makeThingInfo('t3_first',),)
			.mockResolvedValueOnce(makeThingInfo('t3_second',),)
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_first" data-subreddit="testsub">
                <div class="entry">
                    <ul class="buttons">
                        <li class="remove-button"><button class="togglebutton">remove</button></li>
                    </ul>
                    <span data-name="toolbox"></span>
                </div>
            </div>
            <div class="thing link" data-fullname="t3_second" data-subreddit="testsub">
                <div class="entry">
                    <ul class="buttons">
                        <li class="remove-button"><button class="togglebutton">remove</button></li>
                    </ul>
                    <span data-name="toolbox"></span>
                </div>
            </div>
        `
		const handlers = createRemovalReasonsHandlers({...handlerSettings, displayMode: 'drawer' as 'Drawer',},)
		document.querySelectorAll<HTMLElement>('[data-name="toolbox"]',).forEach((target, idx,) => {
			injectRemoveButton(idx === 0 ? 't3_first' : 't3_second', 'testsub', target,)
		},)
		const removeButtons = document.querySelectorAll<HTMLElement>('.toolbox-removal-reason-remove',)

		await handlers.handleClick(makeClick(removeButtons[0]!,),)
		await handlers.handleClick(makeClick(removeButtons[1]!,),)

		expect(showRemovalReasonsOverlay,).toHaveBeenCalledTimes(2,)
		expect(showRemovalReasonsOverlay.mock.results[0]!.value,).toHaveBeenCalledOnce()
		expect(removeButtons[0]!.textContent,).toBe('remove',)
		expect(removeButtons[1]!.textContent,).toBe('pending',)
	})

	it('shift-clicks old Reddit remove buttons directly and marks the thing spammed', async () => {
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_post" data-subreddit="testsub">
                <span class="remove-button">
                    <button class="togglebutton">remove</button>
                    <button class="yes">yes</button>
                </span>
            </div>
        `
		const event = makeClick(document.querySelector('.togglebutton',)!, true,)

		await createRemovalReasonsHandlers(handlerSettings,).handleClick(event,)

		expect(event.preventDefault,).toHaveBeenCalled()
		expect(removeThing,).toHaveBeenCalledWith('t3_post', false,)
		expect(document.querySelector('.thing',)!.classList.contains('spammed',),).toBe(true,)
		expect(document.querySelector('.togglebutton',)!.textContent,).toBe('removed',)
		expect(getApiThingInfo,).not.toHaveBeenCalled()
		expect(showRemovalReasonsOverlay,).not.toHaveBeenCalled()
	})

	it('shift-clicks the old Reddit spam button as a spam removal and marks the thing spammed', async () => {
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_post" data-subreddit="testsub">
                <span class="remove-button">
                    <button class="togglebutton" data-event-action="spam">spam</button>
                </span>
            </div>
        `
		const event = makeClick(document.querySelector('.togglebutton',)!, true,)

		await createRemovalReasonsHandlers(handlerSettings,).handleClick(event,)

		expect(removeThing,).toHaveBeenCalledWith('t3_post', true,)
		expect(document.querySelector('.thing',)!.classList.contains('spammed',),).toBe(true,)
		expect(document.querySelector('.togglebutton',)!.textContent,).toBe('spammed',)
		expect(showRemovalReasonsOverlay,).not.toHaveBeenCalled()
	})

	it('flags the removal overlay as spam when the old Reddit spam button is clicked without shift', async () => {
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_post" data-subreddit="testsub">
                <span class="remove-button">
                    <button class="togglebutton" data-event-action="spam">spam</button>
                </span>
            </div>
        `
		const event = makeClick(document.querySelector('.togglebutton',)!,)

		await createRemovalReasonsHandlers(handlerSettings,).handleClick(event,)

		expect(showRemovalReasonsOverlay,).toHaveBeenCalledWith(expect.objectContaining({spam: true,},),)
	})

	it('falls back to the page subreddit when a shift-clicked old Reddit thing has no data-subreddit', async () => {
		// Thing carries a fullname but no data-subreddit; the handler should resolve the
		// sub from the page (postSite) and still remove, rather than no-opping with a toast.
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_post">
                <span class="remove-button">
                    <button class="togglebutton">remove</button>
                </span>
            </div>
        `
		const event = makeClick(document.querySelector('.togglebutton',)!, true,)

		await createRemovalReasonsHandlers(handlerSettings,).handleClick(event,)

		expect(removeThing,).toHaveBeenCalledWith('t3_post', false,)
		expect(document.querySelector('.thing',)!.classList.contains('spammed',),).toBe(true,)
	})

	it('shift-clicks the toolbox remove button directly and marks the thing spammed', async () => {
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_post" data-subreddit="testsub">
                <a class="toolbox-removal-reason-remove" data-id="t3_post" data-subreddit="testsub">remove</a>
            </div>
        `
		const button = document.querySelector<HTMLElement>('.toolbox-removal-reason-remove',)!
		const event = makeClick(button, true,)

		await createRemovalReasonsHandlers(handlerSettings,).handleClick(event,)

		expect(removeThing,).toHaveBeenCalledWith('t3_post', false,)
		expect(document.querySelector('.thing',)!.classList.contains('spammed',),).toBe(true,)
		expect(button.textContent,).toBe('removed',)
		expect(showRemovalReasonsOverlay,).not.toHaveBeenCalled()
	})

	it('does not intercept clicks on buttons whose text only contains "remove" as a substring (e.g. "Removes" filter chip)', async () => {
		document.body.innerHTML = `<button type="button">Removes</button>`
		const btn = document.querySelector('button',)!
		const event = makeClick(btn,)

		await createRemovalReasonsHandlers(handlerSettings,).handleClick(event,)

		expect(event.preventDefault,).not.toHaveBeenCalled()
		expect(event.stopImmediatePropagation,).not.toHaveBeenCalled()
		expect(showRemovalReasonsOverlay,).not.toHaveBeenCalled()
	})

	it('silently removes from shift-clicked Toolbox remove buttons', async () => {
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_post" data-subreddit="testsub">
                <div class="entry">
                    <ul class="buttons">
                        <li><a href="#" class="togglebutton access-required" data-event-action="remove">remove</a></li>
                    </ul>
                    <span data-name="toolbox"></span>
                </div>
            </div>
        `
		const handlers = createRemovalReasonsHandlers(handlerSettings,)
		injectRemoveButton('t3_post', 'testsub', document.querySelector<HTMLElement>('[data-name="toolbox"]',)!,)
		const event = makeClick(document.querySelector('.toolbox-removal-reason-remove',)!, true,)

		await handlers.handleClick(event,)

		expect(event.preventDefault,).toHaveBeenCalledOnce()
		expect(removeThing,).toHaveBeenCalledWith('t3_post', false,)
		expect(getApiThingInfo,).not.toHaveBeenCalled()
		expect(showRemovalReasonsOverlay,).not.toHaveBeenCalled()
	})

	it('still opens the overlay from Add removal reason controls', async () => {
		platform.isOldReddit = false
		setThingInfo('comment',)
		document.body.innerHTML = `
            <div class="toolbox-frontend-container" data-toolbox-type="TBcomment">
                <span
                    class="toolbox-general-button toolbox-add-removal-reason"
                    data-id="t1_comment"
                    data-subreddit="testsub"
                >Add removal reason</span>
            </div>
        `
		const event = makeClick(document.querySelector('.toolbox-add-removal-reason',)!,)

		await createRemovalReasonsHandlers(handlerSettings,).handleClick(event,)

		// The pill carries no onClick, so this capture handler must stop the event itself —
		// otherwise the click would also reach Shreddit's full-post overlay and navigate to the post.
		expect(event.preventDefault,).toHaveBeenCalledOnce()
		expect(event.stopPropagation,).toHaveBeenCalledOnce()
		expect(event.stopImmediatePropagation,).toHaveBeenCalledOnce()
		expect(showRemovalReasonsOverlay,).toHaveBeenCalledOnce()
	})

	it('continues removal when no popup can be shown', async () => {
		getConfig.mockResolvedValue({removalReasons: {reasons: [],},},)
		document.body.innerHTML = `
            <div class="thing link" data-fullname="t3_post" data-subreddit="testsub">
                <span class="remove-button">
                    <button class="togglebutton">remove</button>
                </span>
            </div>
        `
		const event = makeClick(document.querySelector('.togglebutton',)!,)

		await createRemovalReasonsHandlers({...handlerSettings, alwaysShow: false,},).handleClick(event,)

		expect(removeThing,).toHaveBeenCalledWith('t3_post', false,)
		expect(showRemovalReasonsOverlay,).not.toHaveBeenCalled()
	})
})
