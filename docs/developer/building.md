# Building and Testing

## Prerequisites

- [Node.js](https://nodejs.org/en/) ≥ 24
- npm (comes with Node.js)

## Install dependencies

```sh
npm install
```

## Build scripts

```sh
npm run build          # Build for both Chrome and Firefox
npm run build:chrome   # Build only the Chromium extension
npm run build:firefox  # Build only the Firefox extension
npm run build:watch    # Automatically rebuild on file changes
```

Build output goes to `build/chrome/` and `build/firefox/`.

### Environment variables

| Variable       | Values                     | Default | Notes                                                         |
| -------------- | -------------------------- | ------- | ------------------------------------------------------------- |
| `BUILD_TYPE`   | `dev`, `beta`, `stable`    | `dev`   | Use `dev` for local builds. Beta/stable are for distribution. |
| `BUILD_TARGET` | `all`, `chrome`, `firefox` | `all`   | Use `chrome` or `firefox` for faster intermediate builds.     |
| `BUILD_SHA`    | any commit hash            | —       | Required for beta/stable. Leave unset for dev builds.         |

## Loading in a browser

### Chromium (Chrome, Edge, Brave, etc.)

1. Go to `chrome://extensions` (or `edge://extensions`, etc.).
2. Enable "Developer mode".
3. Click "Load unpacked extension...".
4. Select the `build/chrome` directory.

### Firefox

1. Go to `about:debugging`.
2. Click "This Firefox" in the sidebar.
3. Click "Load Temporary Add-on...".
4. Select `build/firefox/manifest.json`.

## Tests and static analysis

```sh
npm test             # Run unit tests (Vitest)
npm run test:watch   # Run tests in watch mode
npm run typecheck    # TypeScript type-check (no emit)
npm run lint         # ESLint
npm run lint:css     # Stylelint
npm run lint:params  # Parameter-order convention check
npm run fmt          # Formatting check (dprint)
npm run fmt:fix      # Auto-fix formatting
```

## Pre-commit checklist

Before committing, run the following checks in order. All must pass cleanly.

```sh
npm run fmt:fix         # Auto-fix formatting with dprint
npm run lint:css:fix    # Auto-fix CSS style issues with Stylelint
npm run typecheck       # TypeScript type-check (no emit)
npm test                # Unit tests (Vitest)
npm run lint:params     # Parameter-order and naming conventions
npm run build           # Full production build (Chrome + Firefox)
```

The auto-fix steps (`fmt:fix`, `lint:css:fix`) should be run first so the
subsequent checks operate on already-formatted code. If `typecheck`, `test`,
`lint:params`, or `build` report any errors, resolve them before committing.

For issues that cannot be auto-fixed, the plain check variants are available:

```sh
npm run fmt             # Formatting check only (no changes)
npm run lint:css        # CSS lint check only (no changes)
npm run lint            # ESLint (no changes)
```

## Documentation

```sh
npm run docs:api     # Generate TypeDoc Markdown → docs/developer/api/
```

After running `npm run docs:api`, build Sphinx to include the generated API reference:

```sh
pip install -r docs/requirements.txt
make -C docs html
```
