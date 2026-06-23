import {execSync,} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath,} from 'node:url'
import {parseArgs,} from 'node:util'

import input from '@inquirer/input'
import select from '@inquirer/select'

function runCommand (command,) {
	console.log(`\x1b[1m$ ${command}\x1b[0m`,)
	execSync(command, {stdio: 'inherit',},)
	console.log()
}

// Mozilla's machine-readable feed of current Firefox version numbers
const productDetailsUrl = 'https://product-details.mozilla.org/1.0/firefox_versions.json'

// parse a dotted numeric version (e.g. "142.0") into comparable integer parts
function parseVersion (version,) {
	return version.split('.',).map((part,) => Number.parseInt(part, 10,))
}

// compare two dotted version strings; returns <0, 0, or >0 like a sort comparator
function compareVersions (a, b,) {
	const partsA = parseVersion(a,)
	const partsB = parseVersion(b,)
	const length = Math.max(partsA.length, partsB.length,)
	for (let i = 0; i < length; i++) {
		const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0)
		if (diff !== 0) {
			return diff
		}
	}
	return 0
}

// fetch the latest Firefox ESR as a strict_min_version floor (e.g. "140.0")
async function fetchEsrFloor () {
	const response = await fetch(productDetailsUrl,)
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`,)
	}
	const data = await response.json()
	const major = data.FIREFOX_ESR?.match(/^(\d+)/,)?.[1]
	if (!major) {
		throw new Error(`unexpected FIREFOX_ESR value: ${data.FIREFOX_ESR}`,)
	}
	return `${major}.0`
}

const prereleaseTypes = ['beta',]
const releaseTypes = [...prereleaseTypes, 'stable',]

// check that working directory is clean - release commits should not contain
// any other changes
if (execSync('git status --porcelain', {encoding: 'utf8',},)) {
	console.error('found uncommitted changes; ensure that you are on the master branch and `git status` is clean',)
	process.exit(1,)
}

const versionNameRegex = /^[\d.]+?: "(.+?)"/

const __filename = fileURLToPath(import.meta.url,)
const __dirname = path.dirname(__filename,)

const chromeManifestLocation = path.resolve(__dirname, '../extension/chrome_manifest.json',)
const firefoxManifestLocation = path.resolve(__dirname, '../extension/firefox_manifest.json',)

const manifestContentChrome = JSON.parse(fs.readFileSync(chromeManifestLocation,).toString(),)
const manifestContentFirefox = JSON.parse(fs.readFileSync(firefoxManifestLocation,).toString(),)

const currentVersion = manifestContentChrome.version
const currentVersionName = manifestContentChrome.version_name.match(versionNameRegex,)[1]

// release parameters may be supplied non-interactively via CLI flags
// (--version, --name, --type) or the RELEASE_VERSION/RELEASE_NAME/RELEASE_TYPE
// environment variables; any that are omitted fall back to an interactive prompt
const {values: cliArgs,} = parseArgs({
	options: {
		version: {type: 'string',},
		name: {type: 'string',},
		type: {type: 'string',},
	},
},)
const versionArg = cliArgs.version ?? process.env.RELEASE_VERSION
const nameArg = cliArgs.name ?? process.env.RELEASE_NAME
const typeArg = cliArgs.type ?? process.env.RELEASE_TYPE

if (versionArg !== undefined && !/^\d\d?\.\d\d?\.\d\d?\.\d+$/.test(versionArg,)) {
	console.error(`invalid version "${versionArg}"; expected a four-segment version like 8.0.0.4`,)
	process.exit(1,)
}
if (typeArg !== undefined && !releaseTypes.includes(typeArg,)) {
	console.error(`invalid release type "${typeArg}"; expected one of: ${releaseTypes.join(', ',)}`,)
	process.exit(1,)
}

;(async () => {
	const newVersion = versionArg ?? await input({
		message: 'New version',
		default: currentVersion,
	},)
	const newVersionName = nameArg ?? await input({
		message: 'New version name',
		default: currentVersionName,
	},)
	const releaseType = typeArg ?? await select({
		message: 'Release type',
		type: 'list',
		choices: releaseTypes,
	},)

	if (newVersion === currentVersion && newVersionName === currentVersionName) {
		console.log('Nothing to change',)
		process.exit(0,)
	}

	// sync Firefox's strict_min_version to the latest ESR, but never lower the
	// existing floor: if the latest ESR is older, discard it and notify the runner
	const currentFloor = manifestContentFirefox.browser_specific_settings.gecko.strict_min_version
	try {
		const esrFloor = await fetchEsrFloor()
		const delta = compareVersions(esrFloor, currentFloor,)
		if (delta > 0) {
			console.log(`Updating Firefox strict_min_version: ${currentFloor} -> ${esrFloor} (latest ESR)`,)
			manifestContentFirefox.browser_specific_settings.gecko.strict_min_version = esrFloor
		} else if (delta < 0) {
			console.warn(
				`Latest Firefox ESR is ${esrFloor}, which is lower than the current strict_min_version `
					+ `${currentFloor}; discarding it and keeping ${currentFloor}`,
			)
		} else {
			console.log(`Firefox strict_min_version is already at the latest ESR (${currentFloor})`,)
		}
	} catch (error) {
		console.warn(
			`Could not determine the latest Firefox ESR; keeping strict_min_version ${currentFloor} (${error.message})`,
		)
	}

	console.log('Writing update version information to manifest',)
	manifestContentFirefox.version = newVersion
	manifestContentChrome.version = newVersion

	const versionParts = newVersion.match(/(?<display>\d\d?\.\d\d?\.\d\d?)\.(?<build>\d+)$/,).groups
	manifestContentFirefox.version_name = `${versionParts.display}: "${newVersionName}"`
	manifestContentChrome.version_name = `${versionParts.display}: "${newVersionName}"`

	fs.writeFileSync(
		chromeManifestLocation,
		// include trailing newline
		`${JSON.stringify(manifestContentChrome, null, 4,)}\n`,
		'utf8',
		(err,) => {
			if (err) {
				throw err
			}
		},
	)
	fs.writeFileSync(
		firefoxManifestLocation,
		// include trailing newline
		`${JSON.stringify(manifestContentFirefox, null, 4,)}\n`,
		'utf8',
		(err,) => {
			if (err) {
				throw err
			}
		},
	)

	// tag the release
	const tagName = `v${versionParts.display}${
		prereleaseTypes.includes(releaseType,) ? `-${releaseType}.${versionParts.build}` : ''
	}`
	console.log('Creating release commit and tag:', tagName,)
	console.log()
	runCommand(`git commit -am "${tagName}"`,)
	runCommand(`git tag "${tagName}"`,)

	console.log('Commit and tag created! Verify everything looks good, then push new commit and tag',)
})()
