# Modbar

**Platforms:** Old Reddit and New Reddit · **Always on**

Modbar provides a persistent toolbar at the bottom of every Reddit page with quick access to moderation queues, settings, and other Toolbox features.

## Overview

The Modbar is always on and appears on both old and new Reddit. It shows counters for pending mod queue items and unread modmail, a list of subreddits you moderate, configurable shortcut links, and a button to open the Toolbox settings overlay. The bar can be hidden by clicking the collapse arrow; it reappears on the next page load.

## Features

**Mod queue counter** — shows the current count of items in your mod queue. Clicking opens the queue.

**Unmoderated counter** — optionally shows the count of unmoderated items.

**Moderated subreddits list** — a slide-out drawer listing every subreddit you moderate, each row with direct links to that subreddit's mod tools. See [Subreddits you moderate drawer](#subreddits-you-moderate-drawer) below for the full breakdown.

**Old/New Reddit toggle** — a button to switch between `old.reddit.com` and `www.reddit.com` while preserving your current page.

**Custom shortcuts** — add named links to any URL for one-click access from the Modbar.

**Compact mode** — hides label text and shows icons only, reducing the Modbar's footprint.

**Custom CSS** — a hidden field for applying custom CSS to Toolbox UI elements.

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

| Setting                   | Default   | Description                                        |
| ------------------------- | --------- | -------------------------------------------------- |
| Compact mode              | Off       | Use icon-only compact Modbar layout _(advanced)_   |
| Show unmoderated icon     | Off       | Add an unmoderated-queue counter to the Modbar     |
| Show moderated subreddits | On        | List moderated subreddits in the Modbar            |
| Old/New Reddit toggle     | On        | Show a button to switch between old and new Reddit |
| Shortcuts                 | _(empty)_ | Named URL shortcuts shown in the Modbar            |
