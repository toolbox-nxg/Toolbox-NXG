# Schema Changes

Toolbox-NXG introduces a new wiki layout (`toolbox-nxg`) alongside the classic `toolbox` wiki page. This page explains what changed, why, and how both layouts coexist during the transition period.

For the full technical specification of each schema version, see [Subreddit Config Schema](../schema/config.md).

## Overview of changes

NXG makes three major changes to how subreddit data is stored:

1. **New wiki paths** — subreddit config moves from `toolbox` to `toolbox-nxg`; usernotes move from `usernotes` to a sharded layout under `toolbox-nxg/usernotes/*`.
2. **Config schema v2** — the config JSON format gains plain-text storage (no URI encoding), brace-token interactive fields, and stable entry IDs. The classic v1 format is still written to the `toolbox` page when 6.x compatibility is enabled.
3. **Usernote archiving** — the NXG usernote format adds an `archived` field per note, letting notes be hidden rather than deleted.

## Subreddit config

### Wiki paths

| Schema       | Wiki page     | Written by                     |
| ------------ | ------------- | ------------------------------ |
| v1 (classic) | `toolbox`     | 6.x clients; NXG compat mirror |
| v2 (NXG)     | `toolbox-nxg` | NXG clients                    |

NXG always reads and writes `toolbox-nxg`. When 6.x compatibility writes are enabled, NXG also writes a down-converted v1 copy to `toolbox` on every save.

### Migration

Migration runs automatically the first time a moderator with wiki-edit permissions views a subreddit. NXG reads the existing `toolbox` page, up-converts it to v2, and writes it to `toolbox-nxg`. The original `toolbox` page is never deleted.

Re-running migration (e.g. to fold in 6.x edits) is safe and idempotent: when a readable `toolbox-nxg` page already exists, NXG reconcile-merges the 6.x-owned fields from the legacy page into it rather than overwriting. Stable entry IDs are preserved by content-matching across the merge.

### v1 → v2 differences

**No URI encoding** — v1 stores certain fields URI-encoded (via `escape()`) because 6.x unconditionally `unescape()`s them on read. v2 stores all strings as plain text. `normalizeConfig` only URI-decodes configs with `ver < 2`, so literal percent signs in v2 text survive.

