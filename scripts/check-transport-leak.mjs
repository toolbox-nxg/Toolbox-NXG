/**
 * Listing-envelope leak scanner — keeps the Reddit REST pagination envelope inside
 * the API layer.
 *
 * Reddit's `.json` listing endpoints wrap results in `{kind: 'Listing', data:
 * {children, after, before}}`. That envelope is a transport detail: `after` is a REST
 * cursor with no equivalent in a cursor-connection API. Feature code consumes the
 * transport-neutral `Page<T>` from `api/transport/pagination` instead, so paging lives
 * in one place rather than being re-derived at every call site.
 *
 * Two rules, both scoped to code outside `extension/data/api/`:
 *   1. No importing `RedditListing` — resource modules return `Page<T>`.
 *   2. No `.data.after` / `.data.before` access — those are pagination-only.
 *
 * `.data.children` is deliberately NOT flagged. Reddit's comment tree nests Listings
 * recursively (`RedditThing.replies`, and `more.data.children` which is an array of
 * comment ids), so `children` access is legitimate tree traversal in comment code. The
 * two rules above have no such overlap and therefore no false positives.
 *
 * The project's ESLint config doesn't parse TypeScript, so this is a standalone script
 * (mirroring `check-moderation-imports.mjs`) wired in as part of `npm run lint:guard`.
 * REPORT ONLY — it never edits source; exits non-zero on any violation.
 *
 * Usage:
 *   node scripts/check-transport-leak.mjs                 # scan extension/data
 *   node scripts/check-transport-leak.mjs path/to/file.ts # scan specific paths
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
 * Path prefix that owns the envelope. Files under it may name `RedditListing` and unwrap
 * `data.after`; that is precisely their job.
 */
const API_LAYER = join('extension', 'data', 'api',)

/** The envelope type that must not escape the API layer. */
const RESTRICTED_TYPE = 'RedditListing'

/** Envelope cursor fields that are pagination-only, and so never legitimate outside the API layer. */
const RESTRICTED_FIELDS = new Set(['after', 'before',],)

/** Whether a file should be scanned (TypeScript sources, excluding declaration files). */
function isScannableFile (path,) {
	return (path.endsWith('.ts',) || path.endsWith('.tsx',)) && !path.endsWith('.d.ts',)
}

/** Recursively collects scannable files under `dir` into `out`. */
function collectFiles (dir, out,) {
	for (const entry of readdirSync(dir, {withFileTypes: true,},)) {
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name,)) { continue }
			collectFiles(join(dir, entry.name,), out,)
		} else if (isScannableFile(entry.name,)) {
			out.push(join(dir, entry.name,),)
		}
	}
}

/** Whether `file` lives inside the API layer, which owns the envelope. */
function isApiLayer (file,) {
	return relative(ROOT, file,).split('\\',).join('/',).startsWith(API_LAYER.split('\\',).join('/',),)
}

/**
 * Scans one file for envelope leaks.
 * @param file Absolute path to a TypeScript source file.
 * @returns Violations, each with a 1-based `line` and a human-readable `detail`.
 */
function scanFile (file,) {
	const source = ts.createSourceFile(
		file,
		readFileSync(file, 'utf8',),
		ts.ScriptTarget.Latest,
		true,
		file.endsWith('.tsx',) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	)
	const violations = []

	/** Records a violation at `node`'s position. */
	const flag = (detail, node,) => {
		const {line,} = source.getLineAndCharacterOfPosition(node.getStart(source,),)
		violations.push({line: line + 1, detail,},)
	}

	// Rule 1: importing the envelope type.
	for (const statement of source.statements) {
		if (!ts.isImportDeclaration(statement,) || !statement.importClause?.namedBindings) { continue }
		const bindings = statement.importClause.namedBindings
		if (!ts.isNamedImports(bindings,)) { continue }
		for (const element of bindings.elements) {
			const imported = (element.propertyName ?? element.name).text
			if (imported === RESTRICTED_TYPE) {
				flag(
					`imports \`${RESTRICTED_TYPE}\` — resource modules return \`Page<T>\`; `
						+ 'import that from api/transport/pagination instead.',
					element,
				)
			}
		}
	}

	// Rule 2: reading the envelope's pagination cursors.
	const visit = (node,) => {
		if (
			ts.isPropertyAccessExpression(node,) && RESTRICTED_FIELDS.has(node.name.text,)
			&& ts.isPropertyAccessExpression(node.expression,) && node.expression.name.text === 'data'
		) {
			flag(
				`reads \`.data.${node.name.text}\` — that is the REST listing cursor; `
					+ 'use `Page.cursor` from api/transport/pagination instead.',
				node,
			)
		}
		ts.forEachChild(node, visit,)
	}
	visit(source,)

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
		if (isApiLayer(file,)) { continue }
		const violations = scanFile(file,)
		if (!violations.length) { continue }
		const rel = relative(ROOT, file,).split('\\',).join('/',)
		console.error(`\n${rel}`,)
		for (const v of violations) {
			console.error(`  ${String(v.line,).padStart(4,)}  ${v.detail}`,)
			total++
		}
	}

	if (total) {
		console.error(
			`\n${total} listing-envelope leak(s) outside the API layer. Have the resource `
				+ 'module return `Page<T>` (see api/transport/pagination) and consume '
				+ '`.items` / `.cursor` instead of the raw envelope.',
		)
		process.exit(1,)
	}
	console.log('check-transport-leak: no listing-envelope leaks outside the API layer.',)
}

main()
