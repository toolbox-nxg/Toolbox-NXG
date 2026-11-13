# Subreddit Config Schema

The per-subreddit toolbox config (removal reasons, mod macros, ban macros) is stored as JSON on a wiki page. There are two schema versions, split across two wiki pages:

| Schema | Page          | Written for                                 |
| ------ | ------------- | ------------------------------------------- |
| v1     | `toolbox`     | 6.x clients (legacy / compatibility mirror) |
| v2     | `toolbox-nxg` | 7.x clients (NXG layout)                    |

The in-memory model is always v2. `normalizeConfig` up-converts anything it reads (v1 pages, hand-edited pages, cached configs) and `encodeClassicConfig` (`extension/data/util/wiki/schemas/config/codec.ts`) down-converts on every write to the legacy page. Subs that could not be moved onto the NXG layout (the viewer lacks mod or wiki permissions, or setup failed) read and write only the legacy page, still in v1 on the wire; migrated subs with 6.x compatibility enabled double-write.

## Schema reference

### Top-level config object

```json
{
    "ver": 2,
    "removalReasons": { ... },
    "modMacros": [ ... ],
    "banMacros": { ... },
    "savedBanMacros": [ ... ],
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
| `requireBanMessage`         | boolean                | NXG-only. When `true`, the mod button, usernote and native note ban forms refuse to send a ban with an empty message; only checked when a ban is issued. Defaults to `false`; stripped from the v1 mirror.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `disableNativeNoteBan`      | boolean                | NXG-only. When `true`, the native note composer never offers a ban with the Ban or Permaban label, for every mod. Defaults to `false`; stripped from the v1 mirror.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `savedBanMacros`            | `SavedBanMacro[]`      | NXG-only. Named ban macros offered as an "Apply ban macro..." picker in every ban form (mod button, removal reasons, usernotes). Absent when none are configured; entries without a title are dropped and `days` is clamped to 1-999 on normalization. Kept outside the legacy-owned `banMacros` block so a 6.x save cannot erase it, and stripped from the v1 mirror.                                                                                                                                                                                                                                                                             |
| `showRetiredUsernoteShards` | boolean                | NXG-only. When `true`, retired (tombstoned) usernote shard pages are surfaced as raw-editor tabs in the config overlay alongside the active shards. Defaults to `false`; stripped from the v1 mirror.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `requireUsernoteType`       | boolean                | NXG-only. When `true`, a usernote saved in this subreddit must have a type/tag. Defaults to `false`; stripped from the v1 mirror. Gated by `usernoteRequirementOption`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `requireUsernoteText`       | boolean                | NXG-only. When `true`, a usernote saved in this subreddit must have body text. Defaults to `true` (only an explicit `false` disables it); stripped from the v1 mirror. Gated by `usernoteRequirementOption`.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `requireUsernoteLink`       | boolean                | NXG-only. When `true`, a usernote saved in this subreddit must include a link to the content it concerns. Defaults to `false`; stripped from the v1 mirror. Gated by `usernoteRequirementOption`.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `usernoteRequirementOption` | string                 | NXG-only. How the three `requireUsernote*` flags apply to moderators, using the same tokens as `removalReasons.removalOption`: `suggest`/`force` make the flags a floor (the more restrictive of the subreddit flag and the moderator's personal setting wins); anything else, including absent/`leave`, defers to each moderator's personal settings. Stripped from the v1 mirror.                                                                                                                                                                                                                                                                |
| `trainingMods`              | `string[]`             | NXG-only. Usernames of moderators in [training mode](../user-guide/modules/proposals.md) for this subreddit; their in-scope moderation actions are captured as [proposals](proposals.md) for review instead of being performed. Compared case-insensitively. Defaults to `[]`; non-string and empty entries are dropped on normalization. Stripped from the v1 mirror.                                                                                                                                                                                                                                                                             |
| `guardedActions`            | `string[]`             | NXG-only. Optional allowlist narrowing which captured action types are guarded for this subreddit's [trainees](../user-guide/modules/proposals.md). **Absent** (the default) guards every action type; a **present array** guards only the listed types (trainees take any other action directly); an **empty array** guards nothing. Recognized [proposal](proposals.md) action discriminants are `approve`, `remove`, `removal-reason`, `lock`, `unlock`, `distinguish`, `marknsfw`, `sticky`, `ban`, `unban`, `mute`, `unmute`, and `userflair`; non-string and unrecognized entries are dropped on normalization. Stripped from the v1 mirror. |
| `proposalRetentionDays`     | integer                | NXG-only. How many days a resolved [proposal](proposals.md) is retained before pruning, unless its proposer dismisses it sooner. Clamped to an integer in `[1, 365]`; defaults to `14`. Stripped from the v1 mirror.                                                                                                                                                                                                                                                                                                                                                                                                                               |

The `toolbox-nxg` page also carries a `Toolbox.Utils.compatibilityWrites` boolean, the subreddit's 6.x compatibility flag, written on every NXG config save. It is layout metadata rather than config and is stripped from the v1 mirror. When compatibility is turned off, the legacy `toolbox` page is replaced by the tombstone `{"Toolbox.Utils.wikiLayout": "nxg"}`.

```{note}
Domain tags and usernote type colors were previously stored here as `domainTags: DomainTag[]` and `usernoteColors: UserNoteColor[]`. Both now live on dedicated wiki pages — domain tags on `toolbox-nxg/domain-tags` (with a richer schema including approval/removal counts, glob patterns, notes, and alert thresholds; see [Domain Tags Schema](domain-tags.md)), and usernote types in the usernotes manifest's `types` array (see [Usernotes Schema](usernotes.md)). NXG strips both legacy fields from the config page on load so they don't round-trip back. The v1 mirror still carries them for 6.x: `encodeClassicConfig` re-injects `domainTags` (`name`, `color`, `note` only) and `usernoteColors` (`key`, `text`, `color` only) from their NXG sources.
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

