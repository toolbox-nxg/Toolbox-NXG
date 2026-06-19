# Writing a Toolbox Module

## What a module is

A module is a self-contained feature unit. The module system provides three things:

1. **Settings** — persistent user preferences stored in `browser.storage.local`, surfaced in the Toolbox config UI
2. **Lifecycle** — an `init()` function called when the module activates, expected to return a cleanup function
3. **Registration** — all modules are listed in `init.ts`; the system calls `init()` and `cleanup()` as needed

Your job when writing a module is to express three concerns in their correct layer:

| Layer        | File                        | Responsibility                                            |
| ------------ | --------------------------- | --------------------------------------------------------- |
| **Config**   | `settings.ts`               | Declare what settings exist and their defaults            |
| **Data**     | `schema.ts`, `moduleapi.ts` | Domain types, wiki read/write, schema upgrades            |
| **Behavior** | `dom.ts` (or `features/`)   | Handler logic, grouped into factory functions             |
| **UI**       | `components/`               | React components; purely presentational                   |
| **Wiring**   | `index.ts`                  | Create factories, attach lifecycle handlers, nothing else |

---

## Deciding your file layout

Start with the minimal set and add files when a real concern arises.

**Every module needs:**

- `index.ts` — always
- `settings.ts` — always (even if the array is empty)

**Add `schema.ts` when** the module has domain data structures that exist independently of settings: wiki-stored config shapes, API response types, multi-valued data models, or any type shared between `api.ts` and `components/`. Skip it if the module only reads/writes typed settings with no external storage.

**Add `moduleapi.ts` when** the module reads from or writes to a subreddit wiki page or performs schema upgrades on stored data.

**Add `dom.ts` when** the module does anything in the page — injects UI, responds to events, observes the DOM. Almost every module has this.

**Add `components/`** for React UI: popups, overlays, panels. Skip for modules that inject only plain DOM or do no UI at all.

**Add `store.ts`** only when multiple factories and/or React components all need to subscribe to the same mutable state (e.g. a pub/sub counter). This is rare.

### Structural variants

**Multi-feature modules** — when a module's behavior is too large or too distinct to live in a single `dom.ts`, use a `features/` subdirectory instead. Each file in `features/` exports one `create*Handlers()` factory; `index.ts` calls the factories and wires the returned handlers. The strongest case for splitting is independently toggle-able behaviors (each guarded by its own boolean setting), but `features/` is also correct whenever a sub-behavior is logically separate enough to warrant its own file and test. Do not leave extra behavior files at the module root — if it isn't `dom.ts`, `schema.ts`, `moduleapi.ts`, `store.ts`, `settings.ts`, or `index.ts`, it belongs in `features/` (or `components/` if it is a React component). See `betterbuttons` (toggle-able) and `modbar` (mixed).

**Cross-platform modules** — if old Reddit and new Reddit (shreddit) need separate implementations, add a `platformInterface.ts` file that declares a platform-agnostic TypeScript interface for all DOM operations the module needs, and exports a factory (`createOldReddit*()`) that returns a concrete binding against `dom/oldReddit/` helpers. Feature handler factories in `dom.ts` (or `features/`) accept the interface as an argument and stay platform-neutral. `index.ts` picks the right factory at runtime via `isOldReddit`. Use `oldReddit/` and `shreddit/` subdirectories when a feature also requires platform-specific React components or sizeable non-DOM logic that doesn't belong in `platformInterface.ts`. See `comment` and `commenttriage`.

---

## File reference

### `settings.ts`

Declares every user-facing preference for the module.

```ts
import {defineSettings, InferSettings,} from '../../framework/module'

export const settings = defineSettings(
	[
		{
			id: 'enableFoo',
			type: 'boolean',
			default: false,
			description: 'Enable the foo behavior.',
		},
		{
			id: 'fooLabel',
			type: 'text',
			default: 'Foo',
			description: 'Label shown for foo.',
		},
	] as const,
)

export type MyModuleSettings = InferSettings<typeof settings>
```

Rules:

- `defineSettings([...] as const)` — the `as const` is required for type inference
- Export `settings` (the value) and `type MyModuleSettings` (the inferred type); nothing else
- The only permitted additional import is `getSettingAsync` when a `hidden` callback must read another setting's value to determine visibility

