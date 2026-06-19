# Function Parameter Conventions

To keep call sites predictable, functions across `extension/` should take the
same domain concepts in the same **order** and under the same **name**. The
scanner at `scripts/check-param-order.mjs`
reports where the codebase drifts from the convention below. It is **report
only** — it never edits code.

Run it with:

```sh
npm run lint:params                       # scan all of extension/
node scripts/check-param-order.mjs <path> # scan specific files/dirs
```

It exits non-zero when any violation is found.

## The convention

The source of truth is the data in
`scripts/param-conventions.mjs`. Each
recognized _concept_ has one **canonical name**. The order of the concept list
is the canonical **parameter order**: a concept listed earlier must appear
earlier in a function's parameter list.

| Order | Canonical name  | Meaning                           |
| ----- | --------------- | --------------------------------- |
| 1     | `element`       | The DOM element being operated on |
| 2     | `subreddit`     | A subreddit's bare name (`funny`) |
| 3     | `subredditPath` | A subreddit path (`/r/funny/...`) |
| 4     | `user`          | A user / account                  |
| 5     | `submission`    | A link or self post               |
| 6     | `comment`       | A comment                         |
| 7     | `fullname`      | A prefixed thing id (`t1_abcdef`) |
| 8     | `id`            | A bare base-36 id (`abcdef`)      |

A handful of legacy **synonyms** (e.g. an old `sub`, `username`, or `post`
parameter) are also recognized in `scripts/param-conventions.mjs` and reported
as rename candidates. The codebase is currently fully compliant — none remain —
but the synonyms stay defined so the scanner catches any regression.

Any other **data parameters** (`text`, `reason`, `title`, …) and a destructured
**options object** may appear among these; their positions are not enforced.

`id` and `fullname` are deliberately **separate concepts**, not synonyms: a
`fullname` carries a type prefix (`t1_`, `t3_`, …) while an `id` is the bare
base-36 string. `subredditPath` is likewise distinct from `subreddit`.

Some names that look like concepts are intentionally **unrecognized** because
they are overloaded and cannot be classified by name alone:

- `thing` — a Reddit "thing": the `.thing` DOM element in the DOM layers, or the raw API data object in the API/data layers. Never a bare `fullname` string.
- `target` — sometimes a DOM `Element`, but also a flair payload, an `EventTarget`, a `Node`, or an arbitrary config object.
- `node` — a DOM `Node` (broader than `Element`; includes text nodes).
- `author` — sometimes a boolean flag (an "author context" prop), and elsewhere the precise term for a _content_ author, distinct from a generic `user`.
- `link` / `postLink` — `link` is sometimes a raw URL being submitted (not a reference to a submission); `postLink` is a submission's `fullname`.
- `subredditName` — an explicit name often paired with a sibling `subredditUrl`, and threaded through JSX props / custom-event detail contracts.

## What the scanner checks

- **ORDER** — only the **relative** order of recognized concepts is enforced (e.g. `subreddit` before `submission`, or an `id` before a `subreddit`). Generic data params and the options object are skipped, so a leading unrecognized param never triggers an order flag.
- **NAMING** — a parameter (or a destructured object key) uses a synonym instead of the canonical name.
- **JSDOC** — a function's `@param` tags drift from its real signature (missing, extra, or mis-ordered tags). Only checked when the function already documents at least one `@param`.

## Tuning the convention

The convention is intended to be adjusted as the report is reviewed — nothing is
auto-fixed, so changes here only affect what gets reported. Edit
`scripts/param-conventions.mjs` to:

- add or remove synonyms (overloaded names are deliberately left out — only add a synonym when one name unambiguously means one concept),
- reorder concepts, or
- introduce new concepts.

`*ID`-suffixed names (`postID`, `commentID`, `templateID`) are intentionally
left unrecognized for now; map them to concepts here once their meaning is
settled.
