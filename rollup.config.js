import {execSync,} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import commonjs from '@rollup/plugin-commonjs'
import {DEFAULTS as nodeResolveDefaults, nodeResolve,} from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import terser from '@rollup/plugin-terser'
import typescript from '@rollup/plugin-typescript'
import copy from 'rollup-plugin-copy'
import postcss from 'rollup-plugin-postcss'

const validBuildTypes = new Set(['stable', 'beta', 'dev',],)

// Build types other than dev are mostly handled by CI, but keeping the fallback
// here makes local/manual builds harder to misconfigure.
let buildType = process.env.BUILD_TYPE
if (!buildType) {
	buildType = 'dev'
} else if (!validBuildTypes.has(buildType,)) {
	console.warn('warning: unrecognized BUILD_TYPE', buildType, '- using dev instead',)
	buildType = 'dev'
}

const buildSha = process.env.BUILD_SHA
if (buildType !== 'dev' && !buildSha) {
	console.warn(
		'warning: no BUILD_SHA provided but this is not a dev build; do not distribute builds without BUILD_SHA',
	)
}

const isDevBuild = buildType === 'dev'

let devBuildCount = 0
if (isDevBuild) {
	try {
		devBuildCount = Number.parseInt(execSync('git rev-list --count HEAD', {encoding: 'utf8',},).trim(), 10,)
	} catch (_) {
		// Not a git repo, or git is unavailable.
	}
}

const sourceExtensionByOutputExtension = new Map([
	// Browser manifests point at emitted JS; Rollup entries come from TS source.
	['.js', '.ts',],
],)

const platforms = {
	chrome: {
		manifest: 'extension/chrome_manifest.json',
		outputDir: 'build/chrome',
	},
	firefox: {
		manifest: 'extension/firefox_manifest.json',
		outputDir: 'build/firefox',
	},
}

const validBuildTargets = new Set(['all', ...Object.keys(platforms,),],)
let buildTarget = process.env.BUILD_TARGET ?? 'all'
if (!validBuildTargets.has(buildTarget,)) {
	console.warn('warning: unrecognized BUILD_TARGET', buildTarget, '- building all platforms instead',)
	buildTarget = 'all'
}

function readJSON (file,) {
	return JSON.parse(fs.readFileSync(file, 'utf8',),)
}

function outputPathToSourcePath (manifestPath,) {
	const parsed = path.parse(manifestPath,)
	const sourceExtension = sourceExtensionByOutputExtension.get(parsed.ext,) ?? parsed.ext
	return path.join('extension', parsed.dir, `${parsed.name}${sourceExtension}`,)
}

function getContentScriptEntries (manifest,) {
	return manifest.content_scripts.flatMap((script,) => script.js ?? [])
}

function getBackgroundEntry (manifest,) {
	if (manifest.background?.service_worker) {
		return manifest.background.service_worker
	}
	const [script,] = manifest.background?.scripts ?? []
	if (script) {
		return script
	}
	throw new Error('Manifest does not define a background script',)
}

function normalizeManifestAssetPath (manifestPath,) {
	return manifestPath.startsWith('/',) ? manifestPath.slice(1,) : manifestPath
}

function collectManifestDataPaths (value, paths = new Set(),) {
	if (typeof value === 'string') {
		const normalizedPath = normalizeManifestAssetPath(value,)
		if (normalizedPath.startsWith('data/',)) {
			paths.add(normalizedPath,)
		}
	} else if (Array.isArray(value,)) {
		for (const item of value) {
			collectManifestDataPaths(item, paths,)
		}
	} else if (value && typeof value === 'object') {
		for (const item of Object.values(value,)) {
			collectManifestDataPaths(item, paths,)
		}
	}
	return paths
}

function getGeneratedManifestPaths (manifest,) {
	return new Set([
		...getContentScriptEntries(manifest,),
		getBackgroundEntry(manifest,),
		'data/bundled.css',
	],)
}

function getStaticAssetPaths (manifest,) {
	const generatedPaths = getGeneratedManifestPaths(manifest,)
	return [...collectManifestDataPaths(manifest,),]
		.filter((manifestPath,) => !generatedPaths.has(manifestPath,))
		.sort()
}

function buildDefines () {
	return replace({
		preventAssignment: true,
		values: {
			// React's JSX runtime checks this value for development behavior.
			'process.env.NODE_ENV': JSON.stringify(isDevBuild ? undefined : 'production',),
			// Runtime build metadata controls prerelease settings, version display, etc.
			'BUILD_TYPE': JSON.stringify(buildType,),
			'BUILD_SHA': JSON.stringify(buildSha ?? null,),
			'BUILD_COUNT': JSON.stringify(devBuildCount,),
		},
	},)
}

function sharedScriptPlugins (outDir,) {
	return [
		nodeResolve({
			extensions: [...nodeResolveDefaults.extensions, '.ts', '.tsx',],
		},),
		commonjs(),
		typescript({
			compilerOptions: {
				// Keep TS emit paths aligned with manifest paths like data/init.js.
				rootDir: 'extension/data',
				outDir,
			},
		},),
	]
}

