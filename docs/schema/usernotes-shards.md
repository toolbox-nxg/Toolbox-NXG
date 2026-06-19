# Usernotes Shard Pages

Each shard is stored at `toolbox-nxg/usernotes/<suffix>` (e.g. `toolbox-nxg/usernotes/s1-00000000`). The suffix is chosen by the NXG client when the shard is created; its format is `s{gen}-{start_hex_padded_8}`, where `gen` is the manifest generation counter at creation time and `start_hex_padded_8` is the shard's lower-bound hash as an eight-character lowercase hex string.

See [Usernotes Schema](usernotes.md) for the manifest format and an overview of the sharded layout.

## Page envelope

Each shard is a JSON envelope at schema version 1 containing a compressed payload:

```json
{
    "format": "nxg-usernotes",
    "ver": 1,
    "blob": "<base64(zlib(payload JSON))>"
}
```

| Field    | Type              | Description                                    |
| -------- | ----------------- | ---------------------------------------------- |
| `format` | `"nxg-usernotes"` | Format marker identifying this page as a shard |
| `ver`    | `1`               | Shard schema version                           |
| `blob`   | string            | `base64(zlib(payload JSON))`                   |

## Payload

The decompressed payload is a JSON object mapping lowercase usernames to user records:

```json
{
    "someuser": {
        "nextIndex": 3,
        "notes": [
            {
                "index": 0,
                "note": "Broke rule 1",
                "time": 1700000000,
                "mod": "moderatorname",
                "type": "abusewarn",
                "link": "/r/subreddit/comments/abc/-/def/"
            },
            {
                "index": 1,
                "note": "Banned for repeated violations",
                "time": 1701000000,
                "mod": "moderatorname",
                "type": "ban",
                "archived": { "by": "moderatorname", "at": 1702000000 }
            }
        ]
    }
}
```

### User record fields

| Field       | Type             | Description                             |
| ----------- | ---------------- | --------------------------------------- |
| `nextIndex` | integer          | Next note index to assign; never reused |
| `notes`     | `NxgShardNote[]` | Array of note entries                   |

### Note entry fields

| Field         | Required | Type    | Description                                                                      |
| ------------- | -------- | ------- | -------------------------------------------------------------------------------- |
| `index`       | yes      | integer | Stable per-user note index                                                       |
| `note`        | yes      | string  | Note text                                                                        |
| `time`        | yes      | integer | Creation timestamp (epoch seconds)                                               |
| `mod`         | yes      | string  | Username of the creating moderator                                               |
| `type`        | no       | string  | Note type key; omitted when no type                                              |
| `link`        | no       | string  | Subreddit-relative permalink, e.g. `/r/sub/comments/abc/-/def/`                  |
| `messageLink` | no       | string  | Full URL of an associated removal modmail                                        |
| `archived`    | no       | object  | Set when archived; contains `by` (username or sentinel) and `at` (epoch seconds) |

`time` and `archived.at` are epoch **seconds** — the same granularity reddit
itself exposes, and the same unit the classic v6 page stores.

### Archive sentinels

Two special values may appear in `archived.by`:

| Value    | Meaning                                                                        |
| -------- | ------------------------------------------------------------------------------ |
| `[6.x]`  | Archived because the note was deleted on the classic wiki page by a 6.x client |
| `[auto]` | Archived automatically by the per-type auto-archive sweep                      |
