/**
 * Parameter-order & naming consistency scanner.
 *
 * Walks every TypeScript source file under `extension/` (or paths passed on the
 * command line), extracts each function's parameter list with the TypeScript
 * compiler API, maps each parameter to a domain "concept", and reports three
 * classes of violation against the hand-defined convention in
 * `param-conventions.mjs`:
 *
 *   1. ORDER   — concepts appear in a different order than the convention
 *                (e.g. an `id` before a `subreddit`).
 *   2. NAMING  — a parameter uses a synonym instead of the canonical name
 *                (e.g. `sub`/`subredditName` instead of `subreddit`).
 *   3. JSDOC   — a function's `@param` tags drift from its real signature
 *                (missing, extra, or mis-ordered tags).
 *
 * This script is REPORT ONLY: it never edits source. It exits non-zero when any
 * violation is found so it can optionally gate CI later.
 *
 * Usage:
 *   node scripts/check-param-order.mjs                 # scan all of extension/
 *   node scripts/check-param-order.mjs path/to/file.ts # scan specific paths
 *
 * The compiler API is used in syntax-only mode (`ts.createSourceFile`); no type
 * checker or Program is built, since parameter names and JSDoc tags are purely
 * syntactic. That keeps the scan fast and dependency-free.
 */

import {readdirSync, readFileSync, statSync,} from 'node:fs'
import {join, relative, resolve,} from 'node:path'
import process from 'node:process'
import {fileURLToPath,} from 'node:url'
import ts from 'typescript'
import {buildConceptLookup, DATA_PRIORITY, OPTIONS_PRIORITY,} from './param-conventions.mjs'

/** Repository root (this file lives in `<root>/scripts/`). */
const ROOT = resolve(fileURLToPath(import.meta.url,), '..', '..',)

/** Default directory to scan when no paths are passed on the command line. */
const DEFAULT_SCAN_DIR = join(ROOT, 'extension',)

/** Directory names skipped entirely while walking the tree. */
const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', '.git',],)

const conceptLookup = buildConceptLookup()

/**
 * Recursively collects scannable `.ts`/`.tsx` files under a directory, skipping
 * test files, declaration files, and ignored directories.
 * @param {string} dir Absolute directory path to walk.
 * @param {string[]} out Accumulator the discovered file paths are pushed onto.
 * @returns {string[]} The same `out` array, for convenience.
 */
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
 * Reports whether a file name should be scanned. Includes `.ts`/`.tsx` source
 * but excludes test files (`*.test.ts[x]`) and declaration files (`*.d.ts`).
 * @param {string} name The bare file name.
 * @returns {boolean} `true` if the file should be parsed and checked.
 */
function isScannableFile (name,) {
	if (name.endsWith('.d.ts',)) { return false }
	if (/\.test\.tsx?$/.test(name,)) { return false }
	return name.endsWith('.ts',) || name.endsWith('.tsx',)
}

/**
 * Resolves the list of files to scan from command-line arguments, falling back
 * to the whole `extension/` tree. A path argument may be a file or a directory.
 * @param {string[]} args Raw CLI arguments (`process.argv.slice(2)`).
 * @returns {string[]} Absolute file paths to scan.
 */
function resolveTargets (args,) {
	if (args.length === 0) { return collectFiles(DEFAULT_SCAN_DIR, [],) }
	/** @type {string[]} */
	const files = []
	for (const arg of args) {
		const full = resolve(ROOT, arg,)
		const stats = statSync(full,)
		if (stats.isDirectory()) { collectFiles(full, files,) }
		else if (full.endsWith('.ts',) || full.endsWith('.tsx',)) { files.push(full,) }
	}
	return files
}

/**
 * Derives a human-readable name for a function-like node, looking at the node's
 * own name and, for arrow/function expressions, the variable or property it is
 * assigned to.
 * @param {ts.SignatureDeclaration} node The function-like node.
 * @returns {string} A best-effort function name, or `<anonymous>`.
 */
