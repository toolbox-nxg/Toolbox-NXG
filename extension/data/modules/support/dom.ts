/** DOM helpers and handlers for the Support module, including debug-info injection into submission forms. */

import {createElement,} from 'react'

import {provideLocation, renderAtLocation,} from '../../dom/uiLocations'
import {template,} from '../../util/data/string'
import {RedditPlatform,} from '../../util/infra/platform'

const debugTemplate = `

---
***Toolbox-NXG debug information***

Info| &nbsp;
---|---
*Toolbox-NXG version*|{{toolboxVersion}}
*Browser*|{{browserName}}
*Version*|{{browserVersion}}
*Platform*|{{platformInfo}}
*Debug mode*|{{debugMode}}
*Compact mode*|{{compactMode}}
*Advanced settings*|{{advancedSettings}}
*Cookies enabled*|{{cookiesEnabled}}
`

/**
 * Renders the debug-information markdown table to append to a support submission.
 * @param info Browser and toolbox diagnostic values to include.
 * @returns A markdown string ready to append to a Reddit text post or comment.
 */
export function buildSubmissionAddition (info: {
	toolboxVersion: string
	browser: string
	browserVersion: string
	platformInformation: string
	debugMode: boolean
	compactMode: boolean
	advancedSettings: boolean
	cookiesEnabled: boolean
},): string {
	return template(debugTemplate, {
		toolboxVersion: info.toolboxVersion,
		browserName: info.browser,
		browserVersion: info.browserVersion,
		platformInfo: info.platformInformation,
		debugMode: info.debugMode,
		compactMode: info.compactMode,
		advancedSettings: info.advancedSettings,
		cookiesEnabled: info.cookiesEnabled,
	},)
}

/**
 * Wires an already-inserted slot element up as a `userTextControls` location and pushes its
 * teardown (DOM removal + unprovide) onto `cleanups`.
 * @param slot The element inserted into the DOM to host the controls.
 * @param cleanups Array that receives the teardown callbacks (torn down in reverse order).
 */
function provideUserTextControlsSlot (slot: Element, cleanups: Array<() => void>,): void {
	cleanups.push(() => slot.remove())
	cleanups.push(provideLocation('userTextControls', slot, {
		platform: RedditPlatform.Old,
		kind: 'userText',
	}, {shadow: false,},),)
}

/**
 * Renders the "Insert debug info" button into the `userTextControls` location.
 * @returns The cleanup function that unmounts the rendered button.
 */
function renderDebugInfoButton (): () => void {
	return renderAtLocation('userTextControls', {id: 'support.debugInfo',}, () =>
		createElement('div', {
			className: 'toolbox-action-button toolbox-insert-debug',
		}, 'Insert debug info',),)
}

/** Handlers returned by {@link createSupportHandlers} for the Support module lifecycle. */
export interface SupportHandlers {
	/** Appends debug info to the submission text area when the insert button is clicked. */
	handleSubmitInsert: () => void
	/** Provides a userTextControls slot beside the submit button for the "Insert debug info" button and returns a cleanup function. */
	insertSubmitDebugButton: () => () => void
	/** Provides a userTextControls slot for the "Insert debug info" button and returns a cleanup function. */
	insertDebugButton: () => () => void
	/** Appends debug info to the nearest comment text area when the insert button is clicked. */
	handleInsertDebug: (element: Element,) => void
}

/**
 * Creates DOM handlers for the support module.
 * @param submissionAddition Pre-rendered debug-info markdown to append to text areas.
 */
export function createSupportHandlers (submissionAddition: string,): SupportHandlers {
	function handleSubmitInsert () {
		const submissionTextArea = document.querySelector<HTMLTextAreaElement>('.usertext-edit.md-container textarea',)
		if (!submissionTextArea) { return }
		submissionTextArea.value += submissionAddition
	}

	/**
	 * Injects an "Insert debug info" button beside the submit button on the submission page.
	 * @returns A cleanup function that removes the button and its slot.
	 */
	function insertSubmitDebugButton (): () => void {
		const submitButton = document.querySelector('.submit.content .btn[name="submit"]',)

		const cleanups: Array<() => void> = []

		if (submitButton) {
			const slot = document.createElement('div',)
			slot.className = 'toolbox-usertext-controls-slot'
			submitButton.before(slot,)
			provideUserTextControlsSlot(slot, cleanups,)
			cleanups.push(renderDebugInfoButton(),)
		}

		return () => {
			while (cleanups.length) {
				cleanups.pop()!()
			}
		}
	}

	function insertDebugButton (): () => void {
		const usertextButtons = document.querySelector('.usertext-edit .usertext-buttons',)
		const saveButton = usertextButtons?.querySelector('.save',)
		const tbUsertextButtons = saveButton?.parentElement?.querySelector('.toolbox-usertext-buttons',)

		const cleanups: Array<() => void> = []

		if (tbUsertextButtons) {
			const slot = document.createElement('div',)
			slot.className = 'toolbox-usertext-controls-slot'
			tbUsertextButtons.before(slot,)
			provideUserTextControlsSlot(slot, cleanups,)
		} else {
			const wrapper = document.createElement('div',)
			wrapper.className = 'toolbox-usertext-buttons'

			const statusEl = saveButton?.parentElement?.querySelector('.status',)
			statusEl?.before(wrapper,)
			provideUserTextControlsSlot(wrapper, cleanups,)
		}

		cleanups.push(renderDebugInfoButton(),)

		return () => {
			while (cleanups.length) {
				cleanups.pop()!()
			}
		}
	}

	function handleInsertDebug (element: Element,) {
		const commentTextArea = element
			.closest('.usertext-edit.md-container',)
			?.querySelector<HTMLTextAreaElement>('.md textarea',)
		if (!commentTextArea) { return }
		commentTextArea.value += submissionAddition
	}

	return {handleSubmitInsert, insertSubmitDebugButton, insertDebugButton, handleInsertDebug,}
}
