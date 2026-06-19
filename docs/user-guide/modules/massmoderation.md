# Mass Moderation

**Platforms:** Old Reddit only · **Default:** Enabled

Mass Moderation adds queue management tools to old Reddit moderation pages, letting moderators sort, filter, and act on multiple queue items at once.

## Overview

Mass Moderation is an old Reddit-only module. It activates on mod queue and unmoderated pages and adds a toolbar of controls above the listing. Items can be sorted and filtered without reloading, and auto-refresh keeps the queue up to date.

## Features

**Sort and filter** — sort queue items by age, edited time, removal time, score, report count, or author username. Items below a report or score threshold can be hidden.

**Hide actioned items** — removes items from the listing after you take action on them, so the queue shrinks as you work through it.

**Group by subreddit** — groups queue items from the same subreddit together.

**Group comments by submission** — when viewing a comment queue, groups each comment under its parent submission.

**Auto-refresh** — periodically reloads queue items so new reports appear without a manual page refresh.

**Expand reports** — automatically expands the report details for every item when the page loads.

**Link to subreddit queue** — adds a link to each item's subreddit mod queue for quick drill-down.

**Keep expandos open** — prevents media expandos from collapsing as you scroll.

## Settings

| Setting                      | Default | Description                                                 |
| ---------------------------- | ------- | ----------------------------------------------------------- |
| Automatically activate       | On      | Activate mass moderation tools on queue pages automatically |
| Expand reports               | Off     | Auto-expand reports on mod pages                            |
| Hide actioned items          | Off     | Hide items after taking a mod action                        |
| Link to subreddit queue      | Off     | Show link to the subreddit queue on mod pages               |
| Sort by                      | Age     | Default sort order for queue items                          |
| Reports threshold            | 0       | Hide items with fewer reports than this (0 = show all)      |
| Sort ascending               | Off     | Sort in ascending order                                     |
| Group comments by submission | Off     | Group comment-queue items by their parent post              |
| Keep expandos open           | Off     | Keep all media expandos open by default                     |
| Score threshold              | 0       | Hide items with score above this value (0 = disabled)       |
| Prevent re-sort on load      | Off     | Lock the current sort when new items load                   |
| Group by subreddit           | Off     | Group queue items by subreddit                              |
| Auto-refresh                 | Off     | Auto-refresh queue items periodically                       |
