# Schema Changes

Toolbox-NXG introduces a new wiki layout (`toolbox-nxg`) alongside the classic `toolbox` wiki page. This page explains what changed, why, and how both layouts coexist during the transition period.

For the full technical specification of each schema version, see [Subreddit Config Schema](../schema/config.md).

## Overview of changes

NXG makes three major changes to how subreddit data is stored:

1. **New wiki paths** — subreddit config moves from `toolbox` to `toolbox-nxg`; usernotes move from `usernotes` to a sharded layout under `toolbox-nxg/usernotes/*`; the subreddit notes index and pages move from `notes/index` and `notes/<slug>` to `toolbox-nxg/notes` and `toolbox-nxg/notes/<slug>`; the settings backup moves from `tbsettings` to `toolbox-nxg/user-settings`. Domain tags and usernote types, which 6.x keeps inside the `toolbox` config, move to `toolbox-nxg/domain-tags` and the usernotes manifest.
2. **Config schema v2** — the config JSON format gains plain-text storage (no URI encoding), brace-token interactive fields, and stable entry IDs. The classic v1 format is still written to the `toolbox` page when 6.x compatibility is enabled.
3. **Usernote archiving** — the NXG usernote format adds an `archived` field per note, letting notes be hidden rather than deleted.

## Subreddit config

### Wiki paths

| Schema       | Wiki page     | Written by                     |
| ------------ | ------------- | ------------------------------ |
| v1 (classic) | `toolbox`     | 6.x clients; NXG compat mirror |
| v2 (NXG)     | `toolbox-nxg` | NXG clients                    |

NXG always reads and writes `toolbox-nxg`. When 6.x compatibility writes are enabled, NXG also writes a down-converted v1 copy to `toolbox` on every save.

### Migration

Migration runs automatically the first time a moderator with wiki-edit permissions views a subreddit. NXG reads the existing `toolbox` page, up-converts it to v2, and writes it to `toolbox-nxg`. The original `toolbox` page is never deleted.

Re-running migration (e.g. to fold in 6.x edits) is safe and idempotent: when a readable `toolbox-nxg` page already exists, NXG reconcile-merges the 6.x-owned fields from the legacy page into it rather than overwriting. Stable entry IDs are preserved by content-matching across the merge.

### v1 → v2 differences

**No URI encoding** — v1 stores certain fields URI-encoded (via `escape()`) because 6.x unconditionally `unescape()`s them on read. v2 stores all strings as plain text. `normalizeConfig` only URI-decodes configs with `ver < 2`, so literal percent signs in v2 text survive.