**Brace tokens instead of HTML** — v1 reason text could embed `<input>`, `<textarea>`, and `<select>` elements. v2 replaces them with brace tokens. The v1 mirror down-converts them back to HTML for 6.x compatibility. See [Brace tokens](#brace-tokens) below for the full syntax.

**Stable entry IDs** — every removal reason and mod macro in v2 carries a stable 8-character base-36 `id`. IDs are assigned on create and backfilled by `ensureStableIds` during normalization. They survive reordering and are stripped from the v1 mirror.

## Brace tokens

Brace tokens are the v2 way to embed interactive fill-in fields in removal reason text. When a moderator opens the removal overlay for a reason that contains tokens, the overlay renders a form control for each one; the mod fills in the values and the final message is assembled by substituting those values in place.

### Token types

**`{input: placeholder}`** — a single-line text field. The text between the colon and the closing brace is used as the placeholder hint shown inside the field. Example:

```
Your post has been removed. Please resubmit with {input: a descriptive title}.
```

**`{textarea: placeholder}`** — a multi-line text field, otherwise identical to `{input}`. Use this when you expect longer free-form text.

```
We have removed your post for the following reason: {textarea: explain the issue in detail}
```

**`{select:name}`** — a pick-one dropdown. Unlike `{input}` and `{textarea}`, the choices are not written inline in the text. They live in a **select definition** stored on the removal reason under `RemovalReason.selects`, built separately in the reason editor's select builder. The token in the text carries only a short reference name:

```
Your post broke {select:rule}. Please review our rules before resubmitting.
```

A select definition has a `name` (used as the reference), an optional `prompt` displayed above the choices, and an `options` list:

```json
{
    "name": "rule",
    "prompt": "Which rule was broken?",
    "options": [
        "Rule 1: No spam",
        "Rule 2: Be civil",
        "Rule 3: Relevant content"
    ]
}
```

### Stable IDs

`{input}` and `{textarea}` tokens may carry an optional stable id using the `#id` syntax:

```
Flight number: {input#flightnum: e.g. UA123}
```

The id is used to persist the entered value between overlay opens (if a mod closes and reopens the overlay without sending, the field is pre-filled with what they typed). For `{select}` tokens, the definition name plays this role automatically.

IDs must be word characters and hyphens (`[\w-]+`). They are optional; a token without an id still works, it just won't preserve entered text across opens.

### Substitution tokens

Brace tokens are distinct from **substitution tokens** — things like `{author}`, `{subreddit}`, and `{url}` that the overlay replaces automatically with context data from the removed post or comment. Substitution tokens are always a bare `{word}` with no colon, so there is no ambiguity:

| Token         | Replaced with                                    |
| ------------- | ------------------------------------------------ |
| `{author}`    | Username of the post/comment author              |
| `{subreddit}` | Name of the subreddit                            |
| `{kind}`      | `"submission"` or `"comment"`                    |
| `{title}`     | Title of the post                                |
| `{url}`       | Permalink to the removed item                    |
| `{domain}`    | Domain the post links to                         |
| `{mod}`       | Username of the moderator sending the removal    |
| `{body}`      | Body of the removed item, quoted as markdown     |
| `{fullname}`  | Reddit fullname (e.g. `t3_abc123`)               |
| `{id}`        | Short id of the removed item                     |
| `{link}`      | URL the post links to                            |
| `{raw_body}`  | Body without markdown quoting                    |
| `{uri_body}`  | URL-encoded body, for use inside markdown links  |
| `{uri_title}` | URL-encoded title, for use inside markdown links |

### Unknown brace content

Any `{…}` content that doesn't match a known interactive token or substitution token is left in the text untouched. In particular, a `{select:name}` whose name doesn't match any definition on the reason is treated as literal text and is never substituted. This means a typo'd or deleted reference name fails visibly rather than silently dropping content.

### Migration from v1 HTML

During the v1 → v2 up-convert, legacy HTML form elements are translated automatically:

| v1 HTML                        | v2 token                               |
| ------------------------------ | -------------------------------------- |
| `<input placeholder="…">`      | `{input: …}`                           |
| `<textarea placeholder="…">`   | `{textarea: …}`                        |
| `<select id="rule">…</select>` | `{select:rule}` (definition extracted) |
| `<br>`                         | `\n\n` (paragraph break)               |

For `<select>` elements that had an `id` attribute with a valid slug-safe name, that name is used directly as the definition name. Elements without an `id` (or with a name that's already taken or not slug-safe) get sequential names: `select-1`, `select-2`, and so on. The numbering is deterministic, so re-converting the same HTML always yields the same names and the NXG config and the classic mirror stay in sync.

The v2 → v1 down-convert reverses this: inline tokens become HTML form elements and `{select:name}` references are expanded back into full `<select>` HTML from the reason's definitions.

## Usernotes

### Wiki paths

| Layout            | Wiki pages                                                  |
| ----------------- | ----------------------------------------------------------- |
| Classic (v6 blob) | `usernotes`                                                 |
| NXG (sharded)     | `toolbox-nxg/usernotes`, `toolbox-nxg/usernotes/<shard>`, … |

The NXG layout splits usernotes across multiple wiki pages to work around Reddit's 512 KB wiki page limit. The classic `usernotes` page had a special 1 MB allowance; that single-page limit no longer applies in the NXG layout.

### Migration

On first access, NXG decodes the classic `usernotes` blob, re-encodes it in the sharded NXG format, and writes the shards. On subsequent accesses (e.g. after 6.x edits), NXG reconcile-merges the classic page into the existing shards: new and changed notes flow in, NXG-only state (archived notes, stable indexes) is preserved.

### Archiving

The NXG format adds an `archived` field to each note entry. When a note is archived, it is hidden from the active list but retained in the shard. The `archived` object records who archived it and when.

When a 6.x mod deletes a note (by removing it from the classic `usernotes` page), NXG's reconciliation detects the deletion and archives the note with `archived.by` set to the sentinel value `[6.x]`, rendered in the UI as "archived via 6.x delete".

Archived notes are stripped from the classic page mirror — 6.x clients will not see them.

### Stable note indexes

Each note in the NXG format has a per-user `index` (assigned from `nextIndex` and never reused), making `(username, index)` an unambiguous address for a note. Notes read from the classic v6 page get ephemeral position-derived indexes on load; durable indexes are assigned when the note is first saved in the NXG layout.

## Personal settings

Personal settings (stored in browser extension storage, not the wiki) carry forward without migration. No schema bumps or key renames are required when upgrading from original Toolbox to Toolbox-NXG.
