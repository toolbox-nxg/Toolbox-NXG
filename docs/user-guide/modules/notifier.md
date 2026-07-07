# Notifier

**Platforms:** Old Reddit and New Reddit · **Default:** Always enabled

The Notifier polls Reddit periodically and shows browser notifications when there are new items in the mod queue or unread modmail.

## Overview

Notifier runs in the background while you have Reddit open in any tab. It compares current queue and modmail counts against the last-seen values and triggers a notification when the count increases. Notifications use the OS notification system by default (configurable in [General Settings](general.md)).

This poll is also what feeds the counters in the [Modbar](modbar.md), so the module is always
enabled and has no on/off switch of its own. To stop the notifications while keeping the modbar
counters up to date, turn off **Show notifications** instead.

## Features

**Mod queue notifications** — notifies you when new items appear in your mod queue.

**Unmoderated queue notifications** — optionally notifies you when the unmoderated queue grows.

**Modmail notifications** — notifies you when new modmail arrives.

**Consolidated notifications** — instead of one notification per item, a single "X new items" notification is shown.

**Configurable subreddits** — specify a multireddit (or `mod` for all moderated subs) for each counter independently.

**Adjustable polling interval** — set how often Notifier checks for new activity, in minutes.

## Settings

| Setting                         | Default | Description                                                                 |
| ------------------------------- | ------- | --------------------------------------------------------------------------- |
| Modqueue subreddits             | mod     | Multireddit to watch for the mod queue counter                              |
| Unmoderated subreddits          | mod     | Multireddit to watch for the unmoderated counter                            |
| Show notifications              | On      | Master switch for notifications; the modbar counters keep updating when off |
| Consolidate notifications       | On      | Show one "X new" notification instead of one per item _(advanced)_          |
| Mod queue notifications         | On      | Notify on new mod queue items                                               |
| Unmoderated queue notifications | Off     | Notify on new unmoderated items                                             |
| Check interval (minutes)        | 1       | How often to poll Reddit for new activity _(advanced)_                      |