**Brace tokens instead of HTML** — v1 reason text could embed `<input>`, `<textarea>`, and `<select>` elements. v2 replaces them with brace tokens. The v1 mirror down-converts them back to HTML for 6.x compatibility. See [Brace tokens](#brace-tokens) below for the full syntax.

**Stable entry IDs** — every removal reason, mod macro, and suggested-reason mapping in v2 carries a stable 8-character base-36 `id`. IDs are assigned on create and backfilled by `ensureStableIds` during normalization. They survive reordering and are stripped from the v1 mirror.

## Brace tokens

Brace tokens are the v2 way to embed interactive fill-in fields in removal reason text. When a moderator opens the removal overlay for a reason that contains tokens, the overlay renders a form control for each one; the mod fills in the values and the final message is assembled by substituting those values in place.

### Token types

**`{input: placeholder}`** — a single-line text field. The text between the colon and the closing brace is used as the placeholder hint shown inside the field. Example:

```
Your post has been removed. Please resubmit with {input: a descriptive title}.
```

**`{textarea: placeholder}`** — a multi-line text field, otherwise identical to `{input}`. Use this when you expect longer free-form text.

```
We have removed your post for the following reason: {textarea: explain the issue in detail}
```

**`{choice}`** — a pick-one field, shown in the overlay as a group of radio buttons. The option the mod picks is inserted into the message. Every option is both the visible label and the inserted text, and may contain markdown such as links. The first option is selected to begin with; make it blank (`-` with nothing after it) to insert nothing until a real option is picked. A choice comes in two forms.

The **block** form puts the `{choice}` marker on a line of its own, with the options as a markdown list directly below it. Use it when the choice stands on its own, for example a rule to cite under a question:

```
Which rule did your post break?

{choice}
- Rule 1: No spam
- Rule 2: Be civil
- Rule 3: Relevant content

Please review our rules before resubmitting.
```

Blank lines between the marker and the list are fine; the block is tidied to the form above on save. The list ends at the first line that isn't a list item. A marker with no list under it, or one that shares its line with other text, is not a field: it is sent as written, and the reason editor warns about it.

The **inline** form lists its options inside the token, separated by `|`, so the picked option lands exactly where the token sits in its line, for example mid-sentence or as a link's text:

```
This is a [{choice: repost | duplicate}](https://www.reddit.com/r/example/wiki/reposts) of an earlier post.
```

Write `\|` for a pipe that belongs to an option's text. A brace inside an option is saved as a parenthesis, since `}` ends the token. An inline choice with no option text, such as `{choice:}`, is sent as written.

**`{dropdown}`** — a `{choice}` shown as a dropdown instead of radio buttons, which is easier to use with a long list of options and is how 6.x showed every pick-one field. It takes both forms (`{dropdown}` above a list, or `{dropdown: a | b}` inside a line), an id and `!` exactly as `{choice}` does, and sends the picked option the same way. Since a dropdown can't show formatting, an option with a link shows the link's text; the whole option, link included, is still what's sent.

**`{multi}`** and **`{highlight}`** — tick-box fields, shown in the overlay as a group of checkboxes, so the mod can tick any number of items. They have no 6.x counterpart. The marker goes on a line of its own with the items as a GFM task list directly below it: `- [ ] item`, or `- [x] item` for an item that starts ticked. As with `{choice}`, blank lines between the marker and the list are fine, any bullet (`-`, `*`, `+`, `1.`) is accepted, and the block is tidied to the form below on save. What is sent is always a `-` list, with the boxes removed:

- `{multi}` sends only the ticked items. Nothing ticked sends nothing.
- `{highlight}` sends every item and bolds the ticked ones. Use it to list a rule's requirements and mark the ones a post broke:

```
Image posts must meet the following rules:

{highlight}
- [ ] be original content you created
- [ ] include the source in the title of the post
- [ ] not be a repost of something shared in the last 30 days. Search the subreddit before posting
- [ ] not exceed two image posts in the last 7 days
```

A ticked item is bolded as a whole. Its text is wrapped in `**`, or in `__` if it already contains `**`, so the two can't pair up wrongly.

The list must be in task-list style. A `{multi}` or `{highlight}` marker followed by plain `-` items, or a `{choice}` marker followed by `- [ ]` items, is not a field. It is sent as written, and the editor and overlay warn about it and say which style the marker takes.

For a single tick box inside a line, use the inline forms. **`{check: text}`** sends its text only when ticked; **`{highlight: text}`** always sends it, bolded when ticked. Start the text with `[x]` to begin ticked:

```
- {highlight: not be a repost of something shared in the last 30 days}. Search the subreddit before posting.

Your post was also {check: [x] missing a source}.
```

An inline tick box with no text, such as `{check:}`, is sent as written. A `[x]` followed directly by `(`, as in a link `[x](url)`, is part of the text, not a box.

**`{note: text}`** — guidance for the moderator. The overlay shows it in muted italics where it sits, and it is never sent. Use it for when-to-use advice that used to be crammed into the reason's title, or left in the message for the mod to delete by hand. The text may contain markdown such as a link:

```
{note: Only for image posts. Text posts fall under [Rule 6](https://www.reddit.com/r/example/wiki/rules).}
Image posts must be your own original work.
```

A note with no text, such as `{note:}`, is sent as written.

### Required fields

Put `!` after a field's kind, or after its id when it has one, to make it required. The overlay will not send the removal, or request a second opinion, while a required field in a selected reason is unfilled. It names the reason and outlines each unfilled field. Required fields carry a rule along their leading edge so the moderator can see them before sending.

```
Your title needs {input!: what is missing from the title}.

Which rule?

{choice#rule!}
-
- Rule 1: No spam
- Rule 2: Be civil

{multi!}
- [ ] contains spoilers without a tag
- [ ] is a repost
```

What counts as filled depends on the field:

| Field                            | Filled when                                                              |
| -------------------------------- | ------------------------------------------------------------------------ |
| `{input!: …}`, `{textarea!: …}`  | It holds non-blank text                                                  |
| `{choice!}`, `{choice!: a \| b}` | The picked option is not blank, so a blank first option means "pick one" |
| `{multi!}`, `{highlight!}`       | At least one item is ticked                                              |
| `{check!: …}`, `{highlight!: …}` | The box is ticked                                                        |

`!` has no effect on a `{note}`.

### Stable IDs

Any interactive token may carry an optional stable id using the `#id` syntax:

```
Flight number: {input#flightnum: e.g. UA123}

{choice#rule}
- Rule 1
- Rule 2

This is a {choice#kind: repost | duplicate}.

{highlight#imagerules}
- [ ] be original content
- [ ] include the source
```

The id is used to persist the entered or chosen value between overlay opens: if a mod closes and reopens the overlay without sending, the field shows what they last entered or picked. A choice or tick-box field without an id still keeps its value, keyed on its position among the reason's choice and tick-box fields, so the value is lost if those fields are reordered. A tick-box field remembers which items were ticked by position, so reordering its items moves the ticks with the positions, not with the text.

The required mark goes after the id: `{input#flightnum!: e.g. UA123}`, `{choice#rule!}`.

IDs must be word characters and hyphens (`[\w-]+`). They are optional; an `{input}` or `{textarea}` without an id still works, it just won't preserve entered text across opens.

### Older v2 select definitions

Early v2 pages stored pick-one fields separately, as a `selects` array on the reason referenced from the text as `{select:name}`. Normalization folds each definition into the text as a `{choice}` block (its prompt, if any, as a line above the marker) and drops the `selects` field, so it is never written back.

### Substitution tokens

Brace tokens are distinct from **substitution tokens** — things like `{author}`, `{subreddit}`, and `{url}` that the overlay replaces automatically with context data from the removed post or comment. Substitution tokens are always a bare `{word}` with no colon, so there is no ambiguity:

| Token         | Replaced with                                    |
| ------------- | ------------------------------------------------ |
| `{author}`    | Username of the post/comment author              |
| `{subreddit}` | Name of the subreddit                            |
| `{kind}`      | `"submission"` or `"comment"`                    |
| `{title}`     | Title of the post                                |
| `{url}`       | Permalink to the removed item                    |
| `{domain}`    | Domain the post links to                         |
| `{mod}`       | Username of the moderator sending the removal    |
| `{body}`      | Body of the removed item, quoted as markdown     |
| `{fullname}`  | Reddit fullname (e.g. `t3_abc123`)               |
| `{id}`        | Short id of the removed item                     |
| `{link}`      | URL the post links to                            |
| `{raw_body}`  | Body without markdown quoting                    |
| `{uri_body}`  | URL-encoded body, for use inside markdown links  |
| `{uri_title}` | URL-encoded title, for use inside markdown links |

Two link tokens build links for the subreddit the message is sent from. A reason written with them keeps working when it is copied to another subreddit:

| Token                 | Replaced with                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `{modmail}`           | `https://www.reddit.com/message/compose?to=/r/<subreddit>`, for messaging the mods                             |
| `{wiki: page}`        | `https://www.reddit.com/r/<subreddit>/wiki/page`                                                               |
| `{wiki: page#anchor}` | The same, linking to a section. Copy the anchor from the wiki page's URL (Reddit's anchors start with `wiki_`) |

