# Queue Tools

**Platforms:** Old Reddit and New Reddit · **Default:** Enabled

Queue Tools adds action history tables, ignored-report visibility, and queue creatures to the mod queue.

## Overview

Queue Tools extends the mod queue with information and controls that Reddit's native UI doesn't provide. It pulls from the subreddit mod log to show what actions have already been taken on each item, and adds a button to reveal which reports are being ignored.

## Features

**Mod action table** — shows the recent mod log actions taken on each item (removes, approvals, notes, etc.), pulled from the last 500 entries in the subreddit's mod log and combined with the item's own current approval/removal state read directly off the post or comment. The table can be expanded or collapsed per item, and appears on both old and new Reddit (it replaces the older Mod Actions "Recent actions" button on new Reddit). Its visibility is controlled separately for approved (not removed) and removed items.

**Auto-expand action table** — automatically expands the action table in old Reddit queues so it's always visible without a click.

**Show reports on ignored-report items** — adds a button to items with ignored reports so you can see what those reports said without un-ignoring them. Old Reddit only (new Reddit surfaces these reports natively).

**Queue creature** — shows a cheerful creature at the bottom of an empty mod queue. Configurable to your preference.

## Settings

| Setting                               | Default | Description                                                   |
| ------------------------------------- | ------- | ------------------------------------------------------------- |
| Show recent actions on approved items | On      | Show the recent-actions table on approved (not removed) items |
| Show recent actions on removed items  | On      | Show the recent-actions table on removed items                |
| Auto-expand action table              | On      | Expand the action table by default in old Reddit queues       |
| Show reports on ignored-report items  | On      | Add a button to reveal reports on items with ignored reports  |
| Queue creature                        | kitteh  | Creature shown at the bottom of an empty queue                |
