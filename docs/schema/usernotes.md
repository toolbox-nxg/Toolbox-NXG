# Usernotes Schema

Usernotes are stored on the subreddit wiki at `toolbox-nxg/usernotes` and `toolbox-nxg/usernotes/<suffix>` (NXG layout) and `usernotes` (classic layout).

## Overview

Two storage layouts exist:

| Layout            | Wiki pages                                                              | Used by                                 |
| ----------------- | ----------------------------------------------------------------------- | --------------------------------------- |
| Classic (v6 blob) | `usernotes`                                                             | Original Toolbox 6.x; NXG compat mirror |
| NXG (sharded)     | `toolbox-nxg/usernotes` (manifest), `toolbox-nxg/usernotes/<suffix>`, … | Toolbox-NXG                             |

NXG always reads and writes the sharded layout. When 6.x compatibility writes are enabled, NXG also maintains a v6 blob mirror on `usernotes` so original Toolbox clients can read current data.

## NXG format

The NXG layout consists of a manifest page and one or more shard pages.

### Manifest (`toolbox-nxg/usernotes`)

The manifest is a JSON envelope at schema version 7, continuing the classic usernotes numbering (v6 is the single-page blob; v7 is the sharded layout):

```json
{
    "format": "tbun-manifest",
    "ver": 7,
    "gen": 1,
    "types": [ ... ],
    "shards": [
        { "start": 0, "page": "s1-00000000" }
    ]
}
```

| Field     | Required | Type                  | Description                                                                                                          |
| --------- | -------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `format`  | yes      | `"tbun-manifest"`     | Format marker identifying this page as the shard manifest                                                            |
| `ver`     | yes      | `7`                   | Manifest schema version                                                                                              |
| `gen`     | yes      | integer               | Monotonic generation counter; bumped whenever the shard list changes, making page names unique                       |
| `types`   | yes      | `UserNoteColor[]`     | Usernote type definitions; the canonical source for a subreddit's note types (see [`UserNoteColor`](#usernotecolor)) |
| `shards`  | yes      | `UsernotesShardRef[]` | Shard range descriptors, sorted by `start`; `shards[0].start` is always `0`                                          |
| `retired` | no       | `string[]`            | Page suffixes retired by a split whose tombstone write failed; retried on the next save                              |

Each entry in `shards` is a `UsernotesShardRef`:

| Field   | Type    | Description                                                                                                               |
| ------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `start` | integer | Inclusive uint32 lower bound of this shard's FNV-1a username-hash range                                                   |
| `page`  | string  | Page-name suffix under `toolbox-nxg/usernotes/`, e.g. `s1-00000000`; the full path is `toolbox-nxg/usernotes/s1-00000000` |

Shard ranges are disjoint and cover the full uint32 space. Shard `i` covers hashes `[shards[i].start, shards[i+1].start)`; the last shard covers through `2^32 − 1`. Username hashing uses 32-bit FNV-1a over the lowercased name — the hash function is part of the storage format and must not change.

### Shard pages (`toolbox-nxg/usernotes/<suffix>`)

See [Usernotes Shard Pages](usernotes-shards.md) for the full shard envelope, payload, note entry fields, and archive sentinels.

## Classic format (v6 blob)

The classic `usernotes` page stores a compressed blob in a JSON envelope:

```json
{
    "ver": 6,
    "constants": {
        "users": ["mod1", "mod2", ...],
        "warnings": ["ban", "abusewarn", ...]
    },
    "blob": "<base64(zlib(users JSON))>"
}
```

The decompressed `blob` is a JSON object mapping usernames to deflated user records:

```json
{
    "someuser": {
        "ns": [
            {
                "n": "Note text",
                "t": 1700000000,
                "m": 0,
                "l": "l,abc,def",
                "w": 1
            }
        ]
    }
}
```

### Deflated note fields

