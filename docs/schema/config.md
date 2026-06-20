# Subreddit Config Schema

The per-subreddit toolbox config (removal reasons, mod macros, ban macros) is stored as JSON on a wiki page. There are two schema versions, split across two wiki pages:

| Schema | Page          | Written for                                 |
| ------ | ------------- | ------------------------------------------- |
| v1     | `toolbox`     | 6.x clients (legacy / compatibility mirror) |
| v2     | `toolbox-nxg` | 7.x clients (NXG layout)                    |

The in-memory model is always v2. `normalizeConfig` up-converts anything it reads (v1 pages, hand-edited pages, cached configs) and `encodeClassicConfig` (`extension/data/modules/config/codec.ts`) down-converts on every write to the legacy page. Unmigrated subs read and write only the legacy page, but still in v1 on the wire; migrated subs with 6.x compatibility enabled double-write.

## Schema reference

### Top-level config object

```json
{
    "ver": 2,
    "removalReasons": { ... },
    "modMacros": [ ... ],
    "banMacros": { ... },
    "showRetiredUsernoteShards": false,
    "requireUsernoteType": false,
    "requireUsernoteText": true,
    "requireUsernoteLink": false,
    "usernoteRequirementOption": "leave",
    "trainingMods": [],
    "guardedActions": ["approve", "remove"],
    "proposalRetentionDays": 14
}
```