```
Please read [the rules for image posts]({wiki: rules#wiki_image_posts}), and [message the mods]({modmail}) if you think this was a mistake.
```

The link tokens work everywhere substitution tokens do: reason text, header, footer, mod macros, and ban macros. A page with a space in it is not a token and is sent as written.

### Unknown brace content

Any `{…}` content that doesn't match a known interactive token or substitution token is left in the text untouched. The same goes for a `{note:}` with no text and a `{wiki: …}` whose page has a space in it. In particular, a `{choice}`, `{multi}`, or `{highlight}` marker that has no list of its own style below it, or shares its line with other text, is treated as literal text and is never substituted. This means a half-typed field fails visibly rather than silently dropping content, and the reason editor and removal overlay both warn about it before anything is sent.

### Migration from v1 HTML

During the v1 → v2 up-convert, legacy HTML form elements are translated automatically:

| v1 HTML                                   | v2 token                                           |
| ----------------------------------------- | -------------------------------------------------- |
| `<input placeholder="…">`                 | `{input: …}`                                       |
| `<textarea placeholder="…">`              | `{textarea: …}`                                    |
| `<select id="rule">…</select>` on its own | `{dropdown#rule}` block, one `-` line per option   |
| `<select id="rule">…</select>` in a line  | `{dropdown#rule: a \| b}` inline, in the same spot |
| `<br>`                                    | `\n\n` (paragraph break)                           |