function getFunctionName (node,) {
	if (node.name && ts.isIdentifier(node.name,)) { return node.name.text }
	const parent = node.parent
	if (parent && ts.isVariableDeclaration(parent,) && ts.isIdentifier(parent.name,)) {
		return parent.name.text
	}
	if (parent && ts.isPropertyAssignment(parent,) && ts.isIdentifier(parent.name,)) {
		return parent.name.text
	}
	if (parent && ts.isPropertyDeclaration(parent,) && ts.isIdentifier(parent.name,)) {
		return parent.name.text
	}
	return '<anonymous>'
}

/**
 * Looks up the concept and ordering priority for a parameter name.
 * @param {string} name The parameter (or destructured key) name.
 * @returns {{concept: string, canonical: string, priority: number} | null}
 *   The matched concept, or `null` if the name is not a recognized concept.
 */
function classifyName (name,) {
	const hit = conceptLookup.get(name.toLowerCase(),)
	if (!hit) { return null }
	return {concept: hit.canonical, canonical: hit.canonical, priority: hit.priority,}
}

/**
 * @typedef {object} ParamInfo
 * @property {string} display How the parameter reads in the signature (its name,
 *   or `{a, b}` for a destructured object).
 * @property {number} priority Ordering priority used for the order check.
 * @property {string|null} concept Canonical concept name, or `null` if unrecognized.
 * @property {{name: string, canonical: string}[]} renames Naming violations found
 *   on this parameter (its name or, for objects, its keys) that should be renamed.
 */

/**
 * Extracts ordering/naming information for a single parameter declaration,
 * handling plain identifiers and destructured object patterns.
 * @param {ts.ParameterDeclaration} param The parameter node.
 * @returns {ParamInfo} The extracted parameter info.
 */
function describeParam (param,) {
	const name = param.name
	/** @type {{name: string, canonical: string}[]} */
	const renames = []

	// Plain identifier parameter, e.g. `subreddit: string`.
	if (ts.isIdentifier(name,)) {
		const text = name.text
		const hit = classifyName(text,)
		if (hit && text !== hit.canonical) { renames.push({name: text, canonical: hit.canonical,},) }
		return {
			display: text,
			priority: hit ? hit.priority : DATA_PRIORITY,
			concept: hit ? hit.concept : null,
			renames,
		}
	}

	// Destructured object parameter, e.g. `{postLink, subreddit}` — the options
	// object. It always sorts last for ordering, but each of its keys is still
	// checked for naming against the canonical names.
	if (ts.isObjectBindingPattern(name,)) {
		/** @type {string[]} */
		const keys = []
		for (const element of name.elements) {
			// The source-side key is `propertyName` when renamed (`{a: b}`),
			// otherwise the bound identifier (`{a}`).
			const keyNode = element.propertyName ?? element.name
			if (ts.isIdentifier(keyNode,)) {
				const key = keyNode.text
				keys.push(key,)
				const hit = classifyName(key,)
				if (hit && key !== hit.canonical) { renames.push({name: key, canonical: hit.canonical,},) }
			}
		}
		return {
			display: `{${keys.join(', ',)}}`,
			priority: OPTIONS_PRIORITY,
			concept: 'options',
			renames,
		}
	}

	// Array binding pattern or other — treat as an unrecognized data param.
	return {display: param.getText(), priority: DATA_PRIORITY, concept: null, renames,}
}

/**
 * @typedef {object} Violation
 * @property {'ORDER'|'NAMING'|'JSDOC'} kind The violation class.
 * @property {string} file Repo-relative file path.
 * @property {number} line 1-based line number of the function.
 * @property {string} fn The function name.
 * @property {string} detail Human-readable description of the problem.
 */

/**
 * Checks a function's parameters for ordering and naming violations.
 * @param {ParamInfo[]} params The described parameters, in source order.
 * @param {Violation[]} sink Array that any violations are pushed onto.
 * @param {Omit<Violation, 'kind' | 'detail'>} where File/line/function context.
 */
