/**
 * `toolbox/param-conventions` — parameter order & naming consistency.
 *
 * Maps each function parameter to a domain "concept" and reports three classes of violation
 * against the hand-defined convention in `lint/param-conventions.mjs`:
 *
 *   1. ORDER   — concepts appear in a different order than the convention
 *                (e.g. an `id` before a `subreddit`).
 *   2. NAMING  — a parameter uses a synonym instead of the canonical name
 *                (e.g. `sub` instead of `subreddit`).
 *   3. JSDOC   — a function's `@param` tags drift from its real signature
 *                (missing, extra, or mis-ordered tags).
 *
 * Applies to non-test TypeScript under `extension/`. Everything here is syntactic: parameter
 * names and JSDoc tags need no type information. Which JSDoc block belongs to a function follows
 * TypeScript's own attachment rules (`ts.getJSDocTags`), which this rule replaced.
 */

import {buildConceptLookup, DATA_PRIORITY, OPTIONS_PRIORITY,} from '../param-conventions.mjs'
import {isTestFile, isTypeScriptSource, repoPath,} from './paths.mjs'

const conceptLookup = buildConceptLookup()

/**
 * Whether the rule applies to a repo-relative path.
 * @param {string} path Repo-relative POSIX path.
 * @returns {boolean} `true` for non-test TypeScript under `extension/`.
 */
export function isCheckedFile (path,) {
	return path.startsWith('extension/',) && isTypeScriptSource(path,) && !isTestFile(path,)
}

/** Method-like parents whose function value is a method body. */
const METHOD_PARENTS = new Set(['MethodDefinition', 'TSAbstractMethodDefinition',],)

/**
 * The method node a function is the body of (class or object-literal method); `undefined` for a
 * constructor or accessor body, which the rule skips (TypeScript's `isMethodDeclaration` excludes
 * them); `null` for anything else, including a `foo: function () {}` property, which is a plain
 * function expression.
 */
function methodOf (fn,) {
	const parent = fn.parent
	if (METHOD_PARENTS.has(parent?.type,) && parent.value === fn) {
		return parent.kind === 'method' ? parent : undefined
	}
	if (parent?.type === 'Property' && parent.value === fn) {
		if (parent.kind === 'get' || parent.kind === 'set') { return undefined }
		if (parent.method) { return parent }
	}
	return null
}

/** The node TypeScript would report the function at: its export wrapper or method, else itself. */
function reportNodeFor (fn,) {
	const method = methodOf(fn,)
	if (method) { return method }
	const parent = fn.parent
	if (parent?.type === 'ExportNamedDeclaration' || parent?.type === 'ExportDefaultDeclaration') { return parent }
	return fn
}

/** Whether a key node is a plain (non-computed) identifier key. */
function identifierKey (key, computed,) {
	return !computed && key?.type === 'Identifier' ? key.name : null
}

/**
 * Derives a human-readable name for a function: its own name, or the name of the method,
 * variable, property, or class field it is assigned to.
 * @returns {string} A best-effort function name, or `<anonymous>`.
 */
function getFunctionName (fn,) {
	if (fn.id?.type === 'Identifier') { return fn.id.name }
	const method = methodOf(fn,)
	if (method) { return identifierKey(method.key, method.computed,) ?? '<anonymous>' }
	const parent = fn.parent
	if (parent?.type === 'VariableDeclarator' && parent.init === fn && parent.id.type === 'Identifier') {
		return parent.id.name
	}
	if ((parent?.type === 'Property' || parent?.type === 'PropertyDefinition') && parent.value === fn) {
		return identifierKey(parent.key, parent.computed,) ?? '<anonymous>'
	}
	return '<anonymous>'
}

/** Looks up the concept and ordering priority for a parameter name. */
function classifyName (name,) {
	const hit = conceptLookup.get(name.toLowerCase(),)
	if (!hit) { return null }
	return {concept: hit.canonical, canonical: hit.canonical, priority: hit.priority,}
}

