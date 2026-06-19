# Proposals Schema

Proposals (training mode and second opinions) are stored on a single subreddit wiki page at `toolbox-nxg/proposals`.

## Overview

A **proposal** is a moderation action that was captured for review instead of being performed. A reviewer can accept it — which performs the real action by replaying a frozen intent — or reject it with feedback. See the [Training Mode & Second Opinions](../user-guide/modules/proposals.md) user guide for the feature itself.

Proposals are an **NXG-only feature with no Toolbox 6.x mirror.** Unlike config and usernotes, there is no classic-layout counterpart — the page exists only at the NXG path, and 6.x clients neither read nor write it. The page is restricted to moderator-only access by wiki page settings (`permlevel: 2`).

The whole subreddit lives on **one page**. Reddit's `/api/wiki/edit` honors the `previous` revision parameter (a stale write fails with HTTP 409 `EDIT_CONFLICT`) and read-after-write lag is small, so optimistic concurrency on a single page is safe; there is no sharded or bucketed layout. The path is exposed as a function (`getProposalsPagePath`) to leave room for a future bucketed layout without changing callers.

## Page format

The page holds a single JSON object, `ProposalsData`:

```json
{
    "ver": 1,
    "seq": 42,
    "proposals": {
        "k3f9q2": { ... },
        "p7m1xa": { ... }
    }
}
```

