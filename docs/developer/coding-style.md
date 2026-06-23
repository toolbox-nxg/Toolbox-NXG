# Coding Style Guide

This document describes the coding conventions for the Reddit Moderator
Toolbox codebase. It is _prescriptive_ — it describes what code should look
like, including cases where the existing codebase has not yet been fully migrated.

## Tooling

Most style rules are automatically enforced. Before submitting a pull request, run:

```sh
npm run fmt       # check formatting (dprint)
npm run fmt:fix   # auto-fix formatting
npm run lint      # check linting (ESLint)
npm run lint:css  # check CSS linting (stylelint)
npm run typecheck # type-check without emitting (tsc)
```

| Tool                                                        | Enforces                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [dprint](https://dprint.dev/)                               | Formatting: indentation, line width, quotes, semicolons, trailing commas                    |
| [ESLint](https://eslint.org/)                               | Code quality: variable declarations, arrow callbacks, strict equality, import rules         |
| [stylelint](https://stylelint.io/)                          | CSS quality: no hex colors, no named colors, no `rem`, `--toolbox-*` custom property naming |
| [TypeScript](https://www.typescriptlang.org/) (strict mode) | Type safety, unused locals, optional property exactness                                     |

---

## 1. Formatting

Formatting is handled by dprint and should never require manual effort.
The canonical settings are in `dprint.json`. The rules below describe what
dprint produces.

### Indentation

**Tabs, not spaces.** One tab character per indent level. This respects each
contributor's preferred visual width without encoding that preference into
the file.

### Line width

120 characters. Wrap at natural break points (before operators, between
arguments) rather than mid-expression.

### Quotes

- **TypeScript/TSX**: always single quotes — `'hello'`
- **JSX attributes**: double quotes (HTML convention) — `<div className="foo">`
- **Template literals**: use when the string contains interpolation or a literal quote — `` `Hello, ${name}!` ``

### Semicolons

**No semicolons.** ASI (Automatic Semicolon Insertion) handles termination
correctly in all cases that dprint would produce. Semicolons add visual noise
without functional benefit when a formatter is in the loop.

The only ASI pitfall — a line beginning with `[`, `(`, or `` ` `` — is not an
issue because dprint reformats multi-statement patterns.

### Braces

Always required for control flow bodies, even single-line:

```ts
// correct
if (condition) {
	doSomething()
}

// incorrect
if (condition) { doSomething() }
```

### Arrow function parentheses

Always include parentheses around arrow function parameters, even for a
single argument:

```ts
// correct
const doubled = (x,) => x * 2
items.map((item,) => item.id)

// incorrect
const doubled = (x,) => x * 2
items.map((item,) => item.id)
```

Consistent parentheses make it easier to add a second parameter, apply a type
annotation, or destructure without restructuring the function signature.

### Trailing commas

Use trailing commas in all multi-line arrays, objects, and parameter lists:

```ts
const config = {
    name: 'toolbox',
    version: '7.0.0',
}

function createNote(
    subreddit: string,
    author: string,
    text: string,
) { ... }
```

---

## 2. Naming Conventions

| Case                   | Used for                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `UPPER_SNAKE_CASE`     | Build-time / environment-level primitives only (e.g. `BUILD_TYPE`, `BUILD_SHA`)             |
| `camelCase`            | Variables, `const` bindings, function parameters, object properties, module-level functions |
| `kebab-case`           | Non-component filenames, CSS custom properties, CSS class names in global CSS               |
| `PascalCase`           | React components, classes, TypeScript interfaces, type aliases, enums, **enum members**     |
| `PascalCase` filenames | React component files only (e.g. `RemovalReasonsOverlay.tsx`, `ActionButton.tsx`)           |

### Important distinctions

**`UPPER_SNAKE_CASE` is not for every `const`.** Runtime constants are `camelCase`:

```ts
// correct
const maxRetries = 3
const defaultLabel = 'Moderator'

// incorrect — these are not build-time constants
const MAX_RETRIES = 3
const DEFAULT_LABEL = 'Moderator'
```

**External field names keep their source format.** Use `camelCase` for
application-owned object properties, but preserve API, storage, DOM dataset,
Reddit payload, and other wire-format names when matching those external
contracts. Normalize to `camelCase` at the app boundary when it makes the
calling code clearer.

**Enum members use `PascalCase`, not `UPPER_SNAKE_CASE`** (TypeScript best practice):

```ts
// correct
enum LoadState {
	Pending,
	Loaded,
	Failed,
}

// incorrect — Java-ism, not idiomatic TypeScript
enum LoadState {
	PENDING,
	LOADED,
	FAILED,
}
```

### Abbreviations

Avoid abbreviations unless universally understood in context. Acceptable short
forms: `id`, `url`, `css`, `ui`, `dom`, `api`, `bg` (in CSS variable names only).
When in doubt, spell it out.

---

## 3. TypeScript

### Variable declarations

- Always `const`; use `let` only when the binding is reassigned
- Never `var`

### Import style

Use `import type` for type-only imports. This is required — it helps bundlers
tree-shake and signals intent:

```ts
import {useState,} from 'react'
import type {ReactNode,} from 'react'
```

### Types vs. interfaces

- `interface` for object shapes (extendable, produces better error messages)
- `type` for unions, intersections, mapped types, and aliases

```ts
// object shape → interface
interface Props {
	subreddit: string
	author: string
}

// union → type
type LoadState = 'pending' | 'loaded' | 'failed'
```

### Optional properties

Mark optional props with `?`. Do not redundantly add `| undefined` — the project
uses `exactOptionalPropertyTypes`, so `?` and `| undefined` have different
semantics:

```ts
// correct
interface Props {
	title?: string
}

// incorrect — redundant under exactOptionalPropertyTypes
interface Props {
	title?: string | undefined
}
```

### Type assertions and narrowing

Avoid `as` assertions. Prefer type narrowing via guards:

```ts
// correct
if (value instanceof Error) {
	log.error(value.message,)
} // avoid — suppresses the type system

;(value as Error).message
```

Use the `satisfies` operator when you want both the inferred type and a
constraint check:

```ts
const config = {
	name: 'toolbox',
	env: 'dev',
} satisfies BuildConfig
```

---

## 4. Functions and Arrow Functions

### Callbacks

Anonymous callbacks must be arrow functions — `prefer-arrow-callback` is enforced
by ESLint (with `allowNamedFunctions`, so a _named_ function-expression callback
such as a module's `function init()` is still permitted). Arrow functions do not
have their own `this`, which avoids an entire class of bugs:

```ts
// correct
items.filter((item,) => item.active)

// incorrect
items.filter(function (item,) {
	return item.active
},)
```

### Top-level module functions

Use `function` declarations for top-level utilities. They are hoisted (callable
before their definition), named in stack traces, and visually distinct from
value bindings:

```ts
// correct — function declaration
export function formatDate (date: Date,): string {
	return date.toLocaleDateString()
}

// also acceptable — arrow const
export const formatDate = (date: Date,): string => date.toLocaleDateString()
```

### Arrow body style

Use whichever form is clearer. Implicit returns are fine for simple expressions;
explicit `return` with braces is preferred for multi-statement logic (easier to
set breakpoints, add logging, or add a second statement later):

```ts
// simple transform — implicit return is fine
const ids = items.map((item,) => item.id)

// multi-line logic — use braces and explicit return
const result = items.map((item,) => {
	const label = formatLabel(item,)
	return {id: item.id, label,}
},)
```

---

## 5. Imports

Organize imports into three groups, separated by blank lines:

1. **External packages** — npm dependencies (`react`, `webextension-polyfill`, etc.)
2. **Internal absolute paths** — store, util, shared components
3. **Relative imports** — sibling files (`./`, `../`)

```ts
import {useState,} from 'react'
import type {ReactNode,} from 'react'

import {ActionButton,} from '../../../shared/controls/ActionButton'
import store from '../../../store'
import createLogger from '../../../util/infra/logging'

import css from './AddUserNotePopup.module.css'
```

**No re-export barrel files.** When moving or refactoring files, update all
importers to the new path directly. Re-export shims obscure the real location
and create dead code.

---

## 6. JSDoc and Comments

### File-level JSDoc

Every file must begin with a single-line `/** ... */` comment describing its
purpose. This appears at line 1, before imports:

```ts
/** Popup for creating and viewing usernotes, with tabs for both Toolbox notes
 * and native Reddit mod notes. */

import {useState,} from 'react'
```

### Exported symbols

Every exported function, component, hook, class, interface, and type alias must
have a JSDoc block. Use `@param` for parameters and `@returns` when the return
value is non-obvious:

```ts
/**
 * Attaches a delegated event listener to `parent` that fires `handler` when
 * an event of `type` bubbles up from a descendant matching `selector`.
 * @param parent Element or document to attach the listener to.
 * @param type DOM event type (e.g. `'click'`).
 * @param selector CSS selector to match against event targets.
 * @param handler Called with the matching element and original event.
 */
export function delegate<E extends Event = Event>(
    parent: Element | Document,
    type: string,
    selector: string,
    handler: (target: Element, event: E) => void,
): void { ... }
```

For short, self-explanatory functions, a single-line JSDoc is fine:

```ts
/** Shorthand for `element.querySelector`. */
export function qs<T extends Element = Element,> (
	selector: string,
	parent: Element | Document = document,
): T | null {
	return parent.querySelector<T>(selector,)
}
```

### Inline comments

Only comment on _why_, never on _what_ — well-named identifiers already describe
what. A comment is warranted when:

- There is a non-obvious constraint or invariant
- The code works around a specific external bug or browser quirk
- The behavior would surprise a reader unfamiliar with the context

```ts
// correct — explains a non-obvious constraint
// composedPath() must be called synchronously; it is empty after the event
// handler returns
const path = event.composedPath()

// incorrect — restates what the code already says
// get the path of the event
const path = event.composedPath()
```

---

## 7. React Components

### Component structure

- Functional components only; no class components
- Named exports for components (not default exports)
- Props typed via a local `interface Props` with JSDoc on any non-obvious prop
- Co-locate the `.module.css` file with the component

```tsx
/** Badge showing a user's note count for a subreddit. */

import css from './UserNotesBadge.module.css'

interface Props {
    subreddit: string
    author: string
    /** Text shown when no note exists. */
    defaultText: string
    onClick: React.MouseEventHandler<HTMLButtonElement>
}

export function UserNotesBadge({subreddit, author, defaultText, onClick}: Props) {
    ...
}
```

### Event handler naming

- `on*` for callback props passed from outside — `onClose`, `onSave`, `onChange`
- `handle*` for internal handlers defined in the component — `handleSave`, `handleRemove`, `handleKeyDown`

### CSS Modules

Use CSS Modules for all component-scoped styles. Import as `css` and apply
with `className={css.className}`:

```tsx
import css from './Foo.module.css'

export function Foo () {
	return <div className={css.container}>...</div>
}
```

---

## 8. State Management and Async

### Local state

- `useState` for independent state fields
- `useReducer` for complex state machines with multiple interdependent fields

### Redux

Redux (via RTK) is reserved for:

- User settings (the `settings` slice)
- Cross-component UI feedback: spinners, toast messages, context menus

Do not put ephemeral component state into Redux.

### Async patterns

Prefer `async`/`await` with `try`/`catch`:

```ts
async function handleSave () {
	try {
		await saveNote(note,)
		dispatch(positiveTextFeedback('Note saved',),)
	} catch (error) {
		log.error('Failed to save note:', error,)
		setError('Could not save note. Try again.',)
	}
}
```

Use `.then().catch().finally()` only for fire-and-forget operations where the
caller intentionally does not `await`:

```ts
onRemoveNote(noteId,)
	.then(() => setNotes((prev,) => prev.filter((n,) => n.id !== noteId)))
	.catch((error,) => log.error('Remove failed:', error,))
	.finally(() =>
		setBusyNoteIds((prev,) => prev.filter((id,) => id !== noteId))
	)
```

---

## 9. CSS

### Automatically enforced (stylelint — `npm run lint:css`)

**Color format** — No hex colors, no named colors, modern `rgb()` notation with space-separated values and `/` for alpha:

```css
/* correct */
color: rgb(0 0 0 / 50%);
background: rgb(206 227 248);

/* incorrect — all three are linting errors */
color: rgba(0, 0, 0, 0.5);
background: #cee3f8;
color: red;
```

**CSS variable naming** — Custom properties must follow the `--toolbox-<category>-<purpose>` convention:

```css
--toolbox-accent-color
--toolbox-error-bg
--toolbox-button-bg
--toolbox-text-heading
```

**No `rem` units** — `rem` resolves to the document root font size, which Reddit controls. Use `px`, `em`, `%`, or `vh`/`vw` instead.

**`!important`** _(warning)_ — Every use of `!important` is flagged. See the manual section below for when it is acceptable.

**Descending specificity** — A rule that appears later but has lower specificity than an earlier rule targeting the same property is an error.

---

### Manually enforced (code review)

**Colors should use CSS variables** — Every color should come from `extension/data/css/base.css`. Direct color values in component CSS almost always indicate a missing variable. When no variable exists for the role, use `rgb()` with an `/* intentional: <reason> */` comment:

```css
/* correct */
background-color: var(--toolbox-bg);
color: var(--toolbox-text-body);

/* only when no variable exists for this semantic role */
background-color: rgb(255 255 22); /* intentional: bright yellow is the canonical text-search highlight color */
```

**`!important` requires an explanatory comment** — Only acceptable when overriding Reddit or RES styles where specificity escalation alone cannot win. The comment must name the rule being overridden:

```css
/* acceptable — Reddit's stylesheet sets this with high specificity */
.toolbox-scope a {
	color: var(--toolbox-link-color) !important; /* overrides Reddit's .entry a rule */
}

/* never — do not use !important within toolbox's own component styles */
.container {
	display: flex !important;
}
```

**Unit choice** — Toolbox UI should use a predictable component font base.

- **Shadow DOM** (`mountReactInBody`, `reactRenderer`): `:host` sets the Toolbox UI base font size.
- **Light DOM** (`mountReactInLightBody`, `mountToTarget` with `shadow: false`): components may inherit Reddit/page font sizing unless mounted under a Toolbox UI root that sets the same base.
- Shared React components should not depend on Reddit's ambient page font size. If a component may render in both contexts, ensure its mount root provides the Toolbox base before using `em`-based typography.

Toolbox's UI typography base is `12px`. Convert typography relative to that base: `10px = 0.8333em`, `11px = 0.9167em`, `12px = 1em`, `13px = 1.0833em`, `14px = 1.1667em`.

Use `px` for borders, radii, fixed icon sizes, and fixed control geometry; `em` for typography and text-coupled spacing inside Toolbox UI components; `%` for container-relative widths; `vh`/`vw` for full-page overlays.

**CSS Modules vs. global CSS** — CSS Modules (`.module.css`) for all React component styles; global `.css` for legacy Reddit DOM injection and theme variables. Do not add new global CSS rules for React components.

**Selector specificity** — Keep specificity low. Prefer class selectors over element selectors chained with classes. Use `:is()` for forgiving selector lists:

```text
/* correct */
:is(.toolbox-scope, :host) .toolbox-button { ... }

/* avoid — higher specificity than necessary */
div.toolbox-scope div.toolbox-button { ... }
```

The one exception to "prefer class over element" is when the element type is semantically meaningful — specifically, when a class is applied to multiple element types and the rule should only apply to one of them.

**Specificity overrides** — When a Toolbox rule must beat a Reddit or subreddit CSS rule and `!important` is not appropriate, a specificity lift may be required. Two approved patterns:

- **Class lift** — repeat `.toolbox-scope` as a compound selector. Raises specificity from `(0,2,0)` to `(0,3,0)`. Use when competing against multi-class Reddit rules:

  ```text
  /* beats Reddit's .site-table .link .author at (0,3,0) */
  .toolbox-scope.toolbox-scope .toolbox-tagline .toolbox-comment-author { ... }
  ```

- **Element lift** — qualify the scope anchor with `body`. Raises specificity from `(0,2,0)` to `(0,2,1)`. Use when competing against element-qualified Reddit rules:

  ```text
  /* beats Reddit's a.author at (0,1,1) */
  body.toolbox-scope .toolbox-submission-author { ... }
  ```

The two patterns are **not interchangeable**: `(0,3,0)` and `(0,2,1)` are in different columns and don't beat each other. Pick based on the actual adversary.

**Every specificity lift must have a comment** naming the rule being beaten and its specificity. Without the comment, the doubled class looks like a copy-paste error.
