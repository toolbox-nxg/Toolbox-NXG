# Removal Reasons

**Platforms:** Old Reddit and New Reddit · **Default:** Enabled

Removal Reasons wires up the removal button to display a dialog with your subreddit's configured removal reasons, letting you select a reason and send a removal message to the author in one step.

## Overview

When you click the remove button on a post or comment, Removal Reasons intercepts the action and shows a panel listing your subreddit's configured reasons. Select one, fill in any interactive fields, and confirm — the item is removed and the message is sent in the configured reply method. If a subreddit has no removal reasons configured, Removal Reasons can still show an empty box for a custom message.

Removal reasons are configured per-subreddit in the Config overlay (Removal Reasons tab).

## Features

**Drawer or popup display** — the removal reason dialog can appear as a side drawer (default) or a modal popup. The drawer keeps the removed content visible alongside the dialog.

**Interactive fill-in fields** — reasons can include `{input:…}`, `{textarea:…}`, and `{select:…}` tokens that become fill-in fields in the dialog (see [Removal reason format](#removal-reason-format)).

**Substitution tokens** — reason text is processed for substitution tokens (`{author}`, `{subreddit}`, etc.) before sending.

**Multiple reply methods** — configure per-subreddit whether the removal message is sent as a comment reply, a PM, both, or only logged to the log subreddit.

**Send as subreddit** — optionally send the removal message as the subreddit account.

**Auto-archive PM** — optionally archive the removal PM after sending.

**Sticky and distinguish** — optionally sticky and/or distinguish the removal comment.

**Reply as ModTeam** — send the removal comment as /u/subreddit-ModTeam.

**Lock thread after removal** — optionally lock the post or comment thread at the same time.

**Comment reasons** — optionally enable removal reasons for comments, not just posts.

**Silent removal for deleted users** — skip the removal dialog and silently remove items authored by deleted accounts.

**Suggested removal reasons** — map report text to removal reasons so the right reasons are pre-selected when you open the overlay on a reported item (see [Suggested removal reasons](#suggested-removal-reasons)).

**Sync Reddit's removal reasons** — import the removal reasons configured in Reddit's own Mod Tools and keep them up to date, so you only maintain them in one place (see [Syncing Reddit's removal reasons](#syncing-reddits-removal-reasons)).

**Fall back to Reddit's removal reasons** — in subreddits with no toolbox reasons at all, offer Reddit's native ones rather than nothing (see [Falling back to Reddit's removal reasons](#falling-back-to-reddits-removal-reasons)).

## Removal reason format

Reason text supports two kinds of tokens:

### Substitution tokens

These are replaced with contextual values before the message is sent:

| Token         | Value                                 |
| ------------- | ------------------------------------- |
| `{subreddit}` | Subreddit name                        |
| `{author}`    | Username of the removed item's author |
| `{mod}`       | Username of the acting moderator      |
| `{title}`     | Post title                            |
| `{url}`       | Post URL                              |
| `{permalink}` | Permalink to the post or comment      |
| `{domain}`    | Link domain                           |
| `{body}`      | Post or comment body text             |

### Interactive tokens

These become fill-in fields in the removal dialog:

| Token                     | Result                                                         |
| ------------------------- | -------------------------------------------------------------- |
| `{input: placeholder}`    | Single-line text field                                         |
| `{textarea: placeholder}` | Multi-line text field                                          |
| `{select:name}`           | Dropdown menu; options defined in the reason's `selects` array |

A stable field ID can be appended for persistence between dialog opens: `{input#flightnum: Flight number}`.

## Suggested removal reasons

Suggested removal reasons connect the reports on a queue item to your removal reasons. When you open the removal overlay on an item whose report matches one of your mappings, the mapped reason(s) are **pre-selected** for you — you can remove with one confirm, adjust the selection first, or clear the suggestions entirely.

You configure mappings per-subreddit in the Config overlay, on the **Suggested removal reasons** tab. Each mapping has:

- **When a report contains** — the text to look for in a report, matched as a case-insensitive substring. AutoMod is the common case, so you can pick a reason straight from your AutoMod config with the **Insert from AutoMod…** dropdown next to the field.
- **Suggest these removal reason(s)** — one or more of your configured removal reasons to pre-select when the pattern matches.
- **Also match user reports** — off by default. Reports filed by any moderator or bot always match; enable this to also match reports filed by users (both rule selections and free-text reports).

Each mapping is its own card with its own **Save mapping** button; use **Add new suggestion** at the bottom to create one. Removal reasons must already exist (on the _Edit removal reasons_ tab) before you can map reports to them.

In the queue and overlay:

- The toolbox remove button reads **remove (suggestions)** on items that have a matching suggestion, so you can tell at a glance before opening the overlay.
- Inside the overlay, suggested reasons are pre-checked and marked with a **Suggested** badge, and a notice at the top lets you **Clear suggested** in one click.

Pre-selection is a personal preference: turn off **Pre-select suggested removal reasons** in this module's settings to ignore mappings entirely (no pre-selection and no "(suggestions)" label), without changing the subreddit's configuration.

## Syncing Reddit's removal reasons

Reddit has its own removal reasons, configured in **Mod Tools → Removal Reasons**. If your subreddit already maintains them there, toolbox can import them instead of making you write everything out a second time.

Turn on **Keep toolbox removal reasons in sync with Reddit's** under _Removal reasons settings_ in the toolbox config editor. Imported reasons then appear alongside your own, marked with a **Native** chip.

**What Reddit owns, and what you own.** The sync is one way. Reddit owns each imported reason's **title** and **message** — both are read-only in the toolbox editor, and any change you make in Mod Tools replaces them on the next sync. Everything else belongs to toolbox and is preserved across syncs:

- post flair to apply on removal
- the default usernote and note type
- whether the reason applies to posts, comments, or both

So the normal workflow is to write the wording in Mod Tools and attach the toolbox-only extras here.

**Staying in sync.** Toolbox re-checks in the background when you open the removal drawer or the config editor, at most once every 15 minutes per subreddit, and only writes when something actually changed upstream. Because the check happens in the background, an edit you just made in Mod Tools usually appears the _next_ time you open the drawer. Press **Sync from Reddit** in the _Edit removal reasons_ footer to pull changes immediately.

Two times are shown under the setting, and they mean different things. **Last imported a change** is the last time a sync actually brought something across; an old date there just means Reddit's reasons have not changed since, which is the normal state for a settled subreddit. **Last checked** is the last time your browser read Reddit's list at all, so it keeps moving even when nothing changes — that is the one to look at to confirm syncing is working. It is local to you, so a moderator who has not opened the subreddit recently will see an older time than a colleague who has.

If a background sync fails — Reddit is unreachable, or your account cannot edit the config wiki page — the failure is reported here in red, with what went wrong and when. Background syncing never interrupts a removal to tell you, so this is where a persistently broken sync shows up. The message clears itself as soon as a run succeeds.

A failure to _write_ is treated as the more serious kind, because the usual cause is an account without the **wiki** moderator permission, which will not fix itself. Toolbox stops retrying that subreddit for half a day rather than re-checking every 15 minutes to fail the same way. A failure to _read_ is assumed to be a passing network problem and retries normally. **Sync from Reddit** ignores the backoff, so once the permission is granted you can retry straight away.

**Deleting.** Deleting a reason in Mod Tools removes the toolbox copy on the next sync. Deleting an imported reason in the toolbox editor keeps it out — it will not be re-imported — but leaves it untouched on Reddit.

**Turning it off.** Switching **Keep toolbox removal reasons in sync with Reddit's** back off removes the imported reasons from toolbox, along with any flair and usernote settings you attached to them. Your hand-written reasons are untouched, and nothing changes on Reddit's side. Toolbox asks for confirmation first, and tells you how many reasons will go.

This is also how you undo a deletion you did not mean: turn syncing off and then on again, and the whole set is imported afresh, including anything you had previously deleted.

**Removals are recorded in Reddit's mod log.** Because an imported reason keeps its link to Reddit's reason, removing something with it also registers that reason against the item in Reddit's own mod log, which a hand-written toolbox reason does not do.

```{note}
Imported reasons are not written to the legacy toolbox 6.x config page, so moderators still using toolbox 6.x will not see them. If every reason in your subreddit is imported, 6.x users will see no removal reasons at all.
```

```{note}
A subreddit that pulls its removal reasons from another subreddit (the **Get reasons from** advanced setting) is never synced into — its own reason list is unused. Turn syncing on in the source subreddit instead.
```

## Falling back to Reddit's removal reasons

Syncing is something a subreddit opts into, and it writes to that subreddit's config. The fallback is the opposite: it is your own setting, it changes nothing for anyone else, and it needs no configuration at all.

In a subreddit that has **no** toolbox removal reasons, the overlay offers Reddit's native ones instead of coming up empty. This is on by default; turn off **Use Reddit's removal reasons as a fallback** in this module's settings to go back to the empty box.

It is deliberately either/or — you never see toolbox reasons and native ones mixed together. As soon as a subreddit has a single toolbox reason configured, the fallback stops applying there and syncing becomes the way to combine the two.

Because there is no toolbox config behind them, fallback reasons are more limited than configured ones:

- they are read-only, and cannot be reordered or edited from the overlay
- no header, footer, or custom modmail subject is applied to the message
- no post flair is applied, and no removal is written to a removal-log subreddit

As with imported reasons, removing something with a native reason registers that reason against the item in Reddit's own mod log.

## Settings

| Setting                                    | Default       | Description                                                                                                         |
| ------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Enable comment removal reasons             | Off           | Show removal reasons when removing comments                                                                         |
| Always show empty removal box              | Off           | Show the dialog even for subreddits with no configured reasons                                                      |
| Use Reddit's removal reasons as a fallback | On            | Offer Reddit's native removal reasons in subreddits that have no toolbox reasons                                    |
| Display mode                               | Drawer        | Show reasons as a side drawer or legacy popup                                                                       |
| Silent removal for deleted users           | Off           | Skip the dialog and silently remove deleted-user content                                                            |
| Reply method                               | Comment reply | How the removal message is sent (comment, PM, both, or none)                                                        |
| Send as subreddit                          | Off           | Send removal messages as the subreddit account                                                                      |
| Auto-archive sent PM                       | Off           | Archive the removal PM after sending                                                                                |
| Sticky removal comment                     | Off           | Sticky the removal reason comment                                                                                   |
| Reply as /u/subreddit-ModTeam              | Off           | Send removal comment as ModTeam account                                                                             |
| Lock thread after removal                  | Off           | Lock the thread when removing                                                                                       |
| Lock removal comment                       | Off           | Lock the removal reason comment                                                                                     |
| Disable remove button after removal        | Off           | Grey out the remove button after an item is removed                                                                 |
| Pre-select suggested removal reasons       | On            | Pre-select reasons mapped from an item's reports, and flag matching items with "(suggestions)" on the remove button |