function copyManifestAndStaticAssets ({manifest: manifestPath, outputDir,},) {
	const manifest = readJSON(manifestPath,)
	const staticAssetTargets = getStaticAssetPaths(manifest,).map((assetPath,) => ({
		src: `extension/${assetPath}`,
		dest: `${outputDir}/${path.dirname(assetPath,)}`,
	}))

	return copy({
		targets: [
			{
				src: manifestPath,
				dest: outputDir,
				rename: 'manifest.json',
			},
			...staticAssetTargets,
		],
	},)
}

function contentScriptConfig (platformConfig,) {
	const manifest = readJSON(platformConfig.manifest,)
	const [entry,] = getContentScriptEntries(manifest,)
	if (!entry) {
		throw new Error(`${platformConfig.manifest} does not define a content script entry`,)
	}

	return {
		input: outputPathToSourcePath(entry,),
		output: {
			file: `${platformConfig.outputDir}/${entry}`,
			format: 'iife',
			// External content-script sourcemaps avoid extra web_accessible_resources entries.
			sourcemap: isDevBuild,
		},
		plugins: [
			buildDefines(),
			postcss({
				extract: path.resolve(`${platformConfig.outputDir}/data/bundled.css`,),
			},),
			...sharedScriptPlugins(`${platformConfig.outputDir}/data`,),
			...(!isDevBuild ? [terser({format: {ascii_only: true,},},),] : []),
			// Copy files not processed by Rollup over to the build directory.
			copyManifestAndStaticAssets(platformConfig,),
		],
		// framer-motion includes "use client" directives for SSR-aware bundlers.
		// Toolbox is always client-side, so those directives are irrelevant here.
		onwarn (warning, defaultHandler,) {
			if (
				warning.code === 'MODULE_LEVEL_DIRECTIVE'
				&& warning.message.includes('use client',)
			) {
				return
			}
			defaultHandler(warning,)
		},
	}
}

// Cache the `zip` availability check so we only probe the system once per build.
let zipCommandAvailable
function hasZipCommand () {
	if (zipCommandAvailable === undefined) {
		try {
			execSync('zip -v', {stdio: 'ignore',},)
			zipCommandAvailable = true
		} catch (_) {
			zipCommandAvailable = false
		}
	}
	return zipCommandAvailable
}

/**
 * Rollup plugin that archives a platform's finished build directory into a
 * `build/<name>-<platform>-<version>.zip` ready for web store upload. Only runs
 * for distributable (non-dev) builds, and degrades to a warning if the system
 * `zip` command is unavailable rather than failing the whole build.
 */
function zipBuildOutputPlugin (platformConfig, version,) {
	return {
		name: 'zip-build-output',
		// closeBundle fires after this bundle is written. Because Rollup processes
		// the config array sequentially and this plugin lives on the background
		// config (the last entry per platform), the sibling content-script config
		// has already finished copying the manifest and static assets by now.
		closeBundle () {
			if (isDevBuild) {
				return
			}
			if (!hasZipCommand()) {
				console.warn(
					`warning: \`zip\` not found on PATH; skipping archive for ${platformConfig.outputDir}.`,
					'Install zip or package the directory manually before uploading to the web store.',
				)
				return
			}
			const platformName = path.basename(platformConfig.outputDir,)
			const zipName = `toolbox-nxg-${platformName}-${version}.zip`
			const zipPath = path.resolve('build', zipName,)
			// Remove any stale archive so `zip` writes a fresh one instead of
			// updating an existing archive in place.
			fs.rmSync(zipPath, {force: true,},)
			// -r recurse into the directory, -X drop platform-specific extra file
			// attributes so the archive is cleaner and more reproducible.
			execSync(`zip -r -X "${zipPath}" .`, {
				cwd: platformConfig.outputDir,
				stdio: 'inherit',
			},)
			console.log(`created ${path.join('build', zipName,)}`,)
		},
	}
}

function backgroundConfig (platformConfig,) {
	const manifest = readJSON(platformConfig.manifest,)
	const entry = getBackgroundEntry(manifest,)

	return {
		input: outputPathToSourcePath(entry,),
		output: {
			file: `${platformConfig.outputDir}/${entry}`,
			// Chrome loads the MV3 service worker as a classic script (no
			// `"type": "module"` in the manifest) and Firefox MV2 background
			// scripts are always classic, so the bundle must not be an ES module
			// — a stray `import.meta` would be a parse-time SyntaxError.
			format: 'iife',
			sourcemap: isDevBuild ? 'inline' : false,
		},
		plugins: [
			...sharedScriptPlugins(`${platformConfig.outputDir}/data/background`,),
			zipBuildOutputPlugin(platformConfig, manifest.version,),
		],
	}
}

const selectedPlatforms = buildTarget === 'all'
	? Object.values(platforms,)
	: [platforms[buildTarget],]

export default selectedPlatforms.flatMap((platformConfig,) => [
	contentScriptConfig(platformConfig,),
	backgroundConfig(platformConfig,),
])
