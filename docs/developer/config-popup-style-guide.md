# Config Popup Style Guide

Reference for building tabs and components within the Toolbox config overlay (`ConfigOverlay` / `WindowTabs`).

---

## Design Tokens

All values come from `extension/data/css/base.css`. Use variables where they exist; use raw `rgb()` only for values not covered by a token.

| Token                              | Value                                 | Usage                                    |
| ---------------------------------- | ------------------------------------- | ---------------------------------------- |
| `--toolbox-font-family`            | Verdana, Arial, Helvetica, sans-serif | All text                                 |
| `--toolbox-header-bg`              | `#CEE3F8`                             | Tab footer bar background                |
| `--toolbox-header-button-bg`       | `#C7D6E6`                             | Sidebar tab background                   |
| `--toolbox-header-button-hover-bg` | `#9FBAD6`                             | Sidebar tab hover / active               |
| `--toolbox-input-border`           | `#C7D6E6`                             | Input borders at rest                    |
| `--toolbox-input-focus`            | `#9FBAD6`                             | Input focus ring; "add" card border      |
| `--toolbox-border-color`           | `#72869A`                             | Non-primary `ActionButton` border        |
| `--toolbox-action-bg`              | `#F7FAFD`                             | Card body background; non-primary button |
| `--toolbox-action-text`            | `#17324E`                             | Non-primary button text                  |
| `--toolbox-shadow-color`           | `rgb(160 177 193 / 40%)`              | Window drop-shadow                       |

### Raw Hex Palette

These are used directly in component CSS (no token exists for them yet).

| Name                | Hex       | Usage                                                  |
| ------------------- | --------- | ------------------------------------------------------ |
| Body text           | `#46596D` | Card titles, field labels, preview text                |
| Muted text          | `#6B7A8D` | Section headers, hints, badge text                     |
| Placeholder / empty | `#9FBAD6` | Untitled italics, empty-state text, drag handles       |
| Card border         | `#D0DCE8` | All card / section borders                             |
| Card body bg        | `#F7FAFD` | Card background                                        |
| Card header bg      | `#EAF2FA` | Card header strip; "add" card full background          |
| Grouped field bg    | `#F0F5FA` | Action-group grid background                           |
| Badge bg            | `#D8E8F5` | Context badge fill                                     |
| Primary blue        | `#3B7DB4` | Primary button; active icon button; expand-toggle link |
| Primary blue hover  | `#2D6090` | Primary button hover border                            |
| Primary blue active | `#22527E` | Primary button pressed                                 |
| Disabled primary    | `#7AADD0` | Primary button disabled fill                           |
| Warning bg          | `#FFF8E6` | Warning banner background                              |
| Warning border      | `#E8D5A0` | Warning banner border                                  |
| Warning accent      | `#C9A227` | Warning banner left accent                             |
| Warning text        | `#6B5A1E` | Warning banner text                                    |
| Error text          | `#C0392B` | Validation / error messages                            |

---

## Typography

| Role               | Size | Weight | Color     | Notes                                                        |
| ------------------ | ---- | ------ | --------- | ------------------------------------------------------------ |
| Section title      | 11px | bold   | `#6B7A8D` | Uppercase, `letter-spacing: 0.05em`, border-bottom `#D0DCE8` |
| Field label        | 11px | bold   | `#46596D` | —                                                            |
| Sub-group label    | 10px | bold   | `#6B7A8D` | Uppercase, `letter-spacing: 0.04em`                          |
| Card title         | 12px | bold   | `#46596D` | —                                                            |
| Body / preview     | 12px | normal | `#46596D` | `line-height: 1.4`                                           |
| Hint / description | 11px | normal | `#6B7A8D` | Italic                                                       |
| Empty state        | 11px | normal | `#9FBAD6` | Italic                                                       |
| Badge              | 10px | bold   | `#6B7A8D` | `letter-spacing: 0.02em`                                     |
| Link / toggle      | 11px | normal | `#3B7DB4` | Underline on hover                                           |

---

## Spacing

| Context                     | Value                           |
| --------------------------- | ------------------------------- |
| Tab content padding         | `5px` (handled by `WindowTabs`) |
| Card list gap               | `6px`                           |
| Card header padding         | `6px 8px`                       |
| Card body / preview padding | `6px 8px`                       |
| Edit form padding           | `8px`                           |
| Edit form field gap         | `10px`                          |
| Field label → input gap     | `3px`                           |
| Section margin-bottom       | `18px` (0 on last child)        |
| Section title margin-bottom | `8px`                           |
| Action group grid gap       | `8px`                           |
| Edit button row gap         | `6px`                           |
| Icon button gap             | `2px`                           |

---

## Components

### Card List

A vertically stacked list of items. Used for both editable lists and sort lists.

```css
.root {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.cardList {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin-top: 4px;
}
```

### Card (Editable)

Two zones: a header strip and a collapsible body.

