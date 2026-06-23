/**
 * Typed message dispatcher for the Toolbox background service worker.
 * Validates that messages arrive from legitimate Reddit origins, checks each
 * message's payload against a per-action schema, and routes to the registered handler.
 */

import browser from 'webextension-polyfill'

import createLogger from '../util/infra/logging'
import {isAllowedRedditHost,} from './handlers/tabUtils'
import type {ToolboxMessage, ToolboxMessageAction,} from './messages'

const log = createLogger('TBMessageHandling',)

/** Wraps a value type to also allow a `Promise` of that type. */
type MaybePromise<T,> = T | Promise<T>

/** A handler function for a specific `ToolboxMessage` subtype. */
type MessageHandlerFn<M extends ToolboxMessage,> = (
	request: M,
	sender: browser.Runtime.MessageSender,
) => MaybePromise<unknown>

/** Registry mapping action strings to their typed handler functions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous handler registry: each action's handler accepts a different ToolboxMessage subtype, erased to any at storage
const messageHandlers = new Map<string, MessageHandlerFn<any>>()

/** A function that validates the payload of an incoming message. */
type MessageValidator = (request: Record<string, unknown>,) => boolean

/** Returns `true` if `value` is a non-null, non-array object. */
function isPlainObject (value: unknown,): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value,)
}

/**
 * Returns a validator that accepts `undefined` or any value satisfying `predicate`.
 * Used to build the `optional*` validators below.
 */
function makeOptional (predicate: (v: unknown,) => boolean,): (v: unknown,) => boolean {
	return (v,) => v === undefined || predicate(v,)
}

/** Returns `true` if `value` is `undefined` or a boolean. */
const optionalBoolean = makeOptional((v,) => typeof v === 'boolean')

/** Returns `true` if `value` is `undefined` or a string. */
const optionalString = makeOptional((v,) => typeof v === 'string')

/** Returns `true` if `value` is `undefined` or a plain object. */
const optionalPlainObject = makeOptional(isPlainObject,)

/** Returns `true` if `value` is `undefined` or an array of strings. */
const optionalStringArray = makeOptional(
	(v,) => Array.isArray(v,) && (v as unknown[]).every((item,) => typeof item === 'string'),
)

/** Returns `true` if `value` is `undefined` or a plain object whose values are all primitive (string, number, boolean, or undefined). */
const optionalQueryParams = makeOptional(
	(v,) =>
		isPlainObject(v,) && Object.values(v,).every(
			(item,) =>
				item === undefined || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
		),
)

/**
 * Returns `true` if `value` is a valid request body: `undefined`, a raw string,
 * a `{type: 'json', data: ...}` wrapper, or a plain object of string values
 * (form-encoded body).
 */
function isRequestBody (value: unknown,): boolean {
	return value === undefined
		|| typeof value === 'string'
		|| (isPlainObject(value,) && value.type === 'json' && 'data' in value)
		|| (
			isPlainObject(value,)
			&& Object.values(value,).every((item,) => item === undefined || typeof item === 'string')
		)
}

/**
 * Returns `true` if the message sender is either the background page itself
 * (no `sender.tab`) or a tab whose URL is on a reddit.com/redd.it HTTPS origin.
 */
function isValidSender (sender: browser.Runtime.MessageSender,): boolean {
	if (!sender.tab) {
		return true
	}
	if (!sender.tab.url) {
		return false
	}
	try {
		const url = new URL(sender.tab.url,)
		return url.protocol === 'https:' && isAllowedRedditHost(url.hostname,)
	} catch {
		return false
	}
}

/** Per-action payload validators; every known `ToolboxMessageAction` must have an entry. */
const messageValidators: Record<ToolboxMessageAction, MessageValidator> = {
	'toolbox-request': (request,) =>
		typeof request.endpoint === 'string'
		&& optionalString(request.method,)
		&& optionalQueryParams(request.query,)
		&& isRequestBody(request.body,)
		&& optionalBoolean(request.oauth,)
		&& optionalBoolean(request.okOnly,)
		&& optionalBoolean(request.absolute,),

	'toolbox-cache': (request,) => {
		if (request.method === 'clear') {
			return true
		}
		return (request.method === 'get' || request.method === 'set') && typeof request.storageKey === 'string'
	},

	'toolbox-cache-force-timeout': () => true,

	'toolbox-update-settings': (request,) =>
		optionalPlainObject(request.updatedSettings,) && optionalStringArray(request.deletedSettings,),

	'toolbox-overwrite-all-settings': (request,) => isPlainObject(request.newSettings,),

	'toolbox-notification': (request,) =>
		typeof request.native === 'boolean'
		&& isPlainObject(request.details,)
		&& typeof request.details.title === 'string'
		&& typeof request.details.body === 'string'
		&& typeof request.details.url === 'string',

	'toolbox-page-notification-click': (request,) => typeof request.id === 'string',
	'toolbox-page-notification-clear': (request,) => typeof request.id === 'string',

	'toolbox-reload': () => true,

	'toolbox-global': (request,) =>
		typeof request.globalEvent === 'string' && optionalBoolean(request.excludeBackground,),

	'toolbox-modqueue': (request,) =>
		typeof request.subreddit === 'string'
		&& typeof request.thingName === 'string'
		&& typeof request.thingTimestamp === 'number',

	'toolbox-usernote-decompress': (request,) =>
		typeof request.cacheKey === 'string'
		&& typeof request.blob === 'string',
}

/**
 * Registers a typed handler for a background message action.
 * The action string and request payload type are checked against the
 * ToolboxMessage union defined in messages.ts.
 */
export function registerMessageHandler<a extends ToolboxMessage['action'],> (
	action: a,
	handler: MessageHandlerFn<Extract<ToolboxMessage, {action: a}>>,
): void {
	messageHandlers.set(action, handler,)
}

/**
 * Dispatches an incoming runtime message to its registered handler after
 * validating the sender origin and payload shape.
 * Messages from invalid origins or with malformed payloads are silently dropped
 * with a console warning.
 */
export function handleMessage (request: unknown, sender: browser.Runtime.MessageSender,) {
	if (
		request == null || typeof request !== 'object' || !('action' in request) || typeof request.action !== 'string'
	) {
		log.warn('Malformed toolbox message (missing action):', request, sender,)
		return
	}
	const handler = messageHandlers.get(request.action,)
	if (handler) {
		if (!isValidSender(sender,)) {
			log.warn('Rejected toolbox message from invalid sender:', request.action, sender,)
			return
		}
		const validator = messageValidators[request.action as ToolboxMessageAction]
		if (!validator(request,)) {
			log.warn('Malformed toolbox message payload:', request, sender,)
			return
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- validated above; bridge the erased registry handler to this specific request at the dispatch boundary
		return Promise.resolve(handler(request as any, sender,),).catch((error,) => {
			log.error('Toolbox background handler failed:', request.action, error,)
			throw error
		},)
	} else {
		log.warn('Unknown toolbox message action:', request.action, sender,)
		return
	}
}

browser.runtime.onMessage.addListener(handleMessage,)
