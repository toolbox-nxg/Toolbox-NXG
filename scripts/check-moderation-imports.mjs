/**
 * Moderation-primitive reachability scanner — the static half of the proposals
 * (training-mode) sandbox's two guard invariants (the runtime half lives in
 * `util/infra/captureGuard.ts`).
 *
 * UI code must not import the *mutating* moderation primitives from
 * `api/resources/things` / `api/resources/relationships` directly; it must route
 * through the proposals gateway (`modules/shared/proposals/gateway`) so training
 * and second-opinion mode can capture an action instead of performing it. This
 * scanner fails when a file outside the allowlist imports one of those names.
 *
 * The project's ESLint config doesn't parse TypeScript, so this is a standalone
 * script (mirroring `check-param-order.mjs`) wired in as `npm run lint:guard`.
 * REPORT ONLY — it never edits source; exits non-zero on any violation.
 *
 * The ALLOWLIST exempts the gateway + replay executor (the only code that should
 * perform real actions) plus a handful of surfaces that legitimately import a
 * mutating primitive directly — see the ALLOWLIST comment below for why each remains.
 *
 * Usage:
 *   node scripts/check-moderation-imports.mjs                 # scan extension/data
 *   node scripts/check-moderation-imports.mjs path/to/file.ts # scan specific paths
 */

import {readdirSync, readFileSync, statSync,} from 'node:fs'
import {join, relative, resolve,} from 'node:path'
import process from 'node:process'
import {fileURLToPath,} from 'node:url'
import ts from 'typescript'

/** Repository root (this file lives in `<root>/scripts/`). */
const ROOT = resolve(fileURLToPath(import.meta.url,), '..', '..',)

/** Default directory scanned when no paths are passed on the command line. */
const DEFAULT_SCAN_DIR = join(ROOT, 'extension', 'data',)

/** Directory names skipped while walking the tree. */
const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', '.git',],)

/**
 * Module specifier suffix → the restricted (mutating) export names it owns.
 *
 * All of these are guarded by the runtime capture guard. Most are *captured* as a
 * reviewable proposal via the gateway: approve/remove/lock/unlock/distinguish + ban/mute
 * + removal-reason, plus NSFW (markOver18/unMarkOver18), sticky (stickyThread/unstickyThread),
 * and user flair (flairUser). The rest only BLOCK a trainee (fail-closed) — post flair
 * (flairPost), ignoreReports, and contributor/moderator management
 * (addContributor/removeContributor/addModerator/removeModerator) produce no proposal, and
 * allowlisted call sites may import them directly.
 */
const RESTRICTED = {
	'api/resources/things': new Set([
		'approveThing',
		'removeThing',
		'distinguishThing',
		'lock',
		'unlock',
		'stickyThread',
		'unstickyThread',
		'markOver18',
		'unMarkOver18',
		'ignoreReports',
		'sendOfficialRemovalMessage',
	],),
	'api/resources/relationships': new Set([
		'banUser',
		'unbanUser',
		'muteUser',
		'unmuteUser',
		'addContributor',
		'removeContributor',
		'addModerator',
		'removeModerator',
	],),
	'api/resources/flair': new Set([
		'flairPost',
		'flairUser',
	],),
}

/**
 * Repo-relative POSIX paths permitted to import the mutating primitives directly.
 */
const ALLOWLIST = new Set([
	// Gateway + replay executor — the only code that should perform real actions.
	'extension/data/modules/shared/proposals/gateway.ts',
	'extension/data/modules/removalreasons/features/submitRemoval.ts',
	// Bulk tools (refused wholesale in training mode) and surfaces that only use
	// block-only primitives (post flair, ignoreReports, contributor/moderator):
	// removalreasons/dom.tsx + RemovalReasonsOverlay.tsx are MIGRATED (route through
	// the gateway) and intentionally removed from this list.
	'extension/data/modules/macros/dom.ts',
	'extension/data/modules/massmoderation/oldReddit/queueModtools.tsx',
	'extension/data/modules/modbutton/components/ModButtonUserRoot.tsx',
	'extension/data/modules/modbutton/components/ModButtonPopup.tsx',
	'extension/data/modules/nukecomments/components/NukeCommentsPopup.tsx',
	'extension/data/modules/profile/components/BulkRemovePanel.helpers.ts',
	// betterbuttons/features/commentLock.tsx + stickyButtons.tsx are MIGRATED (sticky/unsticky
	// now route through the gateway), as is redditElementsInit (NSFW toggles route through the
	// gateway too) — all intentionally removed from this list.
	// usernotes ban-on-note (dom.tsx + AddUserNotePopup.tsx) is MIGRATED to the gateway.
],)

/** Returns the restricted export set for an import specifier, or undefined. */
function restrictedSetFor (specifier,) {
	// Strip a trailing extension (e.g. `.ts`) before matching the suffix.
	const cleaned = specifier.replace(/\.(ts|tsx|js|jsx)$/, '',)
	for (const [suffix, names,] of Object.entries(RESTRICTED,)) {
		if (cleaned.endsWith(suffix,)) { return names }
	}
	return undefined
}