function checkOrderAndNaming (params, sink, where,) {
	// ORDER: only the RELATIVE order of recognized domain concepts is enforced —
	// e.g. `subreddit` before `submission`. Generic data params and the options
	// object are skipped, since the scanner is name-only and cannot tell whether a
	// leading `target`/`thing`/`node` is the DOM subject (which belongs first) or
	// an unrelated value. Comparing only recognized concepts against each other
	// matches the actual goal — consistent ordering of the domain concepts — and
	// avoids flagging where an unrecognized param merely sits before a concept.
	const concepts = params.filter((p,) => p.concept !== null && p.priority < DATA_PRIORITY)
	for (let i = 1; i < concepts.length; i++) {
		const prev = concepts[i - 1]
		const cur = concepts[i]
		if (cur.priority < prev.priority) {
			sink.push({
				...where,
				kind: 'ORDER',
				detail: `\`${cur.display}\` (${cur.concept}) appears after `
					+ `\`${prev.display}\` (${prev.concept}) but should come before it. `
					+ `Actual order: (${params.map((p,) => p.display).join(', ',)}).`,
			},)
			// Report each function's ordering once to avoid noisy cascades.
			break
		}
	}

	// NAMING: any synonym used instead of the canonical concept name.
	for (const param of params) {
		for (const rename of param.renames) {
			sink.push({
				...where,
				kind: 'NAMING',
				detail: `parameter \`${rename.name}\` should be named \`${rename.canonical}\`.`,
			},)
		}
	}
}

/**
 * Checks that a function's JSDoc `@param` tags match its real signature. Only
 * runs when at least one `@param` tag is present (the author opted into
 * documenting parameters). For all-identifier signatures it enforces matching
 * names and order; when an object pattern is present it only flags documented
 * names that do not correspond to any real parameter or key.
 * @param {ts.SignatureDeclaration} node The function-like node.
 * @param {ts.ParameterDeclaration[]} rawParams The raw parameter nodes.
 * @param {Violation[]} sink Array that any violations are pushed onto.
 * @param {Omit<Violation, 'kind' | 'detail'>} where File/line/function context.
 */
function checkJsDoc (node, rawParams, sink, where,) {
	const tags = ts.getJSDocTags(node,).filter(ts.isJSDocParameterTag,)
	if (tags.length === 0) { return }

	// The top-level name documented by a tag: `options.foo` → `options`.
	const documented = tags.map((tag,) => {
		const text = tag.name.getText()
		const dot = text.indexOf('.',)
		return {full: text, top: dot === -1 ? text : text.slice(0, dot,),}
	},)

	const hasObjectPattern = rawParams.some((p,) => !ts.isIdentifier(p.name,))

	if (!hasObjectPattern) {
		// Strict check: documented names and order must match the signature.
		const actual = rawParams
			.filter((p,) => ts.isIdentifier(p.name,))
			.map((p,) => /** @type {ts.Identifier} */ (p.name).text)
		// Collapse adjacent duplicate top-level names so a single object param
		// documented with several `@param options.foo` / `@param options.bar`
		// sub-property tags counts once (valid TSDoc), not as repeated `options`.
		const docNames = documented
			.map((d,) => d.top)
			.filter((name, i, arr,) => name !== arr[i - 1])
		const actualSet = new Set(actual,)
		const docSet = new Set(docNames,)

		const missing = actual.filter((n,) => !docSet.has(n,))
		const extra = docNames.filter((n,) => !actualSet.has(n,))
		if (missing.length || extra.length) {
			const parts = []
			if (missing.length) { parts.push(`missing @param for ${missing.map(code,).join(', ',)}`,) }
			if (extra.length) { parts.push(`@param documents unknown ${extra.map(code,).join(', ',)}`,) }
			sink.push({...where, kind: 'JSDOC', detail: `${parts.join('; ',)}.`,},)
		} else if (docNames.join(' ',) !== actual.join(' ',)) {
			sink.push({
				...where,
				kind: 'JSDOC',
				detail: `@param order (${docNames.join(', ',)}) does not match `
					+ `signature order (${actual.join(', ',)}).`,
			},)
		}
		return
	}

	// Object-pattern signatures: only flag DOTTED documented names (`options.foo`)
	// whose object (`options`) is not a real param/key — those clearly intend to
	// name a specific destructured key and get it wrong. A bare name that matches
	// nothing is allowed: it documents the destructured bag as a whole (e.g. a
	// single `@param settings` for a `({a, b}: Settings)` parameter).
	const validNames = new Set()
	for (const param of rawParams) {
		if (ts.isIdentifier(param.name,)) {
			validNames.add(param.name.text,)
		} else if (ts.isObjectBindingPattern(param.name,)) {
			for (const element of param.name.elements) {
				const keyNode = element.propertyName ?? element.name
				if (ts.isIdentifier(keyNode,)) { validNames.add(keyNode.text,) }
			}
		}
	}
	const stale = documented.filter((d,) =>
		d.full.includes('.',) && !validNames.has(d.top,) && !validNames.has(d.full,)
	)
	if (stale.length) {
		sink.push({
			...where,
			kind: 'JSDOC',
			detail: `@param documents unknown ${stale.map((d,) => code(d.full,)).join(', ',)}.`,
		},)
	}
}

