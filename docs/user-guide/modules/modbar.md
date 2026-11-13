# Modbar

**Platforms:** Old Reddit and New Reddit · **Always on**

Modbar provides a persistent toolbar at the bottom of every Reddit page with quick access to moderation queues, settings, and other Toolbox features.

## Overview

The Modbar is always on and appears on both old and new Reddit. It shows counters for pending mod queue items and unread modmail, a list of subreddits you moderate, configurable shortcut links, and a button to open the Toolbox settings overlay. The bar can be hidden by clicking the collapse arrow; it stays hidden on later page loads until you click the arrow again to show it. Collapsing or expanding the bar applies to every open Reddit tab, not just the current one. The collapsed button sits on the same side of the screen as the context menu (see the **Context menu location** setting in General Settings).

## Features

**Mod queue counter** — shows the current count of items in your mod queue. Clicking opens the queue.

**Unmoderated counter** — optionally shows the count of unmoderated items.

**Moderated subreddits list** — a slide-out drawer listing every subreddit you moderate, each row with direct links to that subreddit's mod tools. See [Subreddits you moderate drawer](#subreddits-you-moderate-drawer) below for the full breakdown.

**Recent actions** — a slide-out drawer of recent moderator actions across your subreddits. Can be turned off with **Show recent actions**.

**Old/New Reddit toggle** — a button to switch between `old.reddit.com` and `www.reddit.com` while preserving your current page.

**Custom shortcuts** — add named links to any URL for one-click access from the Modbar.

**Beta version label** — beta builds show their version in the Modbar, which you can click to copy for bug reports. Turning the label off (an advanced setting) replaces it with a reminder popup that appears once in each new tab until you close it, so you don't forget you're on a beta.

**Compact mode** — shows the collapsed Modbar as a small dot-menu button instead of the arrow, without the hover tooltip of queue counts. Like the normal bar, it remembers whether you last left it collapsed or expanded.

## Subreddits you moderate drawer

Opened from the Modbar's "subreddits you moderate" button (shown when **Show moderated subreddits** is enabled), this drawer slides out and lists every subreddit you moderate. It gives one-click access to each subreddit's mod tools without leaving the page you're on.

**Filter box** — a text field at the top filters the list as you type (case-insensitive substring match on the subreddit name). A counter beside it shows how many subreddits currently match. The field is focused automatically when the drawer opens.

**Color-coded rows** — each row has a colored accent bar on its left edge, derived from the subreddit name so the same subreddit is always the same color, making long lists easier to scan.

**Per-subreddit action links** — every row carries a set of action icons:

| Icon        | Action                                                                             |
| ----------- | ---------------------------------------------------------------------------------- |
| Mod queue   | Opens `/r/<sub>/about/modqueue`. Prefixed with a bracketed item count (see below). |
| Unmoderated | Opens `/r/<sub>/about/unmoderated`.                                                |
| Mod log     | Opens `/r/<sub>/about/log`.                                                        |
| Traffic     | Opens `/r/<sub>/about/traffic`.                                                    |
| Usernotes   | Opens the subreddit's usernotes (only when the Usernotes module is enabled).       |
| Config      | Opens the subreddit's Toolbox config (only when the Config module is enabled).     |

The subreddit name itself is also a link to `/r/<sub>`. The queue and unmoderated links open in a new tab by default; if the [Queue Overlay](queue-overlay.md) module is active it can intercept the click and open the queue inline instead (hold <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> to force a normal new-tab navigation).

**Modqueue item count** — each mod queue icon is prefixed with a bracketed count, e.g. `[5]`, matching the bracketed counters shown on the Modbar itself. Subreddits with an empty queue show `[0]`. The count is fixed-width and right-aligned so the icons line up in a column down the drawer. These counts are bucketed from the Notifier's existing aggregate modqueue listing, so no extra requests are made — the counts share that listing's fetch limit and only cover the subreddits in the Notifier's configured multireddit (subreddits outside it show `[0]`).

## Settings

| Setting                   | Default   | Description                                                                                                  |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| Compact mode              | Off       | Collapse the Modbar to a small dot-menu button _(advanced)_                                                  |
| Show counts               | On        | Show the number badges beside the queue and modmail icons                                                    |
| Show beta version label   | On        | Show the version label on beta builds; when off, a reminder popup shows in each new tab instead _(advanced)_ |
| Show unmoderated icon     | Off       | Add an unmoderated-queue counter to the Modbar                                                               |
| Show moderated subreddits | On        | List moderated subreddits in the Modbar                                                                      |
| Show recent actions       | On        | Show the Recent Actions button in the Modbar                                                                 |
| Old/New Reddit toggle     | On        | Show a button to switch between old and new Reddit                                                           |
| Shortcuts                 | _(empty)_ | Named URL shortcuts shown in the Modbar                                                                      |
