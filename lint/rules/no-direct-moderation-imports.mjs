/**
 * `toolbox/no-direct-moderation-imports` — the static half of the proposals (training-mode)
 * sandbox's two guard invariants (the runtime half lives in `util/infra/captureGuard.ts`).
 *
 * UI code must not import the *mutating* moderation primitives from
 * `api/resources/things` / `api/resources/relationships` / ... directly; it must route through
 * the proposals gateway (`modules/shared/proposals/gateway`) so training and second-opinion mode
 * can capture an action instead of performing it. This rule reports a file outside the
 * ALLOWLIST that imports one of those names.
 *
 * Applies to non-test TypeScript under `extension/data/`. The ALLOWLIST exempts the gateway +
 * replay executor (the only code that should perform real actions) plus a handful of surfaces
 * that legitimately import a mutating primitive directly — see the ALLOWLIST comment for why
 * each remains.
 */

import {isTestFile, isTypeScriptSource, repoPath, specifierName,} from './paths.mjs'

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
	// Registering a native removal reason writes to the subreddit's mod log, so it is a
	// real action. It already fails closed at runtime via assertActionAllowed and rides
	// inside the removal-reason composite proposal; listing it here restores the second,
	// static guard. Only the read (getNativeRemovalReasons) is unrestricted.
	'api/resources/removalReasons': new Set([
		'applyNativeRemovalReason',
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

/**
 * Whether the rule applies to a repo-relative path.
 * @param {string} path Repo-relative POSIX path.
 * @returns {boolean} `true` for non-test, non-allowlisted TypeScript under `extension/data/`.
 */
export function isGuardedFile (path,) {
	return path.startsWith('extension/data/',) && isTypeScriptSource(path,) && !isTestFile(path,)
		&& !ALLOWLIST.has(path,)
}

/** @type {import('oxlint/plugins-dev').Rule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Route mutating moderation primitives through the proposals gateway instead of importing them.',
		},
		messages: {
			disallowed:
				'Imports `{{name}}` from `{{module}}` — route through modules/shared/proposals/gateway instead. '
				+ 'Only add to the ALLOWLIST in lint/rules/no-direct-moderation-imports.mjs with justification.',
		},
		schema: [],
	},
	create (context,) {
		if (!isGuardedFile(repoPath(context,),)) { return {} }

		const flag = (name, module, node,) => {
			context.report({node, messageId: 'disallowed', data: {name, module,},},)
		}

		return {
			// Catches every way a file could reach a restricted name from a restricted module: named
			// imports (`import {removeThing}`), namespace imports (`import * as things` — a star
			// grants access to ALL restricted names), and re-export barrels (`export {removeThing}
			// from …` / `export * from …`, which would let other files import the primitive via a
			// non-restricted path). A bare default import is ignored: these modules expose no
			// default export, so it can't reach a primitive.
			ImportDeclaration (node,) {
				const module = node.source.value
				const restricted = restrictedSetFor(module,)
				if (!restricted) { return }
				for (const specifier of node.specifiers) {
					if (specifier.type === 'ImportNamespaceSpecifier') {
						flag(`* as ${specifier.local.name}`, module, specifier,)
					} else if (specifier.type === 'ImportSpecifier') {
						const imported = specifierName(specifier.imported,)
						if (restricted.has(imported,)) { flag(imported, module, specifier,) }
					}
				}
			},
			ExportNamedDeclaration (node,) {
				if (!node.source) { return }
				const module = node.source.value
				const restricted = restrictedSetFor(module,)
				if (!restricted) { return }
				for (const specifier of node.specifiers) {
					const exported = specifierName(specifier.local,)
					if (restricted.has(exported,)) { flag(exported, module, specifier,) }
				}
			},
			// `export * from '…'` and `export * as ns from '…'` both re-export every restricted name.
			ExportAllDeclaration (node,) {
				const module = node.source.value
				if (!restrictedSetFor(module,)) { return }
				flag(
					node.exported ? `* as ${specifierName(node.exported,)} (re-export)` : '* (re-export)',
					module,
					node,
				)
			},
		}
	},
}