### `schema.ts`

Holds all domain interfaces — types that describe stored or transferred data, not UI props.

```ts
export const SCHEMA_VERSION = 6;
export const MIN_SCHEMA_VERSION = 4;

export interface NoteEntry {
    n: string;    // note text
    t: number;    // unix timestamp
    m: string;    // moderator username
    l: string;    // link (encoded)
    w: number;    // note type index
}

export interface NotesData {
    ver: number;
    users: Record<string, {ns: NoteEntry[]}>;
}

export const defaultNoteTypes = [ ... ] as const;
```

Rules:

- Components import domain types from `../schema`, never from each other
- Static lookup tables and defaults live here alongside their interfaces
- No imports from `dom.ts`, `moduleapi.ts`, or `components/`

### `moduleapi.ts`

Reads and writes external storage (subreddit wikis, extension storage). Contains any schema upgrade/migration logic.

```ts
import {postToWiki, readFromWiki,} from '../../api/resources/wiki'
import {NotesData, SCHEMA_VERSION,} from './schema'

export async function getNotes (subreddit: string,): Promise<NotesData | null> {
	const result = await readFromWiki<NotesData>(subreddit, 'usernotes', true,)
	if (!result.ok) { return null } // result.reason: 'no_page' | 'invalid_json' | 'unknown_error'
	return inflate(result.data,) // decompress/upgrade as needed
}

export async function saveNotes (
	subreddit: string,
	data: NotesData,
): Promise<void> {
	await postToWiki(
		subreddit,
		'usernotes',
		deflate(data,),
		'toolbox usernotes',
		false,
		false,
	)
}
```

Rules:

- No module-level mutable state; all state flows through function arguments and return values
- Return types are typed against `schema.ts` interfaces, not `any`
- No event listeners, no lifecycle wiring

### `dom.ts`

Contains the handler logic for page behavior. Exports one or more factory functions — each factory closes over settings and returns a **handler bundle**: a plain object mapping handler names to functions.

```ts
import {TBListenerEvent,} from '../../util/ui/listener'
import {MyModuleSettings,} from './settings'

export interface MyHandlers {
	handleAuthor: (event: TBListenerEvent,) => void
	handleClick: (element: Element, event: MouseEvent,) => void
	handleNewPage: (event: CustomEvent,) => void
	/** Disposes everything this factory registered; `index.ts` passes it to `lifecycle.mount`. */
	cleanup: () => Promise<void>
}

export function createMyHandlers (s: MyModuleSettings,): MyHandlers {
	const seen = new Set<string>()
	const scope = createLifecycle()
	scope.mount(
		renderAtLocation('authorActions', {id: 'mymodule.author',}, renderTag,),
	)

	return {
		cleanup: scope.cleanup,
		handleAuthor (event,) {
			const {username,} = event.detail.data
			if (seen.has(username,)) { return }
			seen.add(username,)
		},
		handleClick (element, _event,) {
			scope.timeout(() => {/* ... */}, 200,)
		},
		handleNewPage (_event,) {
			seen.clear()
		},
	}
}
```

Rules:

- Factory functions are named `create*Handlers()` — always
- Factories **must not** accept a `Lifecycle` instance as an argument. A factory that needs to register cleanup creates its **own** disposal scope with `createLifecycle()` and returns `scope.cleanup`; `index.ts` mounts it via `lifecycle.mount(handlers.cleanup)`.
- A factory uses its own scope only for the disposables it owns (renderers, internal timers/observers). Wiring the handlers it returns (`lifecycle.on`/`delegate`) stays in `index.ts`.
- All domain state lives inside the factory closure, not at module scope

### `components/`

React components are **purely presentational**: props in, callbacks out, no direct API calls.

```ts
// components/MyPopup.tsx
interface Props {
    note: NoteEntry;          // domain type from ../schema
    onSave: (n: NoteEntry) => void;
    onClose: () => void;
}

export function MyPopup ({note, onSave, onClose}: Props) { ... }
```

Rules:

- Domain types come from `../schema`, not from sibling component files
- Components may use `useEffect` + `addEventListener` for events scoped to the component's own mount/unmount lifetime
- Co-locate CSS modules (`.module.css`) alongside the component file

### `index.ts`

