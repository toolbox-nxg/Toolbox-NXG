# Mod Macros

**Platforms:** Old Reddit and New Reddit · **Default:** Enabled

Mod Macros injects macro selectors into reply areas, letting moderators quickly insert pre-written responses with optional attached actions.

## Overview

Macros are configured per-subreddit in the Config overlay (Mod Macros tab). Each macro has a title, message text, and a set of optional actions that fire when the macro is sent. They appear as a dropdown inside comment reply boxes on post and comment pages. On new Reddit modmail, macros appear via the [Modmail](modmail.md) module's composer integration.

Macro text supports the same substitution tokens as removal reasons.

## Features

**Macro picker in reply areas** — a dropdown next to the reply box lets you pick a macro, preview its rendered text, and post it.

**Live preview** — when enabled, shows a formatted preview of the macro message as you type overrides into it.

**Modmail support** — macros marked with `contextmodmail: true` (the default) appear in the macro picker inside the modmail composer on new Reddit.

**Context filtering** — each macro can be restricted to post contexts, comment contexts, or modmail contexts, or any combination.

## Macro actions

Each macro can include any combination of the following actions, which fire at send time:

| Action                        | Effect                                                     |
| ----------------------------- | ---------------------------------------------------------- |
| `remove`                      | Remove the target item                                     |
| `approve`                     | Approve the target item                                    |
| `spam`                        | Remove as spam                                             |
| `ban` / `unban`               | Ban or unban the author                                    |
| `mute`                        | Mute the author in modmail                                 |
| `userflair` / `userflairtext` | Apply a flair template to the author                       |
| `lockthread`                  | Lock the target post or comment thread                     |
| `lockreply`                   | Lock the macro reply comment                               |
| `sticky`                      | Sticky the macro reply (top-level comments only)           |
| `distinguish`                 | Distinguish the reply as a moderator comment               |
| `replyassubreddit`            | Post as the subreddit ModTeam via official removal message |
| `archivemodmail`              | Archive the modmail thread after sending                   |
| `highlightmodmail`            | Highlight the modmail thread                               |

## Substitution tokens

Macro text can include tokens that are replaced with contextual values at send time:

| Token         | Value                               |
| ------------- | ----------------------------------- |
| `{subreddit}` | Subreddit name                      |
| `{author}`    | Username of the post/comment author |
| `{mod}`       | Username of the acting moderator    |
| `{title}`     | Post title                          |
| `{url}`       | Post URL                            |
| `{permalink}` | Permalink to the item               |
| `{domain}`    | Link domain                         |
| `{body}`      | Post or comment body text           |

## Settings

| Setting            | Default | Description                                         |
| ------------------ | ------- | --------------------------------------------------- |
| Show macro preview | On      | Show a preview of the macro message while composing |