/** The binding a parameter declares, without its default value or rest marker. */
function bindingOf (param,) {
	if (param.type === 'AssignmentPattern') { return param.left }
	if (param.type === 'RestElement') { return param.argument }
	return param
}

/**
 * The source-side keys of an object binding pattern: the property key when renamed
 * (`{a: b}` → `a`), otherwise the bound name; a rest element contributes its name.
 * Computed and string-literal keys are skipped.
 */
function objectPatternKeys (pattern,) {
	const keys = []
	for (const property of pattern.properties) {
		if (property.type === 'RestElement') {
			if (property.argument.type === 'Identifier') { keys.push(property.argument.name,) }
		} else {
			const key = identifierKey(property.key, property.computed,)
			if (key !== null) { keys.push(key,) }
		}
	}
	return keys
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
 * Extracts ordering/naming information for a single parameter, handling plain identifiers
 * and destructured object patterns.
 * @returns {ParamInfo} The extracted parameter info.
 */
function describeParam (param, sourceCode,) {
	const binding = bindingOf(param,)
	/** @type {{name: string, canonical: string}[]} */
	const renames = []

	// Plain identifier parameter, e.g. `subreddit: string`.
	if (binding.type === 'Identifier') {
		const text = binding.name
		const hit = classifyName(text,)
		if (hit && text !== hit.canonical) { renames.push({name: text, canonical: hit.canonical,},) }
		return {
			display: text,
			priority: hit ? hit.priority : DATA_PRIORITY,
			concept: hit ? hit.concept : null,
			renames,
		}
	}

	// Destructured object parameter, e.g. `{postLink, subreddit}` — the options object. It always
	// sorts last for ordering, but each of its keys is still checked against the canonical names.
	if (binding.type === 'ObjectPattern') {
		const keys = objectPatternKeys(binding,)
		for (const key of keys) {
			const hit = classifyName(key,)
			if (hit && key !== hit.canonical) { renames.push({name: key, canonical: hit.canonical,},) }
		}
		return {
			display: `{${keys.join(', ',)}}`,
			priority: OPTIONS_PRIORITY,
			concept: 'options',
			renames,
		}
	}

	// Array binding pattern or other — treat as an unrecognized data param.
	return {display: sourceCode.getText(param,), priority: DATA_PRIORITY, concept: null, renames,}
}

/**
 * Checks a function's parameters for ordering and naming violations.
 * @param {ParamInfo[]} params The described parameters, in source order.
 * @returns {{kind: string, detail: string}[]} Violations found.
 */
function checkOrderAndNaming (params,) {
	const violations = []
	// ORDER: only the RELATIVE order of recognized domain concepts is enforced —
	// e.g. `subreddit` before `submission`. Generic data params and the options
	// object are skipped, since the rule is name-only and cannot tell whether a
	// leading `target`/`thing`/`node` is the DOM subject (which belongs first) or
	// an unrelated value. Comparing only recognized concepts against each other
	// matches the actual goal — consistent ordering of the domain concepts — and
	// avoids flagging where an unrecognized param merely sits before a concept.
	const concepts = params.filter((p,) => p.concept !== null && p.priority < DATA_PRIORITY)
	for (let i = 1; i < concepts.length; i++) {
		const prev = concepts[i - 1]
		const cur = concepts[i]
		if (cur.priority < prev.priority) {
			violations.push({
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
			violations.push({
				kind: 'NAMING',
				detail: `parameter \`${rename.name}\` should be named \`${rename.canonical}\`.`,
			},)
		}
	}
	return violations
}

/**
 * The nodes whose leading JSDoc belongs to a function, nearest first — mirroring TypeScript's
 * `getJSDocCommentsAndTags`: a declaration or method owns the JSDoc before it (or before its
 * `export`); a function expression or arrow owns the JSDoc directly before it, then that of the
 * property, class field, `export default`, `return`, assignment statement, or single-variable
 * declaration it is the value of.
 */
function jsDocHosts (fn,) {
	if (fn.type === 'FunctionDeclaration' || fn.type === 'TSDeclareFunction') { return [reportNodeFor(fn,),] }
	const method = methodOf(fn,)
	if (method !== null) { return method ? [method,] : [] }

	const hosts = [fn,]
	let node = fn
	while (node.parent) {
		const parent = node.parent
		if (
			((parent.type === 'Property' || parent.type === 'PropertyDefinition') && parent.value === node)
			|| parent.type === 'ExportDefaultDeclaration' || parent.type === 'ReturnStatement'
		) {
			node = parent
		} else if (parent.type === 'AssignmentExpression' && parent.parent) {
			node = parent.parent
		} else if (
			parent.type === 'VariableDeclarator' && parent.init === node
			&& parent.parent.type === 'VariableDeclaration' && parent.parent.declarations.length === 1
		) {
			const declaration = parent.parent
			node = declaration.parent?.type === 'ExportNamedDeclaration' ? declaration.parent : declaration
		} else {
			break
		}
		hosts.push(node,)
	}
	return hosts
}

/**
 * The `@param` names of a JSDoc block's text, in order (`@arg` and `@argument` are aliases), parsed
 * the way TypeScript does: a tag starts at an `@` that begins a line or follows whitespace (so
 * `foo@param` and `(@param` are prose), except inside an inline tag such as `{@link …}`. A leading
 * `{type}` and the `[name=default]` optional form are skipped, leaving the documented name
 * (e.g. `options.foo`).
 * @param {string} value The comment's text between the delimiters.
 * @returns {string[]} Documented names.
 */
export function parseParamTags (value,) {
	const text = value
		.slice(1,) // The `*` of the opening `/**`.
		.split(/\r?\n/,)
		.map((line, i,) => i === 0 ? line : line.replace(/^\s*\*?/, '',))
		.join('\n',)
		// Blank out inline tags so a `@param` inside `{@link …}` is not read as a tag.
		.replace(/\{@[^}]*\}/g, (inline,) => ' '.repeat(inline.length,),)
	const names = []
	for (const tag of text.matchAll(/(?<=^|\s)@(?:param|arg|argument)\b/gm,)) {
		const rest = skipTypeExpression(text.slice(tag.index + tag[0].length,).replace(/^[ \t]*/, '',),)
		const name = /^[ \t]*\[?[ \t]*([\p{L}\p{N}_$.[\]]*[\p{L}\p{N}_$])/u.exec(rest,)
		names.push(name ? name[1].replace(/\[\]/g, '',) : '',)
	}
	return names
}

/** Drops a leading balanced `{…}` type expression from `text`, if present. */
function skipTypeExpression (text,) {
	if (!text.startsWith('{',)) { return text }
	let depth = 0
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '{') { depth++ }
		else if (text[i] === '}' && --depth === 0) { return text.slice(i + 1,) }
	}
	return text
}

/**
 * The `@param` names documented for a function, nearest host first. Only the last JSDoc block
 * before each host counts, as in TypeScript.
 */
function documentedParams (fn, sourceCode,) {
	const names = []
	for (const host of jsDocHosts(fn,)) {
		const jsDoc = sourceCode.getCommentsBefore(host,).filter((c,) => c.type === 'Block' && c.value.startsWith('*',))
			.at(-1,)
		if (jsDoc) { names.push(...parseParamTags(jsDoc.value,),) }
	}
	return names
}

/**
 * Checks that a function's JSDoc `@param` tags match its real signature. Only runs when at least
 * one `@param` tag is present (the author opted into documenting parameters). For all-identifier
 * signatures it enforces matching names and order; when an object pattern is present it only
 * flags documented names that do not correspond to any real parameter or key.
 * @param {string[]} documentedNames Documented `@param` names, in order.
 * @param {object[]} params The function's real parameters (excluding `this`).
 * @returns {{kind: string, detail: string}[]} Violations found.
 */
function checkJsDoc (documentedNames, params,) {
	if (documentedNames.length === 0) { return [] }

	// The top-level name documented by a tag: `options.foo` → `options`.
	const documented = documentedNames.map((text,) => {
		const dot = text.indexOf('.',)
		return {full: text, top: dot === -1 ? text : text.slice(0, dot,),}
	},)
	const bindings = params.map(bindingOf,)
	const hasObjectPattern = bindings.some((b,) => b.type !== 'Identifier')

	if (!hasObjectPattern) {
		// Strict check: documented names and order must match the signature.
		const actual = bindings.map((b,) => b.name)
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
			return [{kind: 'JSDOC', detail: `${parts.join('; ',)}.`,},]
		}
		if (docNames.join(' ',) !== actual.join(' ',)) {
			return [{
				kind: 'JSDOC',
				detail: `@param order (${docNames.join(', ',)}) does not match signature order (${
					actual.join(', ',)
				}).`,
			},]
		}
		return []
	}

	// Object-pattern signatures: only flag DOTTED documented names (`options.foo`)
	// whose object (`options`) is not a real param/key — those clearly intend to
	// name a specific destructured key and get it wrong. A bare name that matches
	// nothing is allowed: it documents the destructured bag as a whole (e.g. a
	// single `@param settings` for a `({a, b}: Settings)` parameter).
	const validNames = new Set()
	for (const binding of bindings) {
		if (binding.type === 'Identifier') {
			validNames.add(binding.name,)
		} else if (binding.type === 'ObjectPattern') {
			for (const key of objectPatternKeys(binding,)) { validNames.add(key,) }
		}
	}
	const stale = documented.filter((d,) =>
		d.full.includes('.',) && !validNames.has(d.top,) && !validNames.has(d.full,)
	)
	if (stale.length) {
		return [{kind: 'JSDOC', detail: `@param documents unknown ${stale.map((d,) => code(d.full,)).join(', ',)}.`,},]
	}
	return []
}