| Field                    | Required | Type                       | Description                                                                                                                                                                                 |
| ------------------------ | -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reasons`                | yes      | array                      | List of configured removal reasons                                                                                                                                                          |
| `header`                 | no       | string                     | Markdown prepended to every removal message                                                                                                                                                 |
| `footer`                 | no       | string                     | Markdown appended to every removal message                                                                                                                                                  |
| `headerScope`            | no       | string                     | NXG-only. Which removals start with the header included: `"posts"` or `"comments"`. Absent means both. Only the default; mods can still toggle it per removal. Stripped from the v1 mirror. |
| `footerScope`            | no       | string                     | NXG-only. Same as `headerScope`, for the footer.                                                                                                                                            |
| `getfrom`                | no       | string                     | Name of another subreddit whose removal reasons to use instead                                                                                                                              |
| `pmsubject`              | no       | string                     | Subject line template for removal PMs; supports substitution tokens                                                                                                                         |
| `logsub`                 | no       | string                     | Subreddit to post the removal log to                                                                                                                                                        |
| `logtitle`               | no       | string                     | Title template for the removal log post; supports substitution tokens                                                                                                                       |
| `logreason`              | no       | string                     | Default reason text pre-filled in the log post; supports substitution tokens                                                                                                                |
| `removalOption`          | no       | string                     | How delivery settings apply to other mods: `"suggest"`, `"force"`, or `"leave"`                                                                                                             |
| `typeReply`              | no       | string                     | Default reply type: `"reply"`, `"pm"`, `"both"`, or `"none"`                                                                                                                                |
| `typeStickied`           | no       | boolean                    | Whether the reply is stickied by default                                                                                                                                                    |
| `typeLockComment`        | no       | boolean                    | Whether the reply locks the removed comment by default                                                                                                                                      |
| `typeCommentAsSubreddit` | no       | boolean                    | Whether the reply is sent as the subreddit by default                                                                                                                                       |
| `typeAsSub`              | no       | boolean                    | Whether the removal message is sent via modmail as the subreddit by default                                                                                                                 |
| `autoArchive`            | no       | boolean                    | Whether modmail threads are auto-archived after sending by default                                                                                                                          |
| `typeLockThread`         | no       | boolean                    | Whether the target thread is locked after removal by default                                                                                                                                |
| `editableReasonsEnabled` | no       | boolean                    | When true, moderators may edit reason text before sending                                                                                                                                   |
| `suggestedReasons`       | no       | `SuggestedReasonMapping[]` | NXG-only. Maps report text to removal reasons that are pre-selected in the removal overlay when a queue item's report matches. Dropped entirely when empty; stripped from the v1 mirror.    |
| `nativeSync`             | no       | `NativeReasonSyncState`    | NXG-only. State for the opt-in one-way import of Reddit's native removal reasons. Dropped entirely when empty; stripped from the v1 mirror.                                                 |

### `RemovalReason`

```json
{
    "id": "abc12345",
    "title": "Rule 1: No spam",
    "text": "Your post has been removed. Which rule was broken?\n\n{choice#rule}\n- Rule 1: No spam\n- Rule 2: Be civil\n\nPlease review our rules.",
    "removePosts": true,
    "flairText": "Removed",
    "flairCSS": "",
    "flairTemplateID": ""
}
```

| Field               | Required | Type    | Description                                                                                                                                                                                                                  |
| ------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | no       | string  | Stable 8-character base-36 identifier; assigned by NXG, absent in v1 mirrors                                                                                                                                                 |
| `title`             | yes      | string  | Display title shown in the removal overlay                                                                                                                                                                                   |
| `text`              | yes      | string  | Markdown body of the removal message; may contain substitution and interactive tokens (v2)                                                                                                                                   |
| `removePosts`       | no       | boolean | When `false`, this reason is hidden for posts; defaults to `true` when absent                                                                                                                                                |
| `removeComments`    | no       | boolean | `true` always shows for comments; absent defers to per-mod setting; `false` always hides                                                                                                                                     |
| `flairText`         | yes      | string  | Post flair text to apply after removal; empty string for none                                                                                                                                                                |
| `flairCSS`          | yes      | string  | Post flair CSS class to apply; empty string for none                                                                                                                                                                         |
| `flairTemplateID`   | yes      | string  | Post flair template ID to apply; empty string for none                                                                                                                                                                       |
| `editable`          | no       | boolean | When true, the moderator may edit this reason's text before sending                                                                                                                                                          |
| `default_note`      | no       | string  | Default usernote text pre-filled when this reason is selected                                                                                                                                                                |
| `default_note_type` | no       | string  | Key of the usernote type (`UserNoteColor.key`) to pre-select when leaving a note                                                                                                                                             |
| `nativeReasonId`    | no       | string  | NXG-only. Reddit's id for the native removal reason this reason mirrors; registers the reason in Reddit's mod log on removal, and links the reason for syncing. Reasons carrying it are excluded from the v1 mirror entirely |

### Interactive tokens in reason text

v2 reason text embeds fill-in fields as brace tokens (v1 used limited HTML; see [Schema Changes](../migration/schema-changes.md#brace-tokens) for the full syntax and conversion rules):

| Token                                                      | Field                                                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `{input: placeholder}`                                     | Single-line text field, inline                                                                |
| `{textarea: placeholder}`                                  | Multi-line text field, inline                                                                 |
| `{choice}` + a `-` list below it                           | Pick-one field as a block: the marker on its own line, each list item an option               |
| `{choice: option 1 \| option 2}`                           | Pick-one field inside a line (mid-sentence or as a link's text); `\|` for a literal pipe      |
| `{dropdown}` / `{dropdown: a \| b}`                        | Pick-one field exactly like `{choice}` in either form, shown as a dropdown, not radio buttons |
| `{multi}` + a `- [ ]` list below it                        | Tick-box field as a block: sends only the ticked items, as a `-` list                         |
| `{highlight}` + a `- [ ]` list below it                    | Tick-box field as a block: sends every item as a `-` list, ticked ones in bold                |
| `{check: text}` / `{highlight: text}`                      | One tick box inside a line: `check` sends the text if ticked, `highlight` bolds it if ticked  |
| `[x]` instead of `[ ]`                                     | Starts a tick box ticked (`- [x] item`, `{check: [x] text}`)                                  |
| `{note: text}`                                             | Guidance shown to the moderator in the overlay; never sent                                    |
| `!` after the kind or id (`{input!: …}`, `{choice#rule!}`) | Required field: the overlay won't send until it is filled, picked, or ticked                  |
| `#id` after the kind (`{choice#rule}`)                     | Optional slug-safe id (`[\w-]+`) that keeps the entered or chosen value between opens         |

Older v2 pages stored pick-one fields as a `selects` array on the reason, referenced from the text as `{select:name}`. Normalization folds each definition into the text as a `{choice}` block and drops the field; it is never written.

### `NativeReasonSyncState`

NXG-only. Stored in `RemovalReasonsConfig.nativeSync`; stripped from the v1 mirror. Tracks the opt-in, one-way import of a subreddit's **native** removal reasons (those configured in Reddit's own Mod Tools) into its toolbox reasons.