| Field       | Required | Type                       | Description                                                                                        |
| ----------- | -------- | -------------------------- | -------------------------------------------------------------------------------------------------- |
| `ver`       | yes      | integer                    | Schema version; `1` is the only version. Used by future migrations                                 |
| `seq`       | no       | integer                    | Monotonic page version, bumped by one on every committed write (see [Page version](#page-version)) |
| `proposals` | yes      | `Record<string, Proposal>` | All proposals, keyed by their stable `id` (see [`Proposal`](#proposal))                            |

The current build writes, and only accepts, schema version `1`.

### Page version

`seq` is a monotonically increasing counter bumped by one on every committed write to the page. It is distinct from `ver` (the schema version, which only changes across builds) and from Reddit's opaque wiki revision id (which is not orderable). Because it lives _in the data_, it travels with the page from any source — a fresh read, a local write, or a cross-tab broadcast — giving display caches a single lag-proof order so they never roll backward when reads arrive out of order. Legacy pages and ad-hoc literals without it are treated as `0`. A hand-edit or admin revision-restore that _lowers_ `seq` can leave an open tab showing newer-cached data until it reloads; this is outside the normal mutation flow and self-heals on reload.

## `Proposal`

Each value in `proposals` is a `Proposal`:

```json
{
    "id": "k3f9q2",
    "itemId": "t3_abc123",
    "itemKind": "post",
    "action": { "type": "remove", "spam": false },
    "proposedBy": "trainee_mod",
    "proposedAt": 1718000000,
    "source": "training",
    "note": "Looks like spam to me",
    "link": "/r/example/comments/abc123/title/",
    "status": "pending",
    "updatedAt": 1718000000
}
```

| Field             | Required | Type                   | Description                                                                                                                   |
| ----------------- | -------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `id`              | yes      | string                 | Stable, generated, collision-free id; also the map key. Not derived from item/time/mod (those collide on rapid double-clicks) |
| `itemId`          | yes      | string                 | Target identifier: a Reddit fullname (`t3_…`/`t1_…`) for post/comment actions, or the username for user-level actions         |
| `itemKind`        | yes      | `ProposalItemKind`     | `"post"`, `"comment"`, or `"user"`                                                                                            |
| `action`          | yes      | `ProposedAction`       | The captured action to replay on accept (see [`ProposedAction`](#proposedaction))                                             |
| `proposedBy`      | yes      | string                 | Username of the moderator who proposed the action                                                                             |
| `proposedAt`      | yes      | integer                | Epoch **seconds** when the proposal was created                                                                               |
| `source`          | yes      | `ProposalSource`       | Why the proposal exists: `"training"` (proposer is a trainee) or `"second-opinion"` (explicit request)                        |
| `status`          | yes      | `ProposalStatus`       | Current lifecycle status (see [Lifecycle](#lifecycle))                                                                        |
| `updatedAt`       | yes      | integer                | Epoch seconds of the last mutation to this proposal (any field)                                                               |
| `note`            | no       | string                 | Optional free-text rationale from the proposer                                                                                |
| `link`            | no       | string                 | Squashed permalink to the target, for display/linking                                                                         |
| `resolvedBy`      | no       | string                 | Username of the resolver, or a system sentinel for `obsolete`                                                                 |
| `resolvedAt`      | no       | integer                | Epoch seconds when the proposal reached a terminal status                                                                     |
| `feedback`        | no       | string                 | Rejecting reviewer's explanation (reject only)                                                                                |
| `obsoleteReason`  | no       | `ObsoleteReason`       | Why the proposal auto-resolved (obsolete only)                                                                                |
| `needsAttention`  | no       | `NeedsAttentionDetail` | Failure diagnostics (needs_attention only; see [`NeedsAttentionDetail`](#needsattentiondetail))                               |
| `replayClaim`     | no       | `ReplayClaim`          | In-flight accept claim that gates concurrent accepts (see [`ReplayClaim`](#replayclaim))                                      |
| `ackedByProposer` | no       | boolean                | Whether the proposer has acknowledged the outcome. Gates pruning (see [Pruning](#pruning))                                    |

All timestamps are epoch **seconds** (note: seconds, not milliseconds).

### `ProposalItemKind`

What the proposal targets, and therefore how `itemId` reads:

| Value     | `itemId` is        |
| --------- | ------------------ |
| `post`    | a post fullname    |
| `comment` | a comment fullname |
| `user`    | a username         |

## Lifecycle

`status` moves through a small state machine:

| Status            | Meaning                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `pending`         | Awaiting review                                                                                               |
| `accepted`        | A reviewer accepted it **and** the real action replay fully succeeded                                         |
| `rejected`        | A reviewer declined it (optionally with `feedback`)                                                           |
| `obsolete`        | Auto-resolved without a verdict because the target went away or was actioned elsewhere (see `obsoleteReason`) |
| `needs_attention` | An accept was attempted but replay failed partway; carries `needsAttention` so a reviewer can decide on retry |

**Allowed transitions:**

- `pending` → any other status.
- `needs_attention` → `accepted` (retry succeeded), `rejected`, or `obsolete`.
- `accepted`, `rejected`, and `obsolete` are **terminal** — they never transition again.

`needs_attention` is deliberately **not** terminal. The mutation layer enforces these transitions, so a stale write against an already-resolved proposal fails with a typed result rather than silently overwriting a verdict.

### `ObsoleteReason`

Set only when `status` is `obsolete`:

| Value              | Meaning                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deleted`          | The author deleted the target (reliably detectable)                                                                                                      |
| `already-actioned` | The target was approved/removed outside the proposal flow. Persisted only on strong (modlog-derived) evidence — never on best-effort `getInfoBulk` flags |

### `NeedsAttentionDetail`

Recorded when an accept attempt fails partway through replay; present only when `status` is `needs_attention`:

| Field                    | Type    | Description                                                                                                            |
| ------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `attemptedBy`            | string  | Username of the moderator who attempted the accept                                                                     |
| `attemptedAt`            | integer | Epoch seconds when the attempt happened                                                                                |
| `failedStep`             | string  | Which replay step failed (e.g. `"removeThing"`, `"sendRemovalMessage"`)                                                |
| `irreversibleSideEffect` | boolean | Whether an irreversible side effect already landed before the failure — tells a reviewer whether a naive retry is safe |
| `error`                  | string  | Human-readable error text from the failed step                                                                         |

### `ReplayClaim`

A short-lived claim a reviewer writes onto a proposal in the same atomic wiki write that begins an accept, immediately before the action is replayed. Two reviewers accepting the same proposal would otherwise both replay the (often irreversible) side effect before either marked it accepted; persisting the claim turns the conditional wiki write into a compare-and-set that lets only one in. It is cleared when the proposal resolves or the claim is released.

| Field | Type    | Description                                  |
| ----- | ------- | -------------------------------------------- |
| `by`  | string  | Username of the reviewer who holds the claim |
| `at`  | integer | Epoch seconds when the claim was placed      |

A claim older than the **replay-claim TTL** (300 seconds) is treated as absent, so a crashed or abandoned accept frees the proposal for retry without manual repair. A normal accept always clears its own claim — on success, on failure (→ `needs_attention`), and on explicit release — so the TTL only governs the hard-crash case (the holding tab dies between claiming and resolving). The window is set well above any plausible worst-case replay rather than tuned tight: erring long only delays retry of a genuinely-crashed accept, which is strictly safer than ever acting twice.

## `ProposedAction`

The captured action, a union discriminated by `type`. Thing-targeted actions (`itemId` is a fullname): `approve`, `remove`, `removal-reason`, `lock`, `unlock`, `distinguish`, `marknsfw`, `sticky`. User-targeted actions (`itemId` is a username): `ban`, `unban`, `mute`, `unmute`, `userflair`.

Each action also carries a replay class — **atomic** (replayed inline by a single moderation primitive) or **composite** (a multi-step pipeline replayed through a registered handler). `removal-reason` is the only composite; every other type is atomic.

| `type`           | Extra fields                                                | Description                                                               |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| `approve`        | —                                                           | Approve the target                                                        |
| `remove`         | `spam: boolean`                                             | Remove the target, optionally as spam                                     |
| `removal-reason` | `intent: FrozenRemovalIntent`                               | Remove via the full removal-reasons composite (see below)                 |
| `lock`           | —                                                           | Lock the target thing                                                     |
| `unlock`         | —                                                           | Unlock the target thing                                                   |
| `distinguish`    | `sticky: boolean`                                           | Distinguish the target thing, optionally stickied                         |
| `marknsfw`       | `nsfw: boolean`                                             | Mark the target post NSFW (`nsfw: false` unmarks it)                      |
| `sticky`         | `state: boolean`, `num?: integer`                           | Sticky the target submission into a slot, or unsticky it (`state: false`) |
| `ban`            | `ProposedBan` fields                                        | Ban the target user (see [`ProposedBan`](#proposedban))                   |
| `unban`          | —                                                           | Unban the target user                                                     |
| `mute`           | `ProposedMute` fields                                       | Mute the target user (see [`ProposedMute`](#proposedmute))                |
| `unmute`         | —                                                           | Unmute the target user                                                    |
| `userflair`      | `text?: string`, `cssClass?: string`, `templateID?: string` | Set the target user's flair (each field present only when captured)       |

### `ProposedBan`

```json
{
    "type": "ban",
    "permanent": false,
    "days": 7,
    "note": "repeated spam",
    "message": "You have been banned for 7 days.",
    "context": "t3_abc123"
}
```

| Field       | Required | Type    | Description                                              |
| ----------- | -------- | ------- | -------------------------------------------------------- |
| `permanent` | yes      | boolean | Permanent ban (ignores `days`)                           |
| `days`      | yes      | integer | Duration in days when not permanent                      |
| `note`      | yes      | string  | Mod note (private)                                       |
| `message`   | yes      | string  | Ban message sent to the user                             |
| `context`   | no       | string  | Fullname of the thing that prompted the ban, for context |

### `ProposedMute`

```json
{
    "type": "mute",
    "duration": 28,
    "note": "modmail abuse"
}
```

| Field      | Required | Type    | Description                                                               |
| ---------- | -------- | ------- | ------------------------------------------------------------------------- |
| `duration` | no       | integer | Mute duration in days. Reddit's mute is fixed-length; stored for fidelity |
| `note`     | no       | string  | Mod note (private)                                                        |

### `FrozenRemovalIntent`

The fully-rendered, post-templating intent for a `removal-reason` proposal. Replay reconstructs the removal submission params from this and hands them back to the removal pipeline. It stores **resolved values** (a reason can be edited or deleted between propose and accept, so reason ids are not re-resolved), but is **hand-curated to only what replay needs**: empty/default fields are omitted, and the optional steps (flair, usernote, ban, log) are nested and present only when used. The item's own metadata (author, permalink, kind) is **not** stored — it is re-fetched from the proposal's `itemId` at replay time, since the item still exists until the proposal is accepted.

| Field                      | Required | Type                     | Description                                                                                                                                                     |
| -------------------------- | -------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reasonText`               | yes      | string                   | Final composed reason text, with header/footer and tokens already applied                                                                                       |
| `reasonTitle`              | no       | string                   | Display title(s) of the selected reason template(s), joined with `", "`, shown to the reviewer; omitted when no selected reason has a title                     |
| `reasonType`               | yes      | `FrozenReasonType`       | Delivery mode: `"reply"`, `"pm"`, `"both"`, or `"none"`                                                                                                         |
| `subject`                  | yes      | string                   | PM/modmail subject line (used for pm/modmail/ban delivery)                                                                                                      |
| `logSub`                   | no       | string                   | Log subreddit to cross-post the removal to; only when removal logging is on                                                                                     |
| `baseLogTitle`             | no       | string                   | Log post title (before `{reason}` substitution); only when a log sub is set                                                                                     |
| `logReasonText`            | no       | string                   | Public log reason substituted into `{reason}`; only when used                                                                                                   |
| `flair`                    | no       | `FrozenRemovalFlair`     | Flair to apply (`text`, `cssClass`, `templateId`); omitted when no flair                                                                                        |
| `reasonSticky`             | no       | boolean                  | Sticky the removal reply comment; omitted when false                                                                                                            |
| `reasonAsSub`              | no       | boolean                  | Send PM delivery via modmail as the subreddit; omitted when false                                                                                               |
| `reasonAutoArchive`        | no       | boolean                  | Auto-archive the removal modmail conversation; omitted when false                                                                                               |
| `reasonCommentAsSubreddit` | no       | boolean                  | Post the removal reply as the subreddit (vs the mod); omitted when false                                                                                        |
| `actionLockThread`         | no       | boolean                  | Lock the removed thread; omitted when false                                                                                                                     |
| `actionLockComment`        | no       | boolean                  | Lock the removal reply comment; omitted when false                                                                                                              |
| `usernote`                 | no       | `FrozenRemovalUsernote`  | Usernote to leave (`text`, `type?`, `includeLink?`, `includeMessage?`); omitted when none                                                                       |
| `ban`                      | no       | `FrozenRemovalBan`       | Ban to issue (`permanent`, `days`, `note`); omitted when not banning                                                                                            |
| `selection`                | no       | `FrozenRemovalSelection` | The trainee's structured reason selection, captured purely to re-seed the overlay on **Edit & accept** (see below); omitted on captures that predate this field |

#### `FrozenRemovalSelection`

Additive metadata stored alongside `reasonText` so a reviewer can re-open the full removal overlay pre-filled with exactly what the trainee composed ("Edit & accept"). Replay, display, and plain Accept use `reasonText` and never touch this; when it is absent, Edit & accept falls back to plain Accept.

| Field           | Required | Type                      | Description                                                                          |
| --------------- | -------- | ------------------------- | ------------------------------------------------------------------------------------ |
| `reasons`       | yes      | `FrozenSelectionReason[]` | Selected reasons in display order                                                    |
| `includeHeader` | no       | boolean                   | Whether the configured header was included; present only when a header is configured |
| `includeFooter` | no       | boolean                   | Whether the configured footer was included; present only when a footer is configured |

Each `FrozenSelectionReason` carries the persistent reason `id` (so the overlay can re-check it against current config), the resolved per-reason `text` (fill-in tokens substituted, inline edits applied), and an optional display `title`.

| Field   | Required | Type   | Description                                                            |
| ------- | -------- | ------ | ---------------------------------------------------------------------- |
| `id`    | yes      | string | Persistent `RemovalReason.id` of the selected template                 |
| `text`  | yes      | string | Resolved per-reason message body (fill-in substitution / inline edit)  |
| `title` | no       | string | The reason's display title, for the overlay/preview; omitted when none |

## Pruning

A resolved proposal is kept until it is acknowledged or ages out:

- A terminal proposal (`accepted`/`rejected`/`obsolete`) is pruned once its proposer sets `ackedByProposer` (the "Dismiss" action), **or** once `proposalRetentionDays` (a per-subreddit config value, default 14) has elapsed since it resolved.
- `pending` proposals are never pruned.

The retention window is configured per subreddit; see `proposalRetentionDays` in the [Subreddit Config Schema](config.md).

## Writing proposals

The proposals page must have moderator-only edit permissions (`permlevel: 2`). Writers must use optimistic concurrency: pass the current revision as `previous` to `/api/wiki/edit` and retry on a `409 EDIT_CONFLICT`. Preserve proposals and unknown fields you did not author rather than rewriting the whole `proposals` map, and respect the transition rules above — do not move a terminal proposal to another status.
