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

## Settings

| Setting                             | Default       | Description                                                    |
| ----------------------------------- | ------------- | -------------------------------------------------------------- |
| Enable comment removal reasons      | Off           | Show removal reasons when removing comments                    |
| Always show empty removal box       | Off           | Show the dialog even for subreddits with no configured reasons |
| Display mode                        | Drawer        | Show reasons as a side drawer or legacy popup                  |
| Silent removal for deleted users    | Off           | Skip the dialog and silently remove deleted-user content       |
| Reply method                        | Comment reply | How the removal message is sent (comment, PM, both, or none)   |
| Send as subreddit                   | Off           | Send removal messages as the subreddit account                 |
| Auto-archive sent PM                | Off           | Archive the removal PM after sending                           |
| Sticky removal comment              | Off           | Sticky the removal reason comment                              |
| Reply as /u/subreddit-ModTeam       | Off           | Send removal comment as ModTeam account                        |
| Lock thread after removal           | Off           | Lock the thread when removing                                  |
| Lock removal comment                | Off           | Lock the removal reason comment                                |
| Disable remove button after removal | Off           | Grey out the remove button after an item is removed            |
