/** Generic keyed storage helper for flat namespaced values in `browser.storage`. */

import browser from 'webextension-polyfill'

/**
 * Generic keyed storage helper for flat namespaced values in `browser.storage`.
 * Each entry is stored under a key of the form `${prefix}-${id}`, allowing a
 * single logical "store" to hold many independent values without a nested object.
 *
 * @example
 * const store = new KeyedStore<MyType>('session', 'mynamespace');
 * await store.set('abc', {foo: 'bar'});
 * const val = await store.get('abc'); // {foo: 'bar'}
 * await store.delete('abc');
 */
export class KeyedStore<T,> {
	constructor (
		private readonly area: 'local' | 'session',
		private readonly prefix: string,
	) {}

	/** Returns the storage key for the given `id`. */
	private key (id: string,): string {
		return `${this.prefix}-${id}`
	}

	/** Persists `value` under the storage key for `id`. */
	set (id: string, value: T,): Promise<void> {
		return browser.storage[this.area].set({[this.key(id,)]: value,},)
	}

	/** Returns the stored value for `id`, or `null` if not present. */
	async get (id: string,): Promise<T | null> {
		const k = this.key(id,)
		const result = await browser.storage[this.area].get({[k]: null,},) as Record<string, T | null>
		return result[k] ?? null
	}

	/** Removes the stored value for `id`. */
	delete (id: string,): Promise<void> {
		return browser.storage[this.area].remove(this.key(id,),)
	}
}