/** Wraps a value in backticks for report output. */
function code (value,) {
	return `\`${value}\``
}

/**
 * Everything the rule derives about one function, or null when it has no parameters to check
 * (accessors, constructors, and parameterless functions). Exported for parity testing.
 * @returns {{node: object, name: string, params: ParamInfo[], documented: string[],
 *   violations: {kind: string, detail: string}[]} | null}
 */
export function analyzeFunction (fn, sourceCode,) {
	if (methodOf(fn,) === undefined) { return null }
	// Skip `this` parameters, which are type-only and not real arguments.
	const params = fn.params.filter((p,) => !(p.type === 'Identifier' && p.name === 'this'))
	if (params.length === 0) { return null }
	const described = params.map((p,) => describeParam(p, sourceCode,))
	const documented = documentedParams(fn, sourceCode,)
	return {
		node: reportNodeFor(fn,),
		name: getFunctionName(fn,),
		params: described,
		documented,
		violations: [...checkOrderAndNaming(described,), ...checkJsDoc(documented, params,),],
	}
}

/** Function-like nodes the rule inspects (TypeScript's function/arrow/method declarations). */
export const FUNCTION_NODE_TYPES = [
	'FunctionDeclaration',
	'FunctionExpression',
	'ArrowFunctionExpression',
	'TSDeclareFunction',
	'TSEmptyBodyFunctionExpression',
]

/** @type {import('oxlint/plugins-dev').Rule} */
export default {
	meta: {
		type: 'suggestion',
		docs: {
			description: 'Enforce the canonical parameter order, parameter names, and matching JSDoc `@param` tags.',
		},
		messages: {
			violation: '[{{kind}}] {{fn}}: {{detail}}',
		},
		schema: [],
	},
	create (context,) {
		if (!isCheckedFile(repoPath(context,),)) { return {} }

		const check = (fn,) => {
			const result = analyzeFunction(fn, context.sourceCode,)
			if (!result) { return }
			for (const violation of result.violations) {
				context.report({node: result.node, messageId: 'violation', data: {...violation, fn: result.name,},},)
			}
		}
		return Object.fromEntries(FUNCTION_NODE_TYPES.map((type,) => [type, check,]),)
	},
}
