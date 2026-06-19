/** Defines the Module class, setting definition types, and related utilities for Toolbox feature modules. */

import {getSettingAsync, setSettingAsync,} from '../util/persistence/settings'

type ModuleCleanup = () => void | Promise<void>
/**
 * The initializer function called when a module is started.
 * Receives all setting values and may return an optional cleanup function.
 */
export type ModuleInitializer<TSettings extends Record<string, any> = Record<string, any>,> = (
	this: Module<TSettings>,
	initialValues: TSettings,
) => void | ModuleCleanup | Promise<void | ModuleCleanup>

/** All valid input types for a Toolbox setting. */
export type SettingType =
	| 'boolean'
	| 'text'
	| 'textarea'
	| 'number'
	| 'selector'
	| 'list'
	| 'sublist'
	| 'stringlist'
	| 'array'
	| 'map'
	| 'code'
	| 'syntaxTheme'
	| 'subreddit'
	| 'modsub'
	| 'action'
	| 'page'
	| 'JSON'
	| 'color'

/**
 * How this setting is represented in anonymized diagnostic output:
 * - `'raw'` - value is included as-is (safe, non-identifying settings).
 * - `'length'` - only the array/string length is included.
 * - `'populated'` - only a boolean indicating whether the value is set.
 * Settings without a `sharedPolicy` are omitted from anonymized output entirely.
 */
export type SharedSettingPolicy = 'raw' | 'length' | 'populated'

/** Defines a single user-configurable setting for a Toolbox module. */
export interface SettingDefinition {
	id: string
	/** Input type for this setting. */
	type: SettingType
	description?: string
	/** Default value, or a function that returns it. */
	default?: any | (() => any)
	storageKey?: string
	/** When true, only shown in debug mode. */
	debug?: boolean
	/** When true, only shown when advanced mode is enabled. */
	advanced?: boolean
	hidden?: boolean | (() => boolean | Promise<boolean>)
	/** Maximum value for numeric settings */
	max?: number | null
	/** Step size for numeric settings */
	step?: number
	/** When true, this setting only applies on old Reddit. */
	oldReddit?: boolean
	/** Used by `type: 'selector'` */
	values?: readonly string[]
	/**
	 * Optional display labels for `type: 'selector'` options, keyed by the option's
	 * `values` entry. Lets the shown text differ from the stored value, so a label can
	 * be renamed without changing what is persisted (e.g. to stay compatible with
	 * Toolbox 6.x settings sync).
	 */
	valueLabels?: Partial<Record<string, string>>
	/** Used by `type: 'map'` to label the key/value columns */
	labels?: string[]
	/** CSS class name to apply to the setting element */
	class?: string
	/** Event name to dispatch when an action-type setting is triggered */
	event?: string
	/** Minimum value for numeric settings */
	min?: number
	/** Placeholder text shown inside empty text inputs */
	placeholder?: string
	/** Maps selector option values to explanatory notes shown in the UI */
	valueNotes?: Partial<Record<string, string>>
	/** URL of a preview image shown alongside this setting */
	previewImageUrl?: string
	/** Preview text or HTML shown alongside this setting */
	preview?: string
	/**
	 * Controls how this setting appears in anonymized diagnostic output.
	 * Settings without a policy are omitted from that output entirely.
	 */
	sharedPolicy?: SharedSettingPolicy
}

type InferSettingValue<T extends SettingDefinition,> = T extends {type: 'boolean'} ? boolean
	: T extends {type: 'text' | 'textarea' | 'code' | 'syntaxTheme' | 'subreddit' | 'modsub'} ? string
	: T extends {type: 'number'} ? number
	: T extends {type: 'list' | 'sublist' | 'stringlist' | 'array'} ? string[]
	: T extends {type: 'map'} ? Record<string, string>
	: T extends {type: 'selector'; values: readonly (infer V extends string)[]} ? V
	: T extends {type: 'selector'} ? string
	: unknown

/** Converts a `defineSettings` return value into a record mapping setting id to value type. */
export type InferSettings<T extends ReadonlyArray<SettingDefinition>,> = {
	[Setting in T[number] as Setting['id']]: InferSettingValue<Setting>
}

/** Declares a typed settings array. Pass the result to `Module` and use `InferSettings` to derive the initializer option type. */
export function defineSettings<const T extends ReadonlyArray<SettingDefinition>,> (settings: T,): T {
	return settings
}

const stringTypes = new Set(['text', 'textarea', 'code', 'syntaxTheme', 'subreddit', 'modsub',],)

/**
 * Splits a dot-delimited storage key into `[moduleId, settingKey]`.
 * All storage keys are set in the constructor as `${moduleId}.${setting.id}`.
 */
