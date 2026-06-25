/** Interactive (or flag-driven) release cutter: bumps the manifests, syncs the Firefox ESR floor, then commits and tags. */

import {execSync,} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath,} from 'node:url'
import {parseArgs,} from 'node:util'

import input from '@inquirer/input'

// Mozilla's machine-readable feed of current Firefox version numbers.
const productDetailsUrl = 'https://product-details.mozilla.org/1.0/firefox_versions.json'

// Pulls the version name out of a manifest version_name like `8.0.0: "Forked Phoenix"`.
const versionNameRegex = /^[\d.]+?: "(.+?)"/
// Four-segment manifest version, e.g. 8.0.0.4 -> {display: "8.0.0", build: "4"}.
const versionRegex = /(?<display>\d\d?\.\d\d?\.\d\d?)\.(?<build>\d+)$/

/** Echo a command, run it inheriting stdio, then a trailing blank line. */
function runCommand (command,) {
	console.log(`\x1b[1m$ ${command}\x1b[0m`,)
	execSync(command, {stdio: 'inherit',},)
	console.log()
}

/** Split a dotted numeric version (e.g. "142.0") into comparable integer parts. */
function parseVersion (version,) {
	return version.split('.',).map((part,) => Number.parseInt(part, 10,))
}

/** Compare two dotted version strings; returns <0, 0, or >0 like a sort comparator. */
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

/** Fetch the latest Firefox ESR major as a strict_min_version floor (e.g. "140.0"). */
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

/** Read and parse a manifest JSON file. */
function readManifest (location,) {
	return JSON.parse(fs.readFileSync(location, 'utf8',),)
}

/** Write a manifest back as 4-space-indented JSON with a trailing newline. */
function writeManifest (location, manifest,) {
	fs.writeFileSync(location, `${JSON.stringify(manifest, null, 4,)}\n`, 'utf8',)
}

// Release commits must contain nothing but the version bump, so refuse to run dirty.
if (execSync('git status --porcelain', {encoding: 'utf8',},)) {
	console.error('found uncommitted changes; ensure that you are on the main branch and `git status` is clean',)
	process.exit(1,)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url,),)
const chromeManifestLocation = path.resolve(__dirname, '../extension/chrome_manifest.json',)
const firefoxManifestLocation = path.resolve(__dirname, '../extension/firefox_manifest.json',)

const chromeManifest = readManifest(chromeManifestLocation,)
const firefoxManifest = readManifest(firefoxManifestLocation,)

const currentVersion = chromeManifest.version
const currentVersionName = chromeManifest.version_name.match(versionNameRegex,)[1]

// Release parameters may be supplied non-interactively via CLI flags (--version,
// --name) or the RELEASE_VERSION/RELEASE_NAME environment variables; anything
// omitted falls back to an interactive prompt. Every release is currently a beta
// (the extension has no stable release yet), so there is no release-type choice.
const {values: cliArgs,} = parseArgs({
	options: {
		version: {type: 'string',},
		name: {type: 'string',},
	},
},)
const versionArg = cliArgs.version ?? process.env.RELEASE_VERSION
const nameArg = cliArgs.name ?? process.env.RELEASE_NAME

if (versionArg !== undefined && !/^\d\d?\.\d\d?\.\d\d?\.\d+$/.test(versionArg,)) {
	console.error(`invalid version "${versionArg}"; expected a four-segment version like 8.0.0.4`,)
	process.exit(1,)
}

const newVersion = versionArg ?? await input({message: 'New version', default: currentVersion,},)
const newVersionName = nameArg ?? await input({message: 'New version name', default: currentVersionName,},)

if (newVersion === currentVersion && newVersionName === currentVersionName) {
	console.log('Nothing to change',)
	process.exit(0,)
}

const versionParts = newVersion.match(versionRegex,)?.groups
if (!versionParts) {
	console.error(`invalid version "${newVersion}"; expected a four-segment version like 8.0.0.4`,)
	process.exit(1,)
}

// Sync Firefox's strict_min_version to the latest ESR, but never lower the existing
// floor: if the latest ESR is older (or unreachable), keep the current floor and warn.
const gecko = firefoxManifest.browser_specific_settings.gecko
const currentFloor = gecko.strict_min_version
try {
	const esrFloor = await fetchEsrFloor()
	const delta = compareVersions(esrFloor, currentFloor,)
	if (delta > 0) {
		console.log(`Updating Firefox strict_min_version: ${currentFloor} -> ${esrFloor} (latest ESR)`,)
		gecko.strict_min_version = esrFloor
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

console.log('Writing updated version information to manifests',)
const versionName = `${versionParts.display}: "${newVersionName}"`
chromeManifest.version = newVersion
chromeManifest.version_name = versionName
firefoxManifest.version = newVersion
firefoxManifest.version_name = versionName

writeManifest(chromeManifestLocation, chromeManifest,)
writeManifest(firefoxManifestLocation, firefoxManifest,)

// Every release is a beta for now, tagged `vX.Y.Z-beta.<build>`.
const tagName = `v${versionParts.display}-beta.${versionParts.build}`

console.log('Creating release commit and tag:', tagName,)
console.log()
runCommand(`git commit -am "${tagName}"`,)
runCommand(`git tag "${tagName}"`,)

console.log('Commit and tag created. Verify everything looks good, then push the commit and tag.',)