| Field                       | Type                   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ver`                       | integer                | Schema version; `1` for classic, `2` for NXG                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `removalReasons`            | `RemovalReasonsConfig` | Removal reasons configuration block; always present                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `modMacros`                 | `MacroConfig[]`        | Mod macro entries; empty array when none configured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `banMacros`                 | `BanMacros \| null`    | Ban form defaults; `null` when not configured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `showRetiredUsernoteShards` | boolean                | NXG-only. When `true`, retired (tombstoned) usernote shard pages are surfaced as raw-editor tabs in the config overlay alongside the active shards. Defaults to `false`; stripped from the v1 mirror.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `requireUsernoteType`       | boolean                | NXG-only. When `true`, a usernote saved in this subreddit must have a type/tag. Defaults to `false`; stripped from the v1 mirror. Gated by `usernoteRequirementOption`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `requireUsernoteText`       | boolean                | NXG-only. When `true`, a usernote saved in this subreddit must have body text. Defaults to `true` (only an explicit `false` disables it); stripped from the v1 mirror. Gated by `usernoteRequirementOption`.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `requireUsernoteLink`       | boolean                | NXG-only. When `true`, a usernote saved in this subreddit must include a link to the content it concerns. Defaults to `false`; stripped from the v1 mirror. Gated by `usernoteRequirementOption`.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `usernoteRequirementOption` | string                 | NXG-only. How the three `requireUsernote*` flags apply to moderators, using the same tokens as `removalReasons.removalOption`: `suggest`/`force` make the flags a floor (the more restrictive of the subreddit flag and the moderator's personal setting wins); anything else, including absent/`leave`, defers to each moderator's personal settings. Stripped from the v1 mirror.                                                                                                                                                                                                                                                                |
| `trainingMods`              | `string[]`             | NXG-only. Usernames of moderators in [training mode](../user-guide/modules/proposals.md) for this subreddit; their in-scope moderation actions are captured as [proposals](proposals.md) for review instead of being performed. Compared case-insensitively. Defaults to `[]`; non-string and empty entries are dropped on normalization. Stripped from the v1 mirror.                                                                                                                                                                                                                                                                             |
| `guardedActions`            | `string[]`             | NXG-only. Optional allowlist narrowing which captured action types are guarded for this subreddit's [trainees](../user-guide/modules/proposals.md). **Absent** (the default) guards every action type; a **present array** guards only the listed types (trainees take any other action directly); an **empty array** guards nothing. Recognized [proposal](proposals.md) action discriminants are `approve`, `remove`, `removal-reason`, `lock`, `unlock`, `distinguish`, `marknsfw`, `sticky`, `ban`, `unban`, `mute`, `unmute`, and `userflair`; non-string and unrecognized entries are dropped on normalization. Stripped from the v1 mirror. |
| `proposalRetentionDays`     | integer                | NXG-only. How many days a resolved [proposal](proposals.md) is retained before pruning, unless its proposer dismisses it sooner. Clamped to an integer in `[1, 365]`; defaults to `14`. Stripped from the v1 mirror.                                                                                                                                                                                                                                                                                                                                                                                                                               |

```{note}
Domain tags and usernote type colors were previously stored here as `domainTags: DomainTag[]` and `usernoteColors: UserNoteColor[]`. Both now live on dedicated wiki pages — domain tags on `toolbox-nxg/domain-tags` (with a richer schema including approval/removal counts, glob patterns, notes, and alert thresholds; see [Domain Tags Schema](domain-tags.md)), and usernote types in the usernotes manifest's `types` array (see [Usernotes Schema](usernotes.md)). NXG strips both legacy fields from the config page on load so they don't round-trip back.
```

### `RemovalReasonsConfig`

```json
{
    "reasons": [ ... ],
    "header": "---\n\n*I am a bot...*",
    "footer": "",
    "pmsubject": "Your {kind} was removed from /r/{subreddit}",
    "logsub": "moderationlog",
    "logtitle": "Removed: {kind} by /u/{author}",
    "logreason": "",
    "removalOption": "suggest",
    "typeReply": "reply",
    "typeStickied": false,
    "typeLockComment": false,
    "typeCommentAsSubreddit": false,
    "typeAsSub": false,
    "autoArchive": false,
    "typeLockThread": false,
    "editableReasonsEnabled": false
}
```

| Field                    | Required | Type                       | Description                                                                                                                                                                              |
| ------------------------ | -------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reasons`                | yes      | array                      | List of configured removal reasons                                                                                                                                                       |
| `header`                 | no       | string                     | Markdown prepended to every removal message                                                                                                                                              |
| `footer`                 | no       | string                     | Markdown appended to every removal message                                                                                                                                               |
| `getfrom`                | no       | string                     | Name of another subreddit whose removal reasons to use instead                                                                                                                           |
| `pmsubject`              | no       | string                     | Subject line template for removal PMs; supports substitution tokens                                                                                                                      |
| `logsub`                 | no       | string                     | Subreddit to post the removal log to                                                                                                                                                     |
| `logtitle`               | no       | string                     | Title template for the removal log post; supports substitution tokens                                                                                                                    |
| `logreason`              | no       | string                     | Default reason text pre-filled in the log post; supports substitution tokens                                                                                                             |
| `removalOption`          | no       | string                     | How delivery settings apply to other mods: `"suggest"`, `"force"`, or `"leave"`                                                                                                          |
| `typeReply`              | no       | string                     | Default reply type: `"reply"`, `"pm"`, `"both"`, `"none"`, etc.                                                                                                                          |
| `typeStickied`           | no       | boolean                    | Whether the reply is stickied by default                                                                                                                                                 |
| `typeLockComment`        | no       | boolean                    | Whether the reply locks the removed comment by default                                                                                                                                   |
| `typeCommentAsSubreddit` | no       | boolean                    | Whether the reply is sent as the subreddit by default                                                                                                                                    |
| `typeAsSub`              | no       | boolean                    | Whether the removal message is sent via modmail as the subreddit by default                                                                                                              |
| `autoArchive`            | no       | boolean                    | Whether modmail threads are auto-archived after sending by default                                                                                                                       |
| `typeLockThread`         | no       | boolean                    | Whether the target thread is locked after removal by default                                                                                                                             |
| `editableReasonsEnabled` | no       | boolean                    | When true, moderators may edit reason text before sending                                                                                                                                |
| `suggestedReasons`       | no       | `SuggestedReasonMapping[]` | NXG-only. Maps report text to removal reasons that are pre-selected in the removal overlay when a queue item's report matches. Dropped entirely when empty; stripped from the v1 mirror. |

