# Subreddit Notes Schema

Subreddit notes are moderator-written wiki pages attached to a shared index. They are distinct from [usernotes](usernotes.md) (per-user annotations): subreddit notes are general-purpose text documents — rule summaries, ban templates, workflow guides — that the whole mod team can browse and search from within Toolbox.

## Overview

| Layout      | Wiki pages                                          | Used by                                 |
| ----------- | --------------------------------------------------- | --------------------------------------- |
| NXG (v2)    | `notes/index`, `notes/<slug>`, …                    | Toolbox-NXG                             |
| Legacy (v1) | `notes/index` (notes array only), `notes/<slug>`, … | Older Toolbox builds; NXG compat mirror |

NXG always reads and writes the `notes/` prefix. When the index page is missing, NXG scans existing wiki pages for the `notes/` prefix and builds a bootstrap index from any pages it finds.

## Index page (`notes/index`)

The index is a JSON object that lists every note and caches aggregate metadata. NXG writes schema v2; the legacy mirror is a v1 subset with the aggregate fields stripped.

### NXG index (v2)

```json
{
    "version": 2,
    "notes": [
        {
            "slug": "ban-template",
            "title": "Ban Template",
            "createdAt": 1700000000000,
            "updatedAt": 1701000000000,
            "archived": false,
            "tags": ["bans", "templates"],
            "author": "moderatorname"
        }
    ],
    "tags": ["bans", "templates"],
    "authors": ["moderatorname"]
}
```

| Field     | Type                  | Description                                                                  |
| --------- | --------------------- | ---------------------------------------------------------------------------- |
| `version` | `2`                   | Schema version                                                               |
| `notes`   | `SubredditNoteMeta[]` | Ordered list of note metadata records                                        |
| `tags`    | `string[]`            | Sorted unique list of all tags across all notes; recomputed on every save    |
| `authors` | `string[]`            | Sorted unique list of all authors across all notes; recomputed on every save |

### Legacy index (v1)

```json
{
    "version": 1,
    "notes": [ ... ]
}
```

The legacy index has only `version` and `notes`; the `tags` and `authors` aggregate fields are absent. `version` is always `1` on the legacy mirror. NXG up-converts a v1 index by recomputing the aggregates.

### `SubredditNoteMeta`

Each entry in the `notes` array is a metadata record for one note. The note's body content is not stored in the index — it lives in the note's own wiki page (`notes/<slug>`).

| Field       | Required | Type       | Description                                                                                  |
| ----------- | -------- | ---------- | -------------------------------------------------------------------------------------------- |
| `slug`      | yes      | string     | URL-safe identifier; used as the wiki page name suffix (`notes/<slug>`). Never `"index"`.    |
| `title`     | yes      | string     | Human-readable display title. Derived from the slug (`"my-note"` → `"My Note"`) if absent.   |
| `createdAt` | yes      | integer    | Creation timestamp in epoch milliseconds                                                     |
| `updatedAt` | yes      | integer    | Last-updated timestamp in epoch milliseconds                                                 |
| `archived`  | yes      | boolean    | When `true`, the note is hidden from the default list but retained                           |
| `tags`      | yes      | `string[]` | Free-form tag strings; empty array when none                                                 |
| `author`    | no       | string     | Reddit username of the mod who created the note; absent on notes migrated from older formats |

Slugs are deduplicated on read: if the same slug appears twice in the raw `notes` array, only the first occurrence is kept. The slug `"index"` is rejected and never stored.

## Note content pages (`notes/<slug>`)

Each note's body is stored as a plain wiki page at `notes/<slug>`. The content is plain Reddit Markdown with no JSON envelope — you read and write it directly as the wiki page content.

There is no content schema version. The index is the authoritative list of which slugs exist; a wiki page at `notes/<slug>` without a matching index entry is ignored by Toolbox but is otherwise harmless.

## Reading notes

To enumerate all notes:

1. Fetch and parse `notes/index`. If the page is missing or not valid JSON, treat the subreddit as having no notes.
2. Normalize: if `version` is `1`, the `tags` and `authors` aggregates are absent — compute them from the `notes` array yourself if you need them.
3. For each entry in `notes`, the note body is at `notes/<slug>` as plain wiki content.

## Writing notes

To create or update a note:

1. Read and normalize the current `notes/index`.
2. Write the note body to `notes/<slug>` as plain wiki content.
3. Add or update the `SubredditNoteMeta` entry for `<slug>` in the index's `notes` array.
4. Recompute `tags` and `authors` from the updated `notes` array (sort and deduplicate).
5. Write the updated index back to `notes/index` as JSON.

To archive a note without deleting it, set `archived: true` in the index entry and leave the content page untouched.

To delete a note permanently, remove it from the index's `notes` array and optionally delete the `notes/<slug>` wiki page. NXG never propagates deletions from the legacy mirror into the NXG index (a missing legacy entry is indistinguishable from a failed mirror write), so deletions performed via the legacy `notes/index` will not remove entries from the NXG index.

## Reconciliation with the legacy index

When both a NXG (v2) index and a legacy (v1) index exist, NXG merges them by slug union:

- Slugs only in the legacy index were created by an older Toolbox build and are appended to the NXG index.
- Slugs only in the NXG index are kept unchanged; a deletion in the legacy index is assumed to be a mirror write failure, not a real delete.
- Slugs present in both keep the NXG entry (it carries richer v2 metadata).

The aggregates (`tags`, `authors`) are recomputed whenever the merge adds entries.