/**
 * Wraps a value in backticks for report output.
 * @param {string} value The text to wrap.
 * @returns {string} The backtick-wrapped value.
 */
function code (value,) {
	return `\`${value}\``
}

/**
 * Parses one source file and collects all parameter violations within it.
 * @param {string} filePath Absolute path to the source file.
 * @returns {Violation[]} Violations found in the file.
 */
function scanFile (filePath,) {
	const text = readFileSync(filePath, 'utf8',)
	const scriptKind = filePath.endsWith('.tsx',) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
	const sourceFile = ts.createSourceFile(
		filePath,
		text,
		ts.ScriptTarget.Latest,
		/* setParentNodes */ true,
		scriptKind,
	)
	const relPath = relative(ROOT, filePath,)
	/** @type {Violation[]} */
	const violations = []

	/**
	 * Recursively visits the AST, processing every function-like declaration.
	 * @param {ts.Node} node The current node.
	 */
	function visit (node,) {
		if (
			ts.isFunctionDeclaration(node,)
			|| ts.isFunctionExpression(node,)
			|| ts.isArrowFunction(node,)
			|| ts.isMethodDeclaration(node,)
		) {
			const rawParams = Array.from(node.parameters,)
			// Skip `this` parameters, which are type-only and not real arguments.
			const realParams = rawParams.filter(
				(p,) => !(ts.isIdentifier(p.name,) && p.name.text === 'this'),
			)
			if (realParams.length > 0) {
				const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile,),).line + 1
				const where = {file: relPath, line, fn: getFunctionName(node,),}
				const described = realParams.map(describeParam,)
				checkOrderAndNaming(described, violations, where,)
				checkJsDoc(node, realParams, violations, where,)
			}
		}
		ts.forEachChild(node, visit,)
	}

	visit(sourceFile,)
	return violations
}

/**
 * Prints the collected violations grouped by file, followed by a summary, then
 * returns the total count.
 * @param {Violation[]} all Every violation across the scan.
 * @returns {number} The total number of violations.
 */
function report (all,) {
	/** @type {Map<string, Violation[]>} */
	const byFile = new Map()
	for (const v of all) {
		const list = byFile.get(v.file,) ?? []
		list.push(v,)
		byFile.set(v.file, list,)
	}

	const files = [...byFile.keys(),].sort()
	for (const file of files) {
		console.log(`\n${file}`,)
		const list = byFile.get(file,)
		list.sort((a, b,) => a.line - b.line)
		for (const v of list) {
			console.log(`  ${String(v.line,).padStart(5,)}  [${v.kind.padEnd(6,)}] ${v.fn}: ${v.detail}`,)
		}
	}

	/** @type {Record<string, number>} */
	const counts = {ORDER: 0, NAMING: 0, JSDOC: 0,}
	for (const v of all) { counts[v.kind]++ }
	console.log(
		`\nSummary: ${all.length} violation(s) — `
			+ `${counts.ORDER} order, ${counts.NAMING} naming, ${counts.JSDOC} jsdoc, `
			+ `across ${files.length} file(s).`,
	)
	return all.length
}

/** Entry point: scan the resolved targets and report, exiting non-zero on any violation. */
function main () {
	const targets = resolveTargets(process.argv.slice(2,),)
	/** @type {Violation[]} */
	const all = []
	for (const file of targets) {
		all.push(...scanFile(file,),)
	}
	const total = report(all,)
	if (total === 0) { console.log('\nNo parameter-order or naming inconsistencies found.',) }
	process.exit(total === 0 ? 0 : 1,)
}

main()