### `RemovalReason`

```json
{
    "id": "abc12345",
    "title": "Rule 1: No spam",
    "text": "Your post has been removed for {select:rule}.\n\nPlease review our rules.",
    "selects": [
        {
            "name": "rule",
            "prompt": "Which rule was broken?",
            "options": ["Rule 1: No spam", "Rule 2: Be civil"]
        }
    ],
    "removePosts": true,
    "flairText": "Removed",
    "flairCSS": "",
    "flairTemplateID": ""
}
```

| Field               | Required | Type                 | Description                                                                                    |
| ------------------- | -------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| `id`                | no       | string               | Stable 8-character base-36 identifier; assigned by NXG, absent in v1 mirrors                   |
| `title`             | yes      | string               | Display title shown in the removal overlay                                                     |
| `text`              | yes      | string               | Markdown body of the removal message; may contain substitution and interactive tokens (v2)     |
| `selects`           | no       | `SelectDefinition[]` | Named pick-one choice definitions referenced from `text` as `{select:name}`; omitted when none |
| `removePosts`       | no       | boolean              | When `false`, this reason is hidden for posts; defaults to `true` when absent                  |
| `removeComments`    | no       | boolean              | `true` always shows for comments; absent defers to per-mod setting; `false` always hides       |
| `flairText`         | yes      | string               | Post flair text to apply after removal; empty string for none                                  |
| `flairCSS`          | yes      | string               | Post flair CSS class to apply; empty string for none                                           |
| `flairTemplateID`   | yes      | string               | Post flair template ID to apply; empty string for none                                         |
| `editable`          | no       | boolean              | When true, the moderator may edit this reason's text before sending                            |
| `default_note`      | no       | string               | Default usernote text pre-filled when this reason is selected                                  |
| `default_note_type` | no       | string               | Key of the usernote type (`UserNoteColor.key`) to pre-select when leaving a note               |

### `SelectDefinition`

Stored in `RemovalReason.selects`; referenced from reason text as `{select:name}`.

| Field     | Required | Type       | Description                                                                                |
| --------- | -------- | ---------- | ------------------------------------------------------------------------------------------ |
| `name`    | yes      | string     | Slug-safe name (`[\w-]+`), unique within the reason; used as the `{select:name}` reference |
| `prompt`  | no       | string     | Optional label shown above the choices; omitted (never `""`) when empty                    |
| `options` | yes      | `string[]` | Choice texts; each is both the visible label and the value inserted into the message       |

### `SuggestedReasonMapping`

NXG-only. Stored in `RemovalReasonsConfig.suggestedReasons`; stripped from the v1 mirror. Each mapping links report text to one or more removal reasons. When a queue item carries a report whose text **contains** the mapping's `pattern` (case-insensitive substring), the referenced reasons are pre-selected when the moderator opens the removal overlay. Reports filed by any moderator or bot are matched by default; user reports are matched only when `includeUserReports` is set. See [Removal Reasons → Suggested removal reasons](../user-guide/modules/removal-reasons.md#suggested-removal-reasons).

```json
{
    "id": "sug00001",
    "pattern": "low effort post",
    "includeUserReports": true,
    "reasonIds": ["abc12345"]
}
```

| Field                | Required | Type       | Description                                                                                                                          |
| -------------------- | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                 | no       | string     | Stable 8-character base-36 identifier; assigned by NXG, may be absent in hand-edited configs                                         |
| `pattern`            | yes      | string     | Report text to look for, matched as a case-insensitive substring; an entry with an empty pattern is dropped                          |
| `includeUserReports` | no       | boolean    | When `true`, user reports are matched too; otherwise only moderator/bot reports are considered. Stored only when `true`              |
| `reasonIds`          | yes      | `string[]` | Ids of the `RemovalReason` entries (`RemovalReason.id`) to pre-select; empty entries are dropped, and a mapping with none is dropped |