The entry point. Its only job is to instantiate the `Module`, then in `init()`: create the lifecycle, call factories, attach handlers to the lifecycle, return cleanup.

```ts
import {createLifecycle,} from '../../framework/lifecycle'
import {Module,} from '../../framework/module'
import {isCommentsPage,} from '../../util/reddit/pageContext'
import TBListener from '../../util/ui/listener'
import {createMyHandlers,} from './dom'
import {MyModuleSettings, settings,} from './settings'

export default new Module<MyModuleSettings>({
	name: 'My Module',
	id: 'MyModule',
	enabledByDefault: true,
	oldReddit: true,
	settings,
}, function init (s,) {
	if (!isCommentsPage) { return }

	const lifecycle = createLifecycle()
	const handlers = createMyHandlers(s,)

	lifecycle.mount(handlers.cleanup,)
	lifecycle.mount(TBListener.on('author', handlers.handleAuthor,),)
	lifecycle.on(window, 'TBNewPage', handlers.handleNewPage,)
	lifecycle.delegate<MouseEvent>(
		document.body,
		'click',
		'.my-selector',
		handlers.handleClick,
	)

	return lifecycle.cleanup
},)
```

Rules:

- `index.ts` contains **only**: imports, the `Module` constructor, `createLifecycle()`, factory calls, `lifecycle.*` wiring calls, and `return lifecycle.cleanup`
- No helper function definitions, no inline lambdas with business logic, no DOM queries, no state initialization
- Platform restrictions belong on the `Module` options (`oldReddit: true` / `shreddit: true`)
- `return lifecycle.cleanup` — return the function reference, do not call it

---

## Lifecycle wiring

The `Lifecycle` object manages everything that needs cleanup when the module re-initializes or is disabled.

| Method                                                | Use for                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| `lifecycle.on(target, type, handler, options?)`       | DOM event listeners on `window`, `document`, or a specific element              |
| `lifecycle.delegate(parent, type, selector, handler)` | Event delegation — fires handler when a matching descendant is the event target |
| `lifecycle.mount(TBListener.on('name', handler))`     | TBListener subscriptions                                                        |
| `lifecycle.observe(target, callback, options)`        | MutationObserver — creates, starts observing, and disconnects on cleanup        |
| `lifecycle.interval(handler, ms)`                     | `setInterval` with automatic `clearInterval`                                    |
| `lifecycle.timeout(handler, ms)`                      | `setTimeout` with automatic `clearTimeout`                                      |
| `lifecycle.mount(() => element.remove())`             | Injected DOM elements that should be removed on cleanup                         |
| `lifecycle.mount(cleanup)`                            | Any other cleanup function — runs in reverse registration order                 |

**Never** use raw `addEventListener`, `setInterval`, `setTimeout`, or `new MutationObserver` directly — always go through a lifecycle.

---

## Type discipline

- `any` is permitted only at genuine external boundaries: raw Reddit API JSON, extension storage reads, WeakMap lookups from `elementDetails`
- Use `unknown` + narrowing (`instanceof Error`) in `catch` blocks
- For `fetch` / `TBApi.getJSON` results: `any` at the immediate response boundary is acceptable; don't carry `any` deeper into business logic
- Domain types flow from `schema.ts` → `api.ts` / `dom.ts` / `components/`; never in reverse

---

## Pre-PR checklist

1. `npm test` passes
2. `npm run build` passes for Chrome and Firefox
3. `index.ts` contains no helper function definitions, inline business logic, DOM queries, or state initialization
4. `dom.ts` factory functions contain no `lifecycle.on` / `lifecycle.observe` calls
5. All domain interfaces live in `schema.ts`, not inline in component files
6. No sibling-component type imports (e.g. importing a type from `./AddUserNotePopup` instead of `../schema`)
7. All settings used in `dom.ts` are declared in `settings.ts` and destructured from the settings argument; no unused setting declarations
8. No raw `addEventListener`, `setInterval`, `setTimeout`, or `new MutationObserver` — all through lifecycle
9. Injected DOM elements are removed in cleanup
10. `getAttribute` / `dataset` results guarded before use
11. No redundant conditions: simplify `A || (!A && B)` to `A || B`
12. No always-truthy guards on non-nullable types
13. `parseInt` always called with explicit radix