A `<select>` counts as being on its own when nothing but whitespace, `<br>`, or other `<select>` elements shares its line; anything else, such as words of a sentence or the brackets of a link around it, keeps it inline so the picked option stays in its sentence. A slug-safe `id` attribute is kept as the choice's id; one that is missing or not slug-safe gives a choice without an id. An option's `value` attribute, when present, is used instead of its text, because that is what 6.x inserted. Backslash escapes that 6.x needed around link syntax in options (`\[`, `\]`, `\(`, `\)`) are removed, so links in options work as normal markdown.

A 6.x `<select>` was a dropdown, so it stays one. Two exceptions read as `{choice}` instead: a `<select>` NXG wrote for a `{choice}`, which carries a `data-tbx-choice="1"` attribute, and the two-option shape 6.x configs used to fake a tick box (see below), which then becomes the tick-box token. Mirrors written before NXG added that attribute read every `{choice}` back as a `{dropdown}`, so the config reconcile ignores the difference between the two and never takes it for a 6.x edit.

The v2 → v1 down-convert reverses this: inline tokens become HTML form elements, and each choice, in either form, becomes a `<select>` in the same place, with link syntax in its options escaped again for 6.x. A `{choice}` gets a `data-tbx-choice="1"` attribute and a `{dropdown}` a `data-tbx-dropdown="1"` one; 6.x ignores both and keeps them.

#### Notes, required fields, and link tokens on the v1 mirror

6.x has none of these, so each is written in a form 6.x handles and NXG reads back exactly:

| v2             | v1                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `{note: text}` | `<input id="tbx-note" placeholder="text">`. 6.x shows an empty box with the note as its hint, which sends nothing if left empty |
| `!` on a field | A `required="required"` attribute on its `<input>`, `<textarea>`, or `<select>`. 6.x ignores it but keeps it                    |
| `{modmail}`    | `https://www.reddit.com/message/compose?to=/r/{subreddit}`, which 6.x completes                                                 |
| `{wiki: page}` | `https://www.reddit.com/r/{subreddit}/wiki/page`, which 6.x completes                                                           |

On normalize, those URLs become link tokens again, including in mod macros and ban macros. So does a hand-written link of exactly that shape, which sends the identical link. A compose link carrying a subject or other parameters is left alone. A `{multi!}` or `{highlight!}` block loses its required mark on the mirror, because a mark on each per-item `<select>` would require something else.

#### Tick boxes on the v1 mirror

6.x has no tick box, so each tick-box item down-converts to a `<select>` offering its two possible outputs, the starting one first:

| v2 token                        | v1 HTML                                                     |
| ------------------------------- | ----------------------------------------------------------- |
| `{highlight: a}`                | `<select><option>a</option><option>**a**</option></select>` |
| `{highlight: [x] a}`            | `<select><option>**a**</option><option>a</option></select>` |
| `{check: a}`                    | `<select><option></option><option>a</option></select>`      |
| `{multi}` / `{highlight}` block | one `- <select>…</select>` line per item, as above          |

A 6.x moderator can therefore still pick plain or bold, or include or leave out, one item at a time. A block's id names the whole block and is not written to the per-item selects.

