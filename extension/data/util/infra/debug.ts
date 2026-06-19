/** Utilities for collecting and logging toolbox debug information. */
import {modbar, utils,} from '../../framework/moduleIds'
import {getSettingAsync,} from '../persistence/settings'
import createLogger from './logging'
import {toolboxVersion,} from './version'

const log = createLogger('Debug',)

/**
 * Collects version, browser, and relevant setting values for debugging purposes.
 * @returns An object with toolbox version, browser info, and key setting states; also logs it to the console.
 */
export async function debugInformation () {
	const ua = navigator.userAgent
	const debugObject = {
		toolboxVersion,
		browser: ua,
		browserVersion: '',
		platformInformation: ua,
		debugMode: await getSettingAsync(utils, 'debugMode', false,),
		compactMode: await getSettingAsync(modbar, 'compactHide', false,),
		advancedSettings: await getSettingAsync(utils, 'advancedMode', false,),
		cookiesEnabled: navigator.cookieEnabled,
	}
	log.debug('Version/browser information:', debugObject,)
	return debugObject
}