### `MacroConfig`

Mod macros are stored in `modMacros` as an array of objects. All fields except `text` are optional.

```json
{
    "id": "xyz98765",
    "title": "Lock and warn",
    "text": "This thread has been locked for {select:reason}.",
    "remove": false,
    "lockthread": true,
    "distinguish": true,
    "sticky": true,
    "contextpost": true,
    "contextcomment": false,
    "contextmodmail": false
}
```

| Field              | Required | Type    | Description                                                                  |
| ------------------ | -------- | ------- | ---------------------------------------------------------------------------- |
| `id`               | no       | string  | Stable 8-character base-36 identifier; absent in v1 mirrors                  |
| `text`             | yes      | string  | Macro reply text; supports markdown and substitution tokens                  |
| `title`            | no       | string  | Display title shown in the macro picker                                      |
| `remove`           | no       | boolean | Remove the target post or comment                                            |
| `approve`          | no       | boolean | Approve the target post or comment                                           |
| `spam`             | no       | boolean | Mark the target as spam                                                      |
| `ban`              | no       | boolean | Ban the target post/comment author                                           |
| `unban`            | no       | boolean | Unban the target post/comment author                                         |
| `mute`             | no       | boolean | Mute the target author in the subreddit                                      |
| `userflair`        | no       | string  | Flair template ID to apply to the author                                     |
| `userflairtext`    | no       | string  | Display text for the flair template                                          |
| `lockthread`       | no       | boolean | Lock the target post or comment thread                                       |
| `lockreply`        | no       | boolean | Lock the reply posted by this macro                                          |
| `sticky`           | no       | boolean | Sticky the macro reply (only effective on top-level comments)                |
| `archivemodmail`   | no       | boolean | Archive the modmail thread after sending                                     |
| `highlightmodmail` | no       | boolean | Highlight the modmail thread after sending                                   |
| `distinguish`      | no       | boolean | Distinguish the macro reply as a moderator comment                           |
| `replyassubreddit` | no       | boolean | Post the reply as the subreddit ModTeam account via official removal message |
| `contextpost`      | no       | boolean | Show this macro in post contexts; defaults to `true` when absent             |
| `contextcomment`   | no       | boolean | Show this macro in comment contexts; defaults to `true` when absent          |
| `contextmodmail`   | no       | boolean | Show this macro in modmail contexts; defaults to `true` when absent          |

### `BanMacros`

Ban form defaults stored in `banMacros`. The field is `null` when not configured.

```json
{
    "banNote": "Permanent ban: repeated rule violations",
    "banMessage": "You have been permanently banned for repeatedly violating our rules.",
    "defaultBanPermanent": true,
    "defaultBanDuration": 0,
    "banDurationPresets": [3, 7, 30]
}
```

| Field                 | Required | Type        | Description                                                               |
| --------------------- | -------- | ----------- | ------------------------------------------------------------------------- |
| `banNote`             | yes      | string      | Internal mod note pre-filled into the ban form                            |
| `banMessage`          | yes      | string      | Ban message pre-filled into the ban form (sent to the banned user)        |
| `defaultBanPermanent` | yes      | boolean     | Whether the ban defaults to permanent                                     |
| `defaultBanDuration`  | yes      | integer     | Default temporary ban duration in days; `0` when permanent is the default |
| `banDurationPresets`  | yes      | `integer[]` | Quick-select duration buttons in the ban form (days, 1–999)               |

## Substitution tokens

