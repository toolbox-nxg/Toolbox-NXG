# Removal Reasons

**Platforms:** Old Reddit and New Reddit · **Default:** Enabled

Removal Reasons wires up the removal button to display a dialog with your subreddit's configured removal reasons, letting you select a reason and send a removal message to the author in one step.

## Overview

When you click the remove button on a post or comment, Removal Reasons intercepts the action and shows a panel listing your subreddit's configured reasons. Select one, fill in any interactive fields, and confirm — the item is removed and the message is sent in the configured reply method. If a subreddit has no removal reasons configured, Removal Reasons can still show an empty box for a custom message.

Removal reasons are configured per-subreddit in the Config overlay (**Edit removal reasons** tab, with message template and delivery options on the **Removal reasons settings** tab).

## Features

**Drawer or popup display** — the removal reason dialog can appear as a side drawer (default) or a modal popup. The drawer keeps the removed content visible alongside the dialog. While the [Classic look](general.md#classic-look) is on, removal reasons always open as the popup and the drawer is unavailable.

**Interactive fill-in fields** — reasons can include `{input:…}`, `{textarea:…}`, `{choice}`, `{multi}`, and `{highlight}` tokens that become text fields, pick-one options, and tick boxes in the dialog (see [Removal reason format](#removal-reason-format)).

**Substitution tokens** — reason text is processed for substitution tokens (`{author}`, `{subreddit}`, etc.) before sending.

**Multiple reply methods** — configure per-subreddit whether the removal message is sent as a comment reply, a modmail, both, or only logged to the log subreddit.

**Send as subreddit** — optionally send the removal message as the subreddit account.

**Auto-archive modmail** — optionally archive the removal modmail after sending.

**Sticky and distinguish** — optionally sticky and/or distinguish the removal comment.

**Reply as ModTeam** — send the removal comment as /u/subreddit-ModTeam.

**Lock thread after removal** — optionally lock the post or comment thread at the same time.

**Comment reasons** — optionally enable removal reasons for comments, not just posts.

**Reorder reasons per removal** — drag reason cards in the overlay to change the order the selected reasons are combined in. The new order applies to that removal only and is not saved. Turn on **Lock removal reason order** to remove the drag handles, so reasons always go out in the subreddit's configured order.

**Silent removal for deleted users** — skip the removal dialog and silently remove items authored by deleted accounts.

**Suggested removal reasons** — map report text to removal reasons so the right reasons are pre-selected when you open the overlay on a reported item (see [Suggested removal reasons](#suggested-removal-reasons)).

**Sync Reddit's removal reasons** — import the removal reasons configured in Reddit's own Mod Tools and keep them up to date, so you only maintain them in one place (see [Syncing Reddit's removal reasons](#syncing-reddits-removal-reasons)).

**Fall back to Reddit's removal reasons** — in subreddits with no toolbox reasons at all, offer Reddit's native ones rather than nothing (see [Falling back to Reddit's removal reasons](#falling-back-to-reddits-removal-reasons)).

**Leave a note for the user** — record the removal as a [Toolbox usernote](usernotes.md) or, while the [Native Mod Log](native-mod-log.md) module is enabled, as a Reddit mod note. **Default note destination** picks which one is selected first; with Native Mod Log turned off, the choice is hidden and the note is always a Toolbox note. A reason can fill the note in for you (see [Default notes](#default-notes)).

**Issue a ban** — ban the author as part of the removal. The ban starts from the subreddit's default in the **Ban settings** tab of the [Config](config.md) overlay, the same default the Mod Button's ban form uses: permanent when **Permanent ban by default** is ticked, otherwise the default duration (7 days when none is set). A subreddit with no ban macros starts at a 7-day temporary ban. Choosing a usernote type that carries its own ban duration replaces that starting value. A permanent ban can also **remove all posts & comments** the user made in the subreddit, as the Mod Button's ban form can. By default a note saying so is added to the ban message; untick **Tell the user their posts & comments were removed** to leave it off for that removal. Like other bulk actions it isn't available in training mode, though a captured removal keeps both choices and a reviewer's accept carries them out.

## Default notes

Each removal reason can carry its own note, so picking the reason fills in the note for you. To set one up, open the [Config](config.md) overlay's **Edit removal reasons** tab, click **Edit** on the reason, and fill in **Default usernote (optional)** below the flair fields. You can also pick a note type there.

When you then select that reason in the removal dialog, **Leave a note for this user** is ticked and the note box holds the reason's default note, with its note type selected. You can still change the text before sending; once you have, selecting or deselecting other reasons won't overwrite it, though deselecting every reason clears it. With several reasons selected, their default notes are joined with commas in the order the reasons appear. A reason with no default note doesn't tick the box, so removing with only those reasons leaves no note unless you tick it yourself.

**Default note destination** (in the settings below) decides only whether that note is written as a Toolbox usernote or a Reddit mod note. It doesn't add a note to removals by itself.

## Removal reason format

Reason text supports two kinds of tokens:

### Substitution tokens

These are replaced with contextual values before the message is sent:

| Token          | Value                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------- |
| `{subreddit}`  | Subreddit name                                                                              |
| `{author}`     | Username of the removed item's author                                                       |
| `{mod}`        | Username of the acting moderator                                                            |
| `{title}`      | Post title                                                                                  |
| `{url}`        | Post URL                                                                                    |
| `{permalink}`  | Permalink to the post or comment                                                            |
| `{domain}`     | Link domain                                                                                 |
| `{body}`       | Post or comment body text                                                                   |
| `{modmail}`    | Link for messaging the subreddit's moderators                                               |
| `{wiki: page}` | Link to a page of the subreddit's wiki; `{wiki: rules#wiki_image_posts}` links to a section |

`{modmail}` and `{wiki: …}` build their links from the subreddit, so a reason that uses them keeps working when it is copied to another subreddit. For example, `[message the mods]({modmail})`.

### Interactive tokens

These become fill-in fields in the removal dialog:

| Token                                 | Result                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `{input: placeholder}`                | Single-line text field                                                                                               |
| `{textarea: placeholder}`             | Multi-line text field                                                                                                |
| `{choice}` above a `-` list           | Pick one: the chosen option is sent                                                                                  |
| `{choice: option 1 \| option 2}`      | Pick one, inside a sentence or a link's text                                                                         |
| `{dropdown}` / `{dropdown: a \| b}`   | The same as `{choice}`, but shown as a dropdown instead of radio buttons, which suits a long list                    |
| `{multi}` above a `- [ ]` list        | Tick any number: only the ticked items are sent, as a list                                                           |
| `{highlight}` above a `- [ ]` list    | Tick any number: every item is sent as a list, the ticked ones in bold                                               |
| `{check: text}` / `{highlight: text}` | One tick box inside a line: `check` sends the text only when ticked, `highlight` always sends it, bolded when ticked |

| `{note: text}` | Guidance for moderators, shown in the dialog and never sent |

Write `- [x]` (or `{check: [x] text}`) to start a box ticked. Tick boxes and `{choice}` picks reset to their starting state each time the dialog opens; only typed text is remembered from your last removal on that subreddit. For example, to list a rule's requirements and bold the ones a post broke:

```
Image posts must:

{highlight}
- [ ] be original content you created
- [ ] include the source in the title of the post
- [ ] not exceed two image posts in the last 7 days
```

Add `!` after a field's kind to make it required, as in `{input!: why}`, `{choice!}`, or `{multi!}`. The dialog won't send until it is filled, a non-blank option is picked, or at least one box is ticked, and it outlines anything left unfilled. A blank first option in a required `{choice!}` makes the moderator pick one deliberately.

A long inline choice can be written one option per line, keeping the `|` at the end of each line except the last. It still sits inside its sentence:

```
**Rule 8: No titles that {dropdown#titles:
are all-caps |
are clickbait |
contain emoji
}.**
```

A stable field ID can be appended for persistence between dialog opens: `{input#flightnum: Flight number}`, `{choice#rule}`, `{highlight#imagerules}`. See [Schema Changes](../../migration/schema-changes.md#brace-tokens) for the full syntax.

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

Reddit has its own removal reasons, configured in the new mod tools under **Saved Responses → Removals** (`https://sh.reddit.com/mod/<subreddit>/saved-responses/removals`). Note that these are _not_ your community rules - having rules configured does not give you removal reasons, and a subreddit that has never created one has nothing for toolbox to import. If your subreddit already maintains them there, toolbox can import them instead of making you write everything out a second time.

Turn on **Import Reddit's removal reasons and keep them up to date** at the top of the _Edit removal reasons_ tab in the toolbox config editor, next to the reasons it manages. Imported reasons then appear alongside your own, marked with a **Native** chip.

**What Reddit owns, and what you own.** The sync is one way. Reddit owns each imported reason's **title** and **message** — both are read-only in the toolbox editor, and any change you make in Mod Tools replaces them on the next sync. Everything else belongs to toolbox and is preserved across syncs:

- post flair to apply on removal
- the default usernote and note type
- whether the reason applies to posts, comments, or both

So the normal workflow is to write the wording in Mod Tools and attach the toolbox-only extras here.

**Reddit's macros.** A native removal reason can use Reddit's own macros, and toolbox fills them in the same way Reddit would, so what you see in the preview is what the author receives:

| Macro                                         | Filled with                              |
| --------------------------------------------- | ---------------------------------------- |
| `{content_type}`                              | `post` or `comment`                      |
| `{content_title}`                             | the post's title                         |
| `{content_body}`                              | the removed item's text                  |
| `{content_link}`                              | permalink to the removed item            |
| `{content_domain}`                            | the link's domain (empty for text posts) |
| `{community_name}`                            | the subreddit's display title            |
| `{community_link}`                            | `r/yoursubreddit`                        |
| `{community_description}`                     | the subreddit's public description       |
| `{community_rules_url}`                       | link to the subreddit's rules page       |
| `{community_rule_1}`, `{community_rule_2}`, … | that numbered rule, name and description |

Toolbox's own tokens (`{author}`, `{subreddit}`, `{input:…}` and the rest) work in these reasons too, and the two sets cannot clash.

```{note}
`{linked_community_rule}` is the one macro toolbox cannot fill in. It means "the rule this removal reason is attached to", and Reddit does not tell toolbox which rule that is.

Rather than delete it silently, toolbox leaves it in place and warns you in the removal dialog before you send, naming the macro. Use a numbered `{community_rule_1}` in Reddit's mod tools instead. If you send anyway, the author receives the macro exactly as written.
```

**Staying in sync.** Toolbox re-checks in the background when you open the removal drawer or the config editor, at most once every 15 minutes per subreddit, and only writes when something actually changed upstream. Because the check happens in the background, an edit you just made in Mod Tools usually appears the _next_ time you open the drawer. Press **Sync from Reddit**, beside the toggle, to pull changes immediately; it also shows when a change was last imported.

Two times are shown under the setting, and they mean different things. **Last imported a change** is the last time a sync actually brought something across; an old date there just means Reddit's reasons have not changed since, which is the normal state for a settled subreddit. **Last checked** is the last time your browser read Reddit's list at all, so it keeps moving even when nothing changes — that is the one to look at to confirm syncing is working. It is local to you, so a moderator who has not opened the subreddit recently will see an older time than a colleague who has.

If a background sync fails — Reddit is unreachable, or your account cannot edit the config wiki page — the failure is reported here in red, with what went wrong and when. Background syncing never interrupts a removal to tell you, so this is where a persistently broken sync shows up. The message clears itself as soon as a run succeeds.

A failure to _write_ is treated as the more serious kind, because the usual cause is an account without the **wiki** moderator permission, which will not fix itself. Toolbox stops retrying that subreddit for half a day rather than re-checking every 15 minutes to fail the same way. A failure to _read_ is assumed to be a passing network problem and retries normally. **Sync from Reddit** ignores the backoff, so once the permission is granted you can retry straight away.

**Making an imported reason your own.** If you want to keep a reason but take over its wording, press the link button on its card in the _Edit removal reasons_ tab. It becomes an ordinary toolbox reason: the title and message are editable again and stop being overwritten, and the **Native** chip goes away. The reason on Reddit is untouched, and it will not be imported a second time.

Toolbox warns you first, because the conversion is one way — later edits in Reddit's mod tools will no longer reach that reason.

```{note}
Turning syncing off and on again after converting a reason re-imports the Reddit original, so you would end up with both it and your converted copy. Delete whichever you don't want.
```

**Deleting.** Deleting a reason in Mod Tools removes the toolbox copy on the next sync. Deleting an imported reason in the toolbox editor keeps it out — it will not be re-imported — but leaves it untouched on Reddit.

**Turning it off.** Switching **Import Reddit's removal reasons and keep them up to date** back off removes the imported reasons from toolbox, along with any flair and usernote settings you attached to them. Your hand-written reasons are untouched, and nothing changes on Reddit's side. Toolbox asks for confirmation first, and tells you how many reasons will go.

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

Fallback reasons behave like your own in most respects. Fill-in fields (`{input:…}`, `{textarea:…}`, `{choice}`, `{multi}`, `{highlight}`) and substitution tokens (`{author}`, `{subreddit}`, …) work exactly as they do in configured reasons, and if your subreddit has a message template — header, footer, modmail subject, removal-log settings — it is applied to them too. Only the reason list itself is coming from Reddit.

They are more limited in two ways:

- they are read-only: Reddit owns the wording, so they cannot be edited or reordered from the overlay
- no post flair, usernote default, or post/comment restriction is attached, because those live in a toolbox reason and these are not stored anywhere

A subreddit with no toolbox config at all has no message template to apply, so there the message is just the reason text.

As with imported reasons, removing something with a native reason registers that reason against the item in Reddit's own mod log.

## Settings

| Setting                                    | Default       | Description                                                                                                         |
| ------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Enable comment removal reasons             | Off           | Show removal reasons when removing comments                                                                         |
| Always show empty removal box              | Off           | Show the dialog even for subreddits with no configured reasons                                                      |
| Use Reddit's removal reasons as a fallback | On            | Offer Reddit's native removal reasons in subreddits that have no toolbox reasons                                    |
| Display mode                               | Drawer        | Show reasons as a side drawer or legacy popup. The classic look always uses the popup                               |
| Silent removal for deleted users           | Off           | Skip the dialog and silently remove deleted-user content                                                            |
| Reply method                               | Comment reply | How the removal message is sent (comment, modmail, both, or none; none requires a log subreddit)                    |
| Send as subreddit                          | On            | Hide your username when sending the removal modmail                                                                 |
| Auto-archive sent modmail                  | Off           | Archive the removal modmail after sending                                                                           |
| Sticky removal comment                     | Off           | Sticky the removal reason comment                                                                                   |
| Reply as /u/subreddit-ModTeam              | Off           | Send removal comment as ModTeam account                                                                             |
| Lock thread after removal                  | Off           | Lock the thread when removing                                                                                       |
| Lock removal comment                       | Off           | Lock the removal reason comment                                                                                     |
| Disable remove button after removal        | Off           | Grey out the remove button after an item is removed                                                                 |
| Pre-select suggested removal reasons       | On            | Pre-select reasons mapped from an item's reports, and flag matching items with "(suggestions)" on the remove button |
| Lock removal reason order                  | Off           | Hide the overlay's drag handles so selected reasons are always combined in the subreddit's configured order         |
| Default note destination                   | Toolbox note  | Whether a removal's note defaults to a Toolbox note or a Reddit mod note (the latter needs Native Mod Log enabled)  |
