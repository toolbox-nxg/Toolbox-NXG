# Mod View Enhancements

**Platforms:** Old Reddit and New Reddit · **Default:** Enabled

Mod View Enhancements adds visual and informational improvements to the moderator's view of submissions and reports — across the mod queue, subreddit listings, and comment pages — making it easier to assess items at a glance.

## Overview

Mod View Enhancements applies passive visual enhancements to moderated content. Unlike Mass Moderation, it does not add interactive tools — it improves what you can see, not what you can do. Most features focus on the mod queue, but report-match highlighting can optionally extend to regular subreddit and comment pages.

## Features

**Subreddit color borders** — adds a colored border to queue items, with a unique color derived from the subreddit name. Helps distinguish items from different subreddits in a combined queue. Colors can be overridden per-subreddit, and a salt string can be changed to shift all auto-generated colors.

**Negative score highlight** — applies a highlight to posts with a score of 0 or below.

**AutoModerator action reason** _(old Reddit)_ — shows the action reason from AutoModerator below each submission, so you can see at a glance why a post was flagged without opening the mod log.

**Bot checkmark** _(old Reddit)_ — gives bot-approved items a visually distinct checkmark. Configured by listing bot usernames.

**Highlight AutoModerator regex matches** — when AutoModerator's report or action reason contains text in square brackets (commonly used to echo regex match groups), those words are highlighted in the displayed reason. By default this applies on the mod queue; an optional setting extends it to subreddit listings and comment pages when you browse them as a moderator _(old Reddit)_.

## Settings

| Setting                                   | Default       | Description                                                                       |
| ----------------------------------------- | ------------- | --------------------------------------------------------------------------------- |
| Subreddit color borders                   | Off           | Colored border per subreddit in the queue                                         |
| Subreddit color salt                      | PJSalt        | Salt string used when generating subreddit colors _(advanced)_                    |
| Subreddit color overrides                 | _(empty)_     | Override auto-generated colors for specific subreddits                            |
| Highlight posts with score ≤ 0            | Off           | Apply a highlight to zero or negative score posts                                 |
| Show AutoModerator action reason          | On            | Show automod action reason below items _(old Reddit)_                             |
| Bot approved checkmark                    | AutoModerator | Bot usernames that get a distinct approve checkmark _(old Reddit)_                |
| Highlight AutoModerator regex matches     | On            | Highlight bracketed text in automod action/report reasons                         |
| Highlight regex matches outside the queue | Off           | Also highlight bracketed report matches on subreddit/comment pages _(old Reddit)_ |