Removal reason text, headers, footers, log titles, and macro text support substitution tokens. These are bare `{word}` tokens with no colon — distinct from the interactive brace tokens described in [v2 vs v1](#v2-vs-v1).

| Token         | Replaced with                                                          |
| ------------- | ---------------------------------------------------------------------- |
| `{author}`    | Username of the post or comment author                                 |
| `{subreddit}` | Name of the subreddit                                                  |
| `{kind}`      | `"submission"` or `"comment"`                                          |
| `{title}`     | Title of the post                                                      |
| `{url}`       | Permalink to the removed post or comment                               |
| `{domain}`    | Domain the post links to                                               |
| `{mod}`       | Username of the moderator sending the removal                          |
| `{body}`      | Body of the removed item, quoted as markdown (lines prefixed with `>`) |
| `{fullname}`  | Reddit fullname of the removed item (e.g. `t3_abc123`)                 |
| `{id}`        | Short base-36 id of the removed item                                   |
| `{link}`      | URL the post links to                                                  |
| `{raw_body}`  | Body without markdown quoting                                          |
| `{uri_body}`  | URL-encoded body, for use inside markdown links                        |
| `{uri_title}` | URL-encoded title, for use inside markdown links                       |

Unknown `{…}` content (no colon, no match) is left in the text untouched.

## v2 vs v1

**No encoding.** v1 stores removal reason text, the removal header/footer, and macro text `escape()`-encoded because 6.x `unescape()`s them unconditionally on read. v2 stores every string as plain text. (`normalizeConfig` only URI-decodes configs with `ver < 2`, so a literal `%20` in v2 text survives.)

**Interactive tokens instead of limited HTML.** v1 reason text could embed literal `<input>`, `<textarea>`, and `<select>`/`<option>` elements that the removal dialog turns into fill-in fields. v2 replaces them with brace tokens, which can't collide with reddit markdown and sit naturally beside the existing substitution tokens (`{subreddit}`, `{author}`, …, which are unchanged):

```text
{input: placeholder text}
{textarea: placeholder text}
{select:rule}
```

Select options live in the reason's `selects` array, not inline in the reason text. A select token references one named definition:

```json
{
    "text": "Please review {select:rule}.",
    "selects": [
        {
            "name": "rule",
            "prompt": "Pick the rule that applies",
            "options": [
                "Your post breaks rule 1 | see [the rules](https://example.com/rules)",
                "Your post breaks rule 2"
            ]
        }
    ]
}
```

Each token may carry an optional stable id used to persist the entered value between overlay opens: `{input#flightnum: Flight number}`. For selects, the definition name is the stable id and maps to the HTML `id` attribute on the v1 mirror; a select prompt rides along as a `label` attribute there (invisible in 6.x, recovered on up-convert). Token content cannot contain braces (the serializer substitutes parens), and option line breaks collapse to spaces on the v1 mirror because legacy options are single-line.

The codec for both directions lives in `extension/data/modules/shared/removalReasons/tokens.ts`. Conversion notes:

- `<br>` becomes a paragraph break (`\n\n`); the v1 mirror keeps plain newlines, which 6.x handles fine.
- A legacy `<option value="x">label</option>` keeps `x` (the value is what 6.x inserted into the removal message); the label is dropped.

**Stable entry ids.** Every removal reason and mod macro carries an `id` (eight base-36 characters). Ids are assigned by the editing UI on create and backfilled by `ensureStableIds` during normalization; they are stripped from the v1 mirror (6.x rebuilds entries wholesale on save, so they wouldn't survive there anyway — they're re-backfilled on the next normalize). They exist so reordering and cross-references don't have to rely on array indexes.

## Versioning

`ver` on the page selects the schema. `configSchema` / `configMinSchema` / `configMaxSchema` in `extension/data/util/wiki/schemas/config/schema.ts` define what a build writes and accepts. `configMigrations` is a registry of in-place upgrade steps keyed by the version each upgrades _from_; it is currently empty because the v1 → v2 upgrade has no discrete migration — its string decode and HTML-to-token conversion run unconditionally in `normalizeConfig` (the conversion doubles as self-healing for v2 pages). To bump the schema again, add a migration keyed by the version it upgrades _from_, raise `configSchema`/`configMaxSchema`, and extend `encodeClassicConfig` if the new fields need a v1 representation.