/** True for `.ts`/`.tsx` files that should be scanned (skips tests + decls). */
function isScannableFile (name,) {
	if (name.endsWith('.d.ts',)) { return false }
	if (name.endsWith('.test.ts',) || name.endsWith('.test.tsx',)) { return false }
	return name.endsWith('.ts',) || name.endsWith('.tsx',)
}

/** Recursively collects scannable files under `dir` into `out`. */
function collectFiles (dir, out,) {
	for (const entry of readdirSync(dir,)) {
		const full = join(dir, entry,)
		const stats = statSync(full,)
		if (stats.isDirectory()) {
			if (!SKIP_DIRS.has(entry,)) { collectFiles(full, out,) }
		} else if (isScannableFile(entry,)) {
			out.push(full,)
		}
	}
	return out
}

/**
 * Scans one file for disallowed imports of mutating moderation primitives.
 *
 * Catches every way a file could reach a restricted name from a restricted module:
 * named imports (`import {removeThing}`), namespace imports (`import * as things` —
 * a star grants access to ALL restricted names), and re-export barrels
 * (`export {removeThing} from …` / `export * from …`, which would let other files
 * import the primitive via a non-restricted path). A bare default import is ignored:
 * these modules expose no default export, so it can't reach a primitive.
 * @param {string} file Absolute path to scan.
 * @returns {Array<{name: string, module: string, line: number}>} violations.
 */
function scanFile (file,) {
	const rel = relative(ROOT, file,).split('\\',).join('/',)
	if (ALLOWLIST.has(rel,)) { return [] }

	const source = ts.createSourceFile(
		file,
		readFileSync(file, 'utf8',),
		ts.ScriptTarget.Latest,
		true,
		file.endsWith('.tsx',) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	)

	const violations = []
	/** Records a violation for `name` reached from `moduleText` at `node`'s line. */
	function flag (name, moduleText, node,) {
		const {line,} = source.getLineAndCharacterOfPosition(node.getStart(source,),)
		violations.push({name, module: moduleText, line: line + 1,},)
	}

	for (const statement of source.statements) {
		// `import … from 'restricted'`
		if (ts.isImportDeclaration(statement,) && ts.isStringLiteral(statement.moduleSpecifier,)) {
			const restricted = restrictedSetFor(statement.moduleSpecifier.text,)
			if (!restricted) { continue }
			const moduleText = statement.moduleSpecifier.text
			const bindings = statement.importClause?.namedBindings
			if (bindings && ts.isNamespaceImport(bindings,)) {
				// `import * as ns from '…'` aliases every restricted name through `ns`.
				flag(`* as ${bindings.name.text}`, moduleText, bindings,)
			} else if (bindings && ts.isNamedImports(bindings,)) {
				for (const element of bindings.elements) {
					// `propertyName` is the imported (original) name when aliased.
					const imported = (element.propertyName ?? element.name).text
					if (restricted.has(imported,)) { flag(imported, moduleText, element,) }
				}
			}
			continue
		}
		// `export … from 'restricted'` — a re-export barrel that would launder the
		// primitive through this file's (non-restricted) path.
		if (
			ts.isExportDeclaration(statement,) && statement.moduleSpecifier
			&& ts.isStringLiteral(statement.moduleSpecifier,)
		) {
			const restricted = restrictedSetFor(statement.moduleSpecifier.text,)
			if (!restricted) { continue }
			const moduleText = statement.moduleSpecifier.text
			if (!statement.exportClause) {
				// `export * from '…'` re-exports every restricted name.
				flag('* (re-export)', moduleText, statement,)
			} else if (ts.isNamedExports(statement.exportClause,)) {
				for (const element of statement.exportClause.elements) {
					const exported = (element.propertyName ?? element.name).text
					if (restricted.has(exported,)) { flag(exported, moduleText, element,) }
				}
			}
		}
	}
	return violations
}

function main () {
	const args = process.argv.slice(2,)
	const targets = args.length ? args.map((p,) => resolve(p,)) : [DEFAULT_SCAN_DIR,]

	const files = []
	for (const target of targets) {
		const stats = statSync(target,)
		if (stats.isDirectory()) {
			collectFiles(target, files,)
		} else if (isScannableFile(target,)) {
			files.push(target,)
		}
	}

	let total = 0
	for (const file of files) {
		const violations = scanFile(file,)
		if (!violations.length) { continue }
		const rel = relative(ROOT, file,).split('\\',).join('/',)
		console.error(`\n${rel}`,)
		for (const v of violations) {
			console.error(
				`  ${String(v.line,).padStart(4,)}  imports \`${v.name}\` from \`${v.module}\` — `
					+ 'route through modules/shared/proposals/gateway instead.',
			)
			total++
		}
	}

	if (total) {
		console.error(
			`\n${total} disallowed moderation-primitive import(s). If a new surface must `
				+ 'perform actions, route it through the proposals gateway; only add to the '
				+ 'ALLOWLIST in scripts/check-moderation-imports.mjs with justification.',
		)
		process.exit(1,)
	}
	console.log('check-moderation-imports: no disallowed moderation-primitive imports.',)
}

main()
