/** Version constants, display strings, and the last-version update check for Toolbox. */

import browser from 'webextension-polyfill'

import {utils,} from '../../framework/moduleIds'
import {getSettingAsync,} from '../persistence/settings'
import {buildCount, buildSha, buildType,} from './buildenv'

const manifest = browser.runtime.getManifest()
const versionRegex = /(?<major>\d\d?)\.(?<minor>\d\d?)\.(?<patch>\d\d?)\.(?<build>\d+)/
const match = manifest.version.match(versionRegex,)
const {major, minor, patch, build,} = match?.groups as {major: string; minor: string; patch: string; build: string}

/**
 * Compact version string carrying every potentially useful build detail.
 * @example '7.4.2.0 stable a1b2c3d'
 * @example '7.5.0.2 beta e4f5a6b'
 * @example '0.0.0.0 dev local'
 */
export const toolboxVersion = `${manifest.version} ${buildType} ${buildSha?.slice(0, 7,) || 'local'}`.trim()

/**
 * Human-readable version label; stable builds omit the build number and commit.
 * @example '7.4.2 "Delaying Donkey"'
 * @example '7.5.0 "Rewriting Rattlesnake" (beta build 2 from e4f5a6b)'
 * @example '0.0.0 "Unknown Urchin" (dev build 4 from local copy)'
 */
const effectiveBuild = buildType === 'dev' ? buildCount : (build || 0)
export const toolboxVersionName = `${manifest.version_name ?? manifest.version}${
	buildType === 'stable'
		? ''
		: ` (${buildType} build ${effectiveBuild} from ${buildSha?.slice(0, 7,) || 'local copy'})`
}`

/**
 * Numeric representation of major/minor/patch as a single integer for version
 * comparison against stored lastVersion values.
 * @example 60113
 */
export const versionNumber = parseInt(major, 10,) * 10000 + parseInt(minor, 10,) * 100 + parseInt(patch, 10,) * 1

const settingsName = utils
let lastVersionPromise: Promise<number> | null = null

/**
 * Returns a promise for the `lastVersion` setting value (the version number the user last ran).
 * The result is cached after the first call.
 */
export function getLastVersion () {
	if (!lastVersionPromise) {
		lastVersionPromise = getSettingAsync(settingsName, 'lastVersion', 0,)
	}
	return lastVersionPromise
}
