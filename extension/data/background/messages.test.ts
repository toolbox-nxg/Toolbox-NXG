/** Tests for background message contracts. */

// @vitest-environment node
import {describe, expect, it,} from 'vitest'

import * as messages from './messages'
import type {ToolboxMessage, ToolboxMessageAction,} from './messages'

const messageExamples = [
	{action: 'toolbox-request', endpoint: '/api/v1/me', oauth: true,},
	{action: 'toolbox-cache', method: 'get', storageKey: 'Utils.example', inputValue: null,},
	{action: 'toolbox-cache', method: 'set', storageKey: 'Utils.example', inputValue: {ok: true,},},
	{action: 'toolbox-cache', method: 'clear',},
	{action: 'toolbox-cache-force-timeout',},
	{action: 'toolbox-update-settings', updatedSettings: {enabled: true,}, deletedSettings: ['old',],},
	{action: 'toolbox-overwrite-all-settings', newSettings: {enabled: true,},},
	{
		action: 'toolbox-notification',
		native: true,
		details: {
			title: 'Title',
			body: 'Body',
			url: 'https://old.reddit.com/message/messages/abc',
			markreadid: null,
		},
	},
	{action: 'toolbox-page-notification-click', id: 'notification-id',},
	{action: 'toolbox-page-notification-clear', id: 'notification-id',},
	{action: 'toolbox-reload',},
	{action: 'toolbox-global', globalEvent: 'TBGlobal', payload: {ok: true,},},
	{action: 'toolbox-modqueue', subreddit: 'testsub', thingName: 't3_post', thingTimestamp: 123,},
] satisfies ToolboxMessage[]

describe('background message contracts', () => {
	it('has no runtime exports because messages.ts is type-only', () => {
		expect(Object.keys(messages,),).toEqual([],)
	})

	it('documents every ToolboxMessage action with a representative payload', () => {
		const actions = messageExamples.map((message,) => message.action satisfies ToolboxMessageAction)

		expect(actions,).toEqual([
			'toolbox-request',
			'toolbox-cache',
			'toolbox-cache',
			'toolbox-cache',
			'toolbox-cache-force-timeout',
			'toolbox-update-settings',
			'toolbox-overwrite-all-settings',
			'toolbox-notification',
			'toolbox-page-notification-click',
			'toolbox-page-notification-clear',
			'toolbox-reload',
			'toolbox-global',
			'toolbox-modqueue',
		],)
	})
})
