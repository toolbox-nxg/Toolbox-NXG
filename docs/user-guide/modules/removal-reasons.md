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

## Settings

| Setting                              | Default       | Description                                                                                                         |
| ------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Enable comment removal reasons       | Off           | Show removal reasons when removing comments                                                                         |
| Always show empty removal box        | Off           | Show the dialog even for subreddits with no configured reasons                                                      |
| Display mode                         | Drawer        | Show reasons as a side drawer or legacy popup                                                                       |
| Silent removal for deleted users     | Off           | Skip the dialog and silently remove deleted-user content                                                            |
| Reply method                         | Comment reply | How the removal message is sent (comment, PM, both, or none)                                                        |
| Send as subreddit                    | Off           | Send removal messages as the subreddit account                                                                      |
| Auto-archive sent PM                 | Off           | Archive the removal PM after sending                                                                                |
| Sticky removal comment               | Off           | Sticky the removal reason comment                                                                                   |
| Reply as /u/subreddit-ModTeam        | Off           | Send removal comment as ModTeam account                                                                             |
| Lock thread after removal            | Off           | Lock the thread when removing                                                                                       |
| Lock removal comment                 | Off           | Lock the removal reason comment                                                                                     |
| Disable remove button after removal  | Off           | Grey out the remove button after an item is removed                                                                 |
| Pre-select suggested removal reasons | On            | Pre-select reasons mapped from an item's reports, and flag matching items with "(suggestions)" on the remove button |
