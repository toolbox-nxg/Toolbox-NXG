/** Tests for TBModule.init module isolation. */

// @vitest-environment node
import {beforeEach, describe, expect, it, vi,} from 'vitest'

const errorLog = vi.hoisted(() => vi.fn())

vi.mock('../util/infra/logging', () => ({
	default: () => ({debug: vi.fn(), error: errorLog, warn: vi.fn(), info: vi.fn(),}),
}),)
vi.mock('../util/infra/platform', () => ({isOldReddit: true, isShreddit: false,}),)
vi.mock('../util/persistence/settings', () => ({
	getSettings: vi.fn().mockResolvedValue({},),
	getSettingFrom: (_settings: unknown, _mod: string, _key: string, dflt: unknown,) => dflt,
	getSettingAsync: vi.fn(),
	setSettingAsync: vi.fn(),
}),)
vi.mock('../util/persistence/settingsPortability', () => ({exportSettings: vi.fn(), importSettings: vi.fn(),}),)
vi.mock('../modules/shared/settings/SettingsDialog', () => ({SettingsDialog: () => null,}),)
vi.mock('../store/index', () => ({default: {dispatch: vi.fn(),},}),)
vi.mock('../util/ui/reactMount', () => ({reactRenderer: vi.fn(),}),)
vi.mock('./lifecycle', () => ({throwIfErrors: vi.fn(),}),)

import {Module,} from './module'
import TBModule from './moduleRegistry'

describe('TBModule.init isolation', () => {
	beforeEach(() => {
		TBModule.modules.length = 0
		errorLog.mockClear()
	},)

	it('isolates a failing module initializer so other modules still load', async () => {
		const okInit = vi.fn()
		const bad = new Module({name: 'Bad', id: 'Bad', alwaysEnabled: true,}, () => {
			throw new Error('boom',)
		},)
		const good = new Module({name: 'Good', id: 'Good', alwaysEnabled: true,}, okInit,)
		// Register the failing module first to prove it doesn't abort the pass.
		TBModule.registerModule(bad,)
		TBModule.registerModule(good,)

		// init must resolve (not reject), and the healthy module must still run.
		await expect(TBModule.init(),).resolves.toBeUndefined()
		expect(okInit,).toHaveBeenCalledTimes(1,)
		expect(errorLog,).toHaveBeenCalledWith(expect.stringContaining('Bad',), expect.any(Error,),)
	})

	it('isolates a module whose async initializer rejects', async () => {
		const okInit = vi.fn()
		const bad = new Module(
			{name: 'Bad', id: 'Bad', alwaysEnabled: true,},
			() => Promise.reject(new Error('async boom',),),
		)
		const good = new Module({name: 'Good', id: 'Good', alwaysEnabled: true,}, okInit,)
		TBModule.registerModule(bad,)
		TBModule.registerModule(good,)

		await expect(TBModule.init(),).resolves.toBeUndefined()
		expect(okInit,).toHaveBeenCalledTimes(1,)
		expect(errorLog,).toHaveBeenCalledTimes(1,)
	})
})