Reddit owns each imported reason's `title` and `text`, which are overwritten on every sync. Everything else on the reason -- flair, usernote defaults, `removePosts`/`removeComments`, `editable` -- stays under moderator control and is preserved. A reason deleted upstream is removed from the toolbox list; a reason deleted in the toolbox editor is added to `ignored` so it is not re-imported.

Imported reasons are **not** written to the legacy `toolbox` mirror at all, since 6.x cannot register a native reason id and rebuilds reason objects wholesale on save. A subreddit whose reasons are all imported therefore writes an empty `reasons` list to the mirror, and moderators still on 6.x will not see them.

```json
{
    "enabled": true,
    "fingerprint": "3a7f21c49b0e8d55",
    "lastSyncedAt": 1700000000000,
    "ignored": ["a1b2c3d4-..."]
}
```

| Field          | Required | Type       | Description                                                                                                                             |
| -------------- | -------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`      | no       | boolean    | Whether the sync is on for this subreddit. Only ever stored as `true`; turning it off removes the key rather than writing `false`       |
| `fingerprint`  | no       | string     | Order-independent digest of the native reason set as of the last applied sync, used to skip the merge when nothing upstream has changed |
| `lastSyncedAt` | no       | number     | Epoch milliseconds of the last applied sync; displayed in the config editor                                                             |
| `ignored`      | no       | `string[]` | Native reason ids a moderator deleted locally; never re-imported. Dropped entirely when empty                                           |

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
    "text": "This thread has been locked, {author}, because it has run its course.",
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

| Field                 | Required | Type        | Description                                                                                                                                                                                |
| --------------------- | -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `banNote`             | yes      | string      | Internal mod note pre-filled into the ban form                                                                                                                                             |
| `banMessage`          | yes      | string      | Ban message pre-filled into the ban form (sent to the banned user)                                                                                                                         |
| `defaultBanPermanent` | yes      | boolean     | Whether the ban defaults to permanent                                                                                                                                                      |
| `defaultBanDuration`  | yes      | integer     | Default temporary ban duration in days; `0` when permanent is the default. Also the starting duration for a ban issued from the removal reasons pane when `defaultBanPermanent` is `false` |
| `banDurationPresets`  | yes      | `integer[]` | Quick-select duration buttons in the ban form (days, 1–999)                                                                                                                                |

### `SavedBanMacro`

One named ban macro in `savedBanMacros`. Choosing it in a ban form fills that form's fields; which fields apply depends on the surface. The mod button uses all of them. The removal reasons ban section uses the note and duration, since the removal message is the ban message there. The usernote popup uses the message, plus the duration for a native `BAN` label; a Toolbox note type fixes its own duration. `note` and `message` accept the same substitution tokens as `banMacros`.

```json
{
    "id": "k3j9x0aq",
    "title": "Spam - 7 days",
    "note": "spam: {url}",
    "message": "You have been banned from r/{subreddit} for 7 days for spamming.",
    "permanent": false,
    "days": 7
}
```

| Field       | Required | Type    | Description                                                                                                                                                                                                                                |
| ----------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`        | no       | string  | Stable id, assigned on normalization                                                                                                                                                                                                       |
| `title`     | yes      | string  | Name shown in the picker; entries without one are dropped                                                                                                                                                                                  |
| `note`      | yes      | string  | Internal ban note (mod log only, up to 300 characters)                                                                                                                                                                                     |
| `message`   | yes      | string  | Message sent to the banned user (up to 999 characters)                                                                                                                                                                                     |
| `permanent` | yes      | boolean | Whether the ban is permanent; when `true`, `days` is ignored                                                                                                                                                                               |
| `days`      | yes      | integer | Temporary ban length in days, clamped to 1-999                                                                                                                                                                                             |
| `removeAll` | no       | boolean | Also remove all the user's posts and comments in the subreddit. Permanent macros only (dropped from a temporary one on normalization); the mod button and removal reasons ban forms act on it, the usernote and native note ones ignore it |

