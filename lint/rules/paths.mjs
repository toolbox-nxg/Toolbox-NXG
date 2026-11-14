/** Path helpers shared by the toolbox lint rules. */

import {relative, resolve,} from 'node:path'
import {fileURLToPath,} from 'node:url'

/** Repository root (this file lives in `<root>/lint/rules/`). */
export const ROOT = resolve(fileURLToPath(import.meta.url,), '..', '..', '..',)

/**
 * The linted file's path relative to the repository root, with POSIX separators, so rules can
 * scope themselves by directory regardless of where the linter was started.
 * @param {{filename: string}} context The rule context.
 * @returns {string} e.g. `extension/data/modules/foo/dom.ts`.
 */
export function repoPath (context,) {
	return relative(ROOT, context.filename,).split('\\',).join('/',)
}

/**
 * Whether a repo-relative path is TypeScript source: `.ts`/`.tsx`, excluding declaration files.
 * @param {string} path Repo-relative path.
 * @returns {boolean} `true` for `.ts`/`.tsx` files that are not `.d.ts`.
 */
export function isTypeScriptSource (path,) {
	return /\.tsx?$/.test(path,) && !path.endsWith('.d.ts',)
}

/**
 * Whether a repo-relative path is a test file (`*.test.ts` / `*.test.tsx`).
 * @param {string} path Repo-relative path.
 * @returns {boolean} `true` for test files.
 */
export function isTestFile (path,) {
	return /\.test\.tsx?$/.test(path,)
}

/**
 * The text of an import/export specifier's name, which is an identifier or (for
 * `import {'a-b' as c}`) a string literal.
 * @param {{type: string, name?: string, value?: unknown}} node Identifier or Literal.
 * @returns {string} The name.
 */
export function specifierName (node,) {
	return node.type === 'Identifier' ? node.name : String(node.value,)
}