function parseStorageKey (storageKey: string,): [string, string,] {
	const dot = storageKey.indexOf('.',)
	return [storageKey.slice(0, dot,), storageKey.slice(dot + 1,),]
}

/**
 * Coerces a raw storage value to the expected type based on the setting definition.
 * Falls back to the setting's default when coercion is not possible.
 */
export function coerceSetting (
	setting: Pick<SettingDefinition, 'type' | 'default' | 'min' | 'max' | 'values'>,
	raw: unknown,
): unknown {
	const def = typeof setting.default === 'function' ? setting.default() : setting.default
	switch (setting.type) {
		case 'boolean':
			return typeof raw === 'boolean' ? raw : def
		case 'number': {
			const n = typeof raw === 'number' ? raw : (typeof raw === 'string' ? Number(raw,) : NaN)
			if (Number.isNaN(n,)) { return def }
			const lo = setting.min != null ? Math.max(setting.min, n,) : n
			return setting.max != null ? Math.min(setting.max, lo,) : lo
		}
		case 'array':
		case 'list':
		case 'sublist':
		case 'stringlist':
			return Array.isArray(raw,) ? raw : def
		case 'map':
			return (typeof raw === 'object' && raw !== null && !Array.isArray(raw,)) ? raw : def
		case 'selector':
			if (typeof raw !== 'string') { return def }
			// Fall back to default if the stored value is no longer a valid option
			return (setting.values == null || setting.values.includes(raw,)) ? raw : def
		case 'page':
			return raw
		default:
			// text, textarea, code, syntaxTheme, subreddit, and anything unknown
			return stringTypes.has(setting.type,) ? (typeof raw === 'string' ? raw : def) : raw
	}
}

interface StoredSetting extends
	Required<
		Omit<
			SettingDefinition,
			| 'id'
			| 'default'
			| 'oldReddit'
			| 'values'
			| 'labels'
			| 'class'
			| 'min'
			| 'max'
			| 'step'
			| 'hidden'
			| 'placeholder'
			| 'valueNotes'
			| 'previewImageUrl'
			| 'preview'
			| 'sharedPolicy'
		>
	>
{
	hidden?: boolean
	id: string
	default?: any | (() => any)
	placeholder?: string
	valueNotes?: Partial<Record<string, string>>
	previewImageUrl?: string
	preview?: string
	sharedPolicy?: SharedSettingPolicy
}

/** Constructor options for a Toolbox Module. */
export interface ModuleOptions {
	/** Human-readable name shown in the settings UI. */
	name: string
	/** Unique identifier; defaults to `name` with whitespace removed. */
	id?: string
	/** Whether the module is enabled when the user hasn't configured it yet. */
	enabledByDefault?: boolean
	/** When true, the module cannot be disabled by the user. */
	alwaysEnabled?: boolean
	/** When true, the module only appears when debug mode is on. */
	debug?: boolean
	/** When true, the module only runs on old Reddit; the module registry skips it elsewhere. */
	oldReddit?: boolean
	/** When true, the module only runs on the Shreddit UI; the module registry skips it elsewhere. */
	shreddit?: boolean
	settings?: readonly SettingDefinition[]
}

/**
 * Builds a sharing-policy map from a set of registered modules.
 * The returned record maps fully-qualified storage keys (`Toolbox.{ModuleID}.{settingId}`)
 * to their `sharedPolicy` value.  Settings without a `sharedPolicy` are omitted.
 * Pass the result to `getAnonymizedSettings()` so the anonymizer knows what to include.
 */
export function buildPolicyMap (modules: ReadonlyArray<Module<any>>,): Record<string, SharedSettingPolicy> {
	const map: Record<string, SharedSettingPolicy> = {}
	for (const mod of modules) {
		for (const setting of mod.settings.values()) {
			if (setting.sharedPolicy != null) {
				map[`Toolbox.${mod.id}.${setting.id}`] = setting.sharedPolicy
			}
		}
	}
	return map
}

/** A user-toggleable Toolbox feature unit; instances are registered and run by the framework. */
export class Module<TSettings extends Record<string, any> = Record<string, any>,> {
	name: string
	id: string
	enabledByDefault: boolean
	alwaysEnabled: boolean
	/** If true, the module will only show up when debug mode is enabled */
	// debugMode, not debug, because `debug` is a logger function
	debugMode: boolean
	oldReddit: boolean
	shreddit: boolean
	initializer?: ModuleInitializer<TSettings>
	cleanup?: ModuleCleanup
	settings: Map<string, StoredSetting>
	sort?: {location: string; order: number}