## Substitution tokens

Removal reason text, headers, footers, log titles, and macro text support substitution tokens. These are bare `{word}` tokens with no colon — distinct from the interactive brace tokens described in [v2 vs v1](#v2-vs-v1).

| Token          | Replaced with                                                                  |
| -------------- | ------------------------------------------------------------------------------ |
| `{author}`     | Username of the post or comment author                                         |
| `{subreddit}`  | Name of the subreddit                                                          |
| `{kind}`       | `"submission"` or `"comment"`                                                  |
| `{title}`      | Title of the post                                                              |
| `{url}`        | Permalink to the removed post or comment                                       |
| `{permalink}`  | Same as `{url}`                                                                |
| `{domain}`     | Domain the post links to                                                       |
| `{mod}`        | Username of the moderator sending the removal                                  |
| `{body}`       | Body of the removed item, quoted as markdown (lines prefixed with `>`)         |
| `{fullname}`   | Reddit fullname of the removed item (e.g. `t3_abc123`)                         |
| `{id}`         | Short base-36 id of the removed item                                           |
| `{link}`       | URL the post links to                                                          |
| `{raw_body}`   | Body without markdown quoting                                                  |
| `{uri_body}`   | URL-encoded body, for use inside markdown links                                |
| `{uri_title}`  | URL-encoded title, for use inside markdown links                               |
| `{modmail}`    | `https://www.reddit.com/message/compose?to=/r/<subreddit>`                     |
| `{wiki: page}` | `https://www.reddit.com/r/<subreddit>/wiki/page` (`page#anchor` for a section) |

`{modmail}` and `{wiki: page}` are expanded from the subreddit by the substitution step itself (`replaceTokens`), so they work in every context above, and they're the one substitution token that takes an argument. Unknown `{…}` content (no colon, no match) is left in the text untouched.

## v2 vs v1

**No encoding.** v1 stores removal reason text, the removal header/footer, and macro text `escape()`-encoded because 6.x `unescape()`s them unconditionally on read. v2 stores every string as plain text. (`normalizeConfig` only URI-decodes configs with `ver < 2`, so a literal `%20` in v2 text survives.)

**Interactive tokens instead of limited HTML.** v1 reason text could embed literal `<input>`, `<textarea>`, and `<select>`/`<option>` elements that the removal dialog turns into fill-in fields. v2 replaces them with brace tokens, which can't collide with reddit markdown and sit naturally beside the existing substitution tokens (`{subreddit}`, `{author}`, …, which are unchanged):

```text
{input: placeholder text}
{textarea: placeholder text}

{choice#rule}
- Your post breaks rule 1 | see [the rules](https://example.com/rules)
- Your post breaks rule 2

This is a [{choice: repost | duplicate}](https://example.com/wiki/reposts).

{highlight#imagerules}
- [ ] be original content you created
- [x] include the source in the title

It was also {check: missing a source}.
```

A pick-one `{choice}` field comes in two forms, and its options always live in the reason text. The **block** form puts the marker on its own line with a markdown list of options below it; a `|` in a block option is plain text. The **inline** form, `{choice: a | b}`, sits inside a line (mid-sentence, or as a link's text) and separates its options with `|`, with `\|` for a literal pipe. Either way the picked option replaces the field exactly where it sits.

The tick-box fields `{multi}` and `{highlight}` have no v1 counterpart. They take the block form with a GFM task list (`- [ ] item`, or `- [x] item` to start ticked) and are sent as a `-` list: `{multi}` sends only the ticked items, `{highlight}` sends every item and bolds the ticked ones. Inline, `{check: text}` sends its text only when ticked and `{highlight: text}` bolds its text when ticked. A marker followed by the other style of list (plain items under a tick-box marker, task items under `{choice}`) is not a field and is sent as written.

Each token may carry an optional stable id used to persist the entered or chosen value between overlay opens: `{input#flightnum: Flight number}`, `{choice#rule}`, `{choice#kind: a | b}`. A choice's id maps to the HTML `id` attribute of its `<select>` on the v1 mirror. Token content cannot contain braces (the serializer substitutes parens), and option line breaks collapse to spaces because legacy options are single-line.

The codec for both directions lives in `extension/data/util/wiki/schemas/shared/tokens.ts`. Conversion notes:

- `<br>` becomes a paragraph break (`\n\n`); the v1 mirror keeps plain newlines, which 6.x handles fine.
- A `<select>` on a line of its own becomes a `{dropdown}` block; one that shares its line with other text becomes an inline `{dropdown: ...}` in the same place, matching how 6.x showed it. Both forms of `{choice}` and `{dropdown}` down-convert to a `<select>` where they stand, marked `data-tbx-choice="1"` or `data-tbx-dropdown="1"` (6.x ignores and keeps both), so each reads back as what it was. An unmarked two-option `<select>` that fakes a tick box reads as an inline `{choice}` and is then promoted (below). The config reconcile treats `{choice}` and `{dropdown}` as equal when comparing the mirror, because mirrors written before the `data-tbx-choice` mark read every choice back as a dropdown.
- A legacy `<option value="x">label</option>` keeps `x` (the value is what 6.x inserted into the removal message); the label is dropped.
- The older v2 `selects` array (referenced as `{select:name}`) is folded into the text as `{choice}` blocks on normalize and never written.
- A `{note: text}` down-converts to `<input id="tbx-note" placeholder="text">` and reads back as a note; a required `!` becomes a `required="required"` attribute and reads back from one (with or without a value).
- `{modmail}` and `{wiki: page}` down-convert to their URLs with `{subreddit}` left in for 6.x to fill (in reasons, header, footer, mod macros, and ban macros), and normalize turns those URLs back into tokens.
- Each tick-box item down-converts to a `<select>` of its two outputs (`a` / `**a**` for `highlight`, empty / `a` for `check` and `multi`), the starting one first; a block becomes one `- <select>` line per item. On normalize, any inline choice with that two-option shape becomes the tick-box token, which also converts 6.x configs that faked highlighting with one plain/bold `<select>` per line.

**Stable entry ids.** Every removal reason, mod macro, and suggested-reason mapping carries an `id` (eight base-36 characters, unique across all three lists). Ids are assigned by the editing UI on create and backfilled by `ensureStableIds` during normalization; they are stripped from the v1 mirror (6.x rebuilds entries wholesale on save, so they wouldn't survive there anyway — they're re-backfilled on the next normalize). They exist so reordering and cross-references don't have to rely on array indexes.

## Versioning

`ver` on the page selects the schema. `configSchema` / `configMinSchema` / `configMaxSchema` in `extension/data/util/wiki/schemas/config/schema.ts` define what a build writes and accepts. `configMigrations` is a registry of in-place upgrade steps keyed by the version each upgrades _from_; it is currently empty because the v1 → v2 upgrade has no discrete migration — its string decode and HTML-to-token conversion run unconditionally in `normalizeConfig` (the conversion doubles as self-healing for v2 pages). To bump the schema again, add a migration keyed by the version it upgrades _from_, raise `configSchema`/`configMaxSchema`, and extend `encodeClassicConfig` if the new fields need a v1 representation.