The up-convert reads that pattern back. Any inline choice whose two options are one text and the same text in bold (`a | **a**`), or one text and nothing (`| a`), becomes the tick-box token for it, with `[x]` when the bold or included option came first. This also converts 6.x configs that used one plain/bold `<select>` per line to highlight the rule a post broke. Because the items come back as inline boxes, a `{multi}` or `{highlight}` block edited in 6.x and adopted from the mirror returns as a `-` list of `{check: …}` or `{highlight: …}` lines, which sends the same message. A block `{choice}` with those options is left alone, since it sends a paragraph rather than a list item.

#### Choices split by earlier NXG versions

Before the inline form existed, NXG turned every `<select>` into a block, including one written mid-sentence or as a link's text. The picked option was then sent as a separate paragraph, and a link around it broke. Subreddits that saved their config with one of those versions have the split text stored on both wiki pages, and the original is only left in the classic `toolbox` page's revision history.

When a moderator opens **Edit removal reasons**, NXG checks that history (up to the last 100 revisions) for reasons whose current text is exactly what the old conversion made from a historical inline `<select>`. If it finds any, it lists them and offers to restore them. Nothing changes until a moderator chooses **Restore and save**. A reason that has been edited since is never matched, so it is left alone. Each moderator's browser checks each subreddit only until the check finds nothing, or until the offer is accepted or dismissed.

## Usernotes

### Wiki paths

| Layout            | Wiki pages                                                  |
| ----------------- | ----------------------------------------------------------- |
| Classic (v6 blob) | `usernotes`                                                 |
| NXG (sharded)     | `toolbox-nxg/usernotes`, `toolbox-nxg/usernotes/<shard>`, … |

The NXG layout splits usernotes across multiple wiki pages to work around Reddit's 512 KB wiki page limit. The classic `usernotes` page had a special 1 MB allowance; that single-page limit no longer applies in the NXG layout.

### Migration

On first access, NXG decodes the classic `usernotes` blob, re-encodes it in the sharded NXG format, and writes the shards. Note types are seeded from the classic config's `usernoteColors` (or the built-in defaults) and stored in the manifest. On subsequent accesses with 6.x compatibility on (e.g. after 6.x edits), NXG reconcile-merges the classic page into the existing shards: notes added on the classic page flow in, notes removed there are archived (an edited note therefore shows up as a new note plus an archived original), and NXG-only state (archived notes, stable indexes) is preserved.

### Archiving

The NXG format adds an `archived` field to each note entry. When a note is archived, it is hidden from the active list but retained in the shard. The `archived` object records who archived it and when.

When a 6.x mod deletes a note (by removing it from the classic `usernotes` page), NXG's reconciliation detects the deletion and archives the note with `archived.by` set to the sentinel value `[6.x]`, rendered in the UI as "archived via 6.x delete".

Archived notes are stripped from the classic page mirror — 6.x clients will not see them.

### Stable note indexes

Each note in the NXG format has a per-user `index` (assigned from `nextIndex` and never reused), making `(username, index)` an unambiguous address for a note. Notes read from the classic v6 page get ephemeral position-derived indexes on load; durable indexes are assigned when the note is first saved in the NXG layout.

## Personal settings

Personal settings are stored in browser extension storage, not the wiki. Toolbox-NXG is a separate extension, so bring them across by restoring a settings backup from the subreddit you used for backups in 6.x. NXG reads `toolbox-nxg/user-settings`, and when that page doesn't exist yet it reads the 6.x `tbsettings` page instead, so an existing 6.x backup restores as-is. The next export writes `toolbox-nxg/user-settings`. The backup format is unchanged, and backups from Toolbox versions older than 3.0 are rejected.

On every startup NXG renames stored keys for modules whose ids changed (for example `Toolbox.RReasons.*` to `Toolbox.RemovalReasons.*`, `Toolbox.PNotes.*` to `Toolbox.SubredditNotes.*`, `Toolbox.DTagger.*` to `Toolbox.DomainTagger.*`), copies the relevant `Toolbox.QueueTools.*` settings to the split-out `MassModeration` and `ModViewEnhancements` modules, maps `Toolbox.Notifier.enabled: false` to `Toolbox.Notifier.showNotifications: false`, and on a version change deletes settings for removed features. No manual steps are needed.