```css
.card {
	border: 1px solid #d0dce8;
	border-radius: 3px;
	background: #f7fafd;
	overflow: hidden;
}

/* "new item" variant */
.addCard {
	background: #eaf2fa;
	border-color: var(--toolbox-input-focus);
}

.cardHeader {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 6px 8px;
	background: #eaf2fa;
	border-bottom: 1px solid #d0dce8;
	gap: 8px;
}

.cardTitle {
	font-size: 12px;
	font-weight: bold;
	color: #46596d;
	flex: 1;
	min-width: 0; /* enables text-overflow inside flex */
}

.untitled {
	color: #9fbad6;
	font-weight: normal;
}
```

**Card header slot order:** title (flex: 1) → badges → actions

### Card (Sort / Drag)

Flat single-row card used in sort lists. No header strip — everything is inline.

```css
.card {
	display: flex;
	align-items: center;
	gap: 6px;
	border: 1px solid #d0dce8;
	border-radius: 3px;
	background: #f7fafd;
	padding: 5px 8px;
}
```

Drag handle uses `cursor: grab` / `cursor: grabbing`, color `#9FBAD6`, Material Icons `dragHandle` icon at 18px.

### Context Badges

Shown in the card header to indicate which contexts an item applies to.

```css
.contextBadges {
	display: flex;
	gap: 3px;
	flex-shrink: 0;
}

.contextBadge {
	font-size: 10px;
	font-weight: bold;
	color: #6b7a8d;
	background: #d8e8f5;
	border-radius: 2px;
	padding: 1px 4px;
	letter-spacing: 0.02em;
}
```

### Icon Buttons (card header actions)

Small icon-only buttons for edit/delete/reorder within card headers.

```css
.iconButton {
	background: none;
	border: none;
	padding: 2px;
	cursor: pointer;
	display: flex;
	align-items: center;
	border-radius: 2px;
	line-height: 1;
}
.iconButton:hover {
	background: rgb(0 0 0 / 6%);
}

/* Applied when the button represents the current "active" state (e.g. editor is open) */
.iconButtonActive {
	color: #3b7db4;
}
```

**Edit toggle pattern:** clicking the edit button when the editor is already open closes it. The button icon switches between `edit` and `close`, and the title between `'Edit'` and `'Close editor'`. Apply `.iconButtonActive` when open.

### Preview Area

Shown in a card body when not editing. Clamp to 3 lines by default; "Show more / Show less" toggle appears when content overflows.

```css
.previewWrap {
	padding: 6px 8px;
}
.previewClamped {
	overflow: hidden;
	display: -webkit-box;
	-webkit-line-clamp: 3;
	-webkit-box-orient: vertical;
	font-size: 12px;
	color: #46596d;
	line-height: 1.4;
}
.previewFull {
	font-size: 12px;
	color: #46596d;
	line-height: 1.4;
}
.expandToggle {
	font-size: 11px;
	color: #3b7db4; /* underline on hover */
}
.noText {
	font-size: 11px;
	color: #9fbad6;
	font-style: italic;
	padding: 6px 8px;
}
```

### Edit Form (inside a card)

```css
.editForm {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 8px;
	width: 100%;
}
.editField {
	display: flex;
	flex-direction: column;
	gap: 3px;
}

/* All inputs in a field should be full-width */
.editField input[type="text"],
.editField select,
.editField textarea {
	box-sizing: border-box;
	width: 100%;
}

.editFieldLabel {
	font-size: 11px;
	font-weight: bold;
	color: #46596d;
}
.editButtons {
	display: flex;
	gap: 6px;
}
```

Always use `<TextInput>`, `<TextareaInput>`, `<ActionSelect>`, and `<CheckboxInput>` from `shared/controls/` — never raw `<input>` / `<select>` / `<textarea>`.

### Action Group Grid (checkbox clusters)

Used for grouping boolean toggles (e.g. mod macro actions).

```css
.actionsGrid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
	gap: 8px;
	padding: 8px;
	border: 1px solid #d0dce8;
	border-radius: 2px;
	background: #f0f5fa;
}
.actionGroup {
	display: flex;
	flex-direction: column;
	gap: 5px;
}
.actionGroupLabel {
	font-size: 10px;
	font-weight: bold;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: #6b7a8d;
	padding-bottom: 3px;
	border-bottom: 1px solid #d0dce8;
}
```

### Section Grouping (flat-form tabs)

For tabs that present a flat form rather than a card list.

```css
.section {
	margin-bottom: 18px;
}
.section:last-child {
	margin-bottom: 0;
}
.sectionTitle {
	font-size: 11px;
	font-weight: bold;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: #6b7a8d;
	margin-bottom: 8px;
	padding-bottom: 4px;
	border-bottom: 1px solid #d0dce8;
}
.fieldLabel {
	display: block;
	font-size: 11px;
	color: #46596d;
	margin-bottom: 3px;
	margin-top: 10px;
}
.fieldHint {
	font-size: 11px;
	color: #6b7a8d;
	font-style: italic;
}
```