| Field | Description                                                          |
| ----- | -------------------------------------------------------------------- |
| `n`   | Note text                                                            |
| `t`   | Creation timestamp (epoch seconds — note: seconds, not milliseconds) |
| `m`   | Index into `constants.users` for the creating moderator              |
| `l`   | Link in compressed form: `"l,<postId>,<commentId>"` or `""`          |
| `w`   | Index into `constants.warnings` for the note type                    |

Note types are not stored in the classic format itself. When NXG loads a v6 page it seeds `types` from the built-in defaults (plus any unknown type keys found in existing notes) and embeds them in the manifest on the next save.

## `UserNoteColor`

Usernote type definitions are stored in the manifest's `types` array and are the canonical source for a subreddit's note types. When the manifest has no `types` (classic v6 subreddits that have never been saved through NXG), the built-in defaults below are used.

```json
{
    "key": "ban",
    "text": "Ban",
    "color": "red",
    "colorDark": "#ff8f8f",
    "banDuration": 7,
    "autoArchiveDays": 30
}
```

| Field             | Required | Type    | Description                                                                                         |
| ----------------- | -------- | ------- | --------------------------------------------------------------------------------------------------- |
| `key`             | yes      | string  | Unique identifier used to reference this type elsewhere (e.g. in `RemovalReason.default_note_type`) |
| `text`            | yes      | string  | Human-readable display label                                                                        |
| `color`           | yes      | string  | CSS color for light mode (hex string, named color, etc.)                                            |
| `colorDark`       | no       | string  | CSS color for dark mode; falls back to `color` when absent                                          |
| `banDuration`     | no       | integer | When present, auto-ban is offered when leaving this note type; `0` = permanent, positive = days     |
| `autoArchiveDays` | no       | integer | When present, notes of this type older than this many days are archived on save; `0` = immediately  |

**Built-in defaults:**

| key         | text             | color   |
| ----------- | ---------------- | ------- |
| `gooduser`  | Good Contributor | green   |
| `spamwatch` | Spam Watch       | fuchsia |
| `spamwarn`  | Spam Warning     | purple  |
| `abusewarn` | Abuse Warning    | orange  |
| `ban`       | Ban              | red     |
| `permban`   | Permanent Ban    | darkred |
| `botban`    | Bot Ban          | black   |

## Schema versions

| Version       | Layout                                                 | Notes                                                 |
| ------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| v6            | Classic (`usernotes`)                                  | Current classic version; used by original Toolbox 6.x |
| v7 (manifest) | Sharded manifest (`toolbox-nxg/usernotes`)             | Manifest schema version; introduced by Toolbox-NXG    |
| v1 (shard)    | Sharded shard pages (`toolbox-nxg/usernotes/<suffix>`) | Shard page schema version; introduced by Toolbox-NXG  |

NXG always up-converts v6 data on read. The version written to the classic mirror is always v6.

## Reading notes (classic format)

To read usernotes from the classic page:

1. Fetch `usernotes` wiki page content.
2. Parse JSON — the result is a `RawUsernotesBlob` with `ver`, `constants`, and `blob` fields.
3. Base64-decode `blob`, then zlib-inflate (raw deflate) the result.
4. Parse the inflated JSON as a `Record<string, DeflatedUser>`.
5. For each user entry, expand each deflated note by resolving `m` and `w` against `constants.users` and `constants.warnings`.
6. Timestamps in the classic format are epoch seconds; multiply by 1000 to get milliseconds.

## Writing notes

To write usernotes back, the wiki page must have moderator-only edit permissions (`permlevel: 2` in the wiki page settings). Third-party tools that write to the classic `usernotes` page should use schema v6, preserve unknown fields, and follow the constant-pool encoding described above.

Third-party tools writing to the NXG sharded layout should treat shard boundaries as opaque and only modify shard pages via the manifest's shard list — do not create new shard pages without updating the manifest. The `gen` counter in the manifest must be incremented whenever the shard list changes, and new shard page names must embed the current `gen` value (e.g. `s{gen}-{start_hex_padded_8}`).