	constructor (
		{
			name,
			id = name.replace(/\s/g, '',),
			enabledByDefault = false,
			alwaysEnabled = false,
			debug = false,
			oldReddit = false,
			shreddit = false,
			settings = [],
		}: ModuleOptions,
		initializer?: ModuleInitializer<TSettings>,
	) {
		this.name = name
		this.id = id
		this.enabledByDefault = enabledByDefault
		this.alwaysEnabled = alwaysEnabled
		this.debugMode = debug
		this.oldReddit = oldReddit
		this.shreddit = shreddit
		if (initializer !== undefined) {
			this.initializer = initializer
		}

		// Register settings
		this.settings = new Map()
		for (const setting of settings) {
			this.settings.set(setting.id, {
				description: `(${setting.id})`,
				storageKey: `${id}.${setting.id}`,
				debug: false,
				advanced: false,
				hidden: false,
				...setting,
			} as StoredSetting,)
		}
	}

	/**
	 * Gets the value of a setting.
	 */
	async get<K extends keyof TSettings & string,> (id: K,): Promise<TSettings[K]> {
		const setting = this.settings.get(id,)
		if (!setting) {
			throw new TypeError(`Module ${this.name} does not have a setting ${id} to get`,)
		}

		// The settings utils don't actually accept straight storage keys, so we
		// have to split the key into a module name and the rest of the key
		const [mod, key,] = parseStorageKey(setting.storageKey,)

		// We don't use the `defaultVal` option here because for some reason we
		// support defaults being functions, and we want to avoid running
		// defaults that are functions unless we actually don't have another
		// value - eagerly evaluating those could cause problems
		const value = await getSettingAsync(mod, key,)

		if (value == null) {
			if (typeof setting.default === 'function') {
				return setting.default()
			} else {
				return setting.default
			}
		}
		return coerceSetting(setting, value,) as TSettings[K]
	}

	/**
	 * Sets the value of a setting.
	 */
	set<K extends keyof TSettings & string,> (id: K, value: TSettings[K],): Promise<any> {
		const setting = this.settings.get(id,)
		if (!setting) {
			throw new TypeError(`Module ${this.name} does not have a setting ${id} to set`,)
		}

		// The settings utils don't actually accept straight storage keys, so we
		// have to split the key into a module name and the rest of the key
		const [mod, key,] = parseStorageKey(setting.storageKey,)
		return setSettingAsync(mod, key, value,)
	}

	/**
	 * "Starts" the module by calling its initializer.
	 */
	async init (): Promise<void> {
		// Read the current values of all registered settings
		const initialValues: Record<string, any> = Object.create(null,)
		await Promise.all([...this.settings.values(),].map(async (setting,) => {
			initialValues[setting.id] = await this.get(setting.id,)
		},),)

		// Call the initializer if provided, passing the module instance the settings
		if (this.initializer) {
			const cleanup = await this.initializer.call(this, initialValues as TSettings,)
			if (typeof cleanup === 'function') {
				this.cleanup = cleanup
			}
		}
	}

	/**
	 * Check whether or not the module is enabled.
	 */
	async getEnabled (): Promise<boolean> {
		if (this.alwaysEnabled) {
			return true
		}
		return !!await getSettingAsync(this.id, 'enabled', this.enabledByDefault,)
	}

	/**
	 * Enables or disables the module. This does not take effect until Toolbox
	 * is reloaded.
	 * @throws {Error} when trying to disable a module that cannot be disabled
	 */
	setEnabled (enable: boolean,): Promise<void> {
		if (this.alwaysEnabled && !enable) {
			throw new Error(`Cannot disable module ${this.id} which is always enabled`,)
		}

		return setSettingAsync(this.id, 'enabled', !!enable,)
	}

	/**
	 * Subscribes to live changes for a single setting.
	 * The callback is invoked with the new coerced value whenever the setting changes.
	 * Returns an unsubscribe function - call it (e.g. from your cleanup function) to stop listening.
	 *
	 * Change events are dispatched via the `'tb-setting-changed'` CustomEvent on `window`,
	 * which is fired by the settings Redux slice whenever extension storage updates.
	 *
	 * @example
	 * ```ts
	 * function init(s) {
	 *   const unsub = self.onChange('compactHide', newVal => { ... })
	 *   return unsub  // or wrap in a broader cleanup
	 * }
	 * ```
	 */
	onChange<K extends keyof TSettings & string,> (
		id: K,
		callback: (newValue: TSettings[K],) => void,
	): () => void {
		const setting = this.settings.get(id,)
		if (!setting) {
			throw new TypeError(`Module ${this.name} does not have a setting ${id}`,)
		}

		const storageKey = `Toolbox.${setting.storageKey}`

		const handler = (event: Event,) => {
			const {key, newValue,} = (event as CustomEvent<{key: string; newValue: unknown}>).detail
			if (key === storageKey) {
				callback(coerceSetting(setting, newValue,) as TSettings[K],)
			}
		}

		window.addEventListener('tb-setting-changed', handler,)
		return () => window.removeEventListener('tb-setting-changed', handler,)
	}
}