### Warning Banner

Used on sort tabs to warn about destructive / irreversible actions.

```css
.warning {
	background: #fff8e6;
	border: 1px solid #e8d5a0;
	border-left: 3px solid #c9a227;
	border-radius: 2px;
	padding: 6px 10px;
	font-size: 11px;
	color: #6b5a1e;
}
```

### Radio Option Cards

For mutually exclusive settings choices (e.g. reply type in removal reasons).

```css
.radioOption {
	padding: 7px 10px;
	border: 1px solid var(--toolbox-input-border);
	border-radius: 2px;
	background: #f7fafd;
}
.radioOption.selected {
	border-color: var(--toolbox-input-focus);
	background: #eaf2fa;
}
.radioLabel {
	display: flex;
	align-items: center;
	gap: 7px;
	cursor: pointer;
	font-size: 12px;
}
/* Sub-options indented inside the selected card */
.subOptions {
	margin-top: 8px;
	margin-left: 22px;
	padding-top: 7px;
	border-top: 1px solid #d0dce8;
}
```

---

## Footer Buttons

The tab footer (`footer:` prop on a `ConfigOverlayTab`) renders in a fixed bar below the scroll area. Rules:

- Buttons are **right-aligned** (`justify-content: flex-end` in `WindowTabs`).
- Use `<ActionButton primary>` for the primary action, plain `<ActionButton>` for secondary (cancel, reset).
- All buttons render at the same height — do not add extra padding or height overrides.
- Icons inside `ActionButton` are automatically constrained to `14px` by global CSS.

**"Add new" pattern:** expose an `addRef` from the list component using the `handleAddRef` / `useEffect` pattern. In `dom.tsx`, render `<AddNewButton>` (the local wrapper that handles disabled state) rather than a raw `ActionButton`. The button is disabled while a pending new-item form is open.

**Save + reset pair:**

```tsx
<>
	<ActionButton type="button" onClick={() => resetRef.current?.()}>
		Reset sort order
	</ActionButton>
	<ActionButton primary type="button" onClick={() => saveRef.current?.()}>
		Save order
	</ActionButton>
</>
```

**Wiki editor footer:** use `<WikiEditorFooter>` (defined in `dom.tsx`) which renders a `<TextInput inFooter>` that fills available width alongside the save button.

---

## Interaction Patterns

### `saveRef` / `resetRef` / `addRef`

Cross-boundary imperative callbacks — a component exposes a function to its parent (`dom.tsx`) without prop-drilling React state. Always use the stale-closure-safe pattern:

```ts
const handleSaveRef = useRef<() => void>(() => {},)
handleSaveRef.current = handleSave // updated every render
useEffect(() => {
	if (!saveRef) { return }
	saveRef.current = () => handleSaveRef.current()
	return () => {
		saveRef.current = null
	}
}, [],) // wired once
```

### `disabledRef`

Same pattern, but carries a state setter:

```ts
type DisabledRef = {current: ((disabled: boolean,) => void) | null}

// In the footer component (dom.tsx):
useEffect(() => {
	disabledRef.current = setDisabled
	return () => {
		disabledRef.current = null
	}
}, [],)

// In the list component — synced via useEffect on the controlling state:
useEffect(() => {
	disabledRef?.current?.(showAddForm,)
	if (showAddForm) { /* scroll to bottom */ }
}, [showAddForm,],)
```

### Scroll to bottom on add

After `showAddForm` flips true, walk up from the list's root ref to find the nearest scrollable ancestor and scroll it smoothly:

```ts
const el = rootRef.current
let parent = el?.parentElement
while (parent) {
	if (parent.scrollHeight > parent.clientHeight) {
		parent.scrollTo({top: parent.scrollHeight, behavior: 'smooth',},)
		break
	}
	parent = parent.parentElement
}
```

### Advanced settings

The global `advancedMode` setting gates:

- Additional tabs in `ConfigOverlay` (marked `advanced: true` on the tab definition — a section header is injected automatically before the first advanced tab).
- Advanced field sections inside individual tabs (wrap in `{advancedMode && (...)}` ).

---

## File Conventions

| File                       | Contains                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `dom.tsx`                  | Tab definitions, `AddNewButton`, `WikiEditorFooter`, `saveButton`. All `SaveRef` / `DisabledRef` objects live here. |
| `ComponentName.tsx`        | Purely presentational React. Accepts refs, emits callbacks. No direct wiki reads/writes except on initial load.     |
| `ComponentName.module.css` | Scoped styles for that component only. No global selectors.                                                         |

Each new list tab needs at minimum: an edit list component, a sort list component, and corresponding CSS modules. The sort component uses `@dnd-kit/core` + `@dnd-kit/sortable` and follows the pattern in `RemovalReasonSortList.tsx`.
