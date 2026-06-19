# Publishing Announcements

Toolbox displays a popup to users when there are new entries in the `r/toolbox_nxg` wiki page `announcements`. This is how the team communicates release notes, breaking changes, and other important news without requiring a code deploy.

---

## The wiki page

Go to [r/toolbox_nxg/wiki/announcements](https://www.reddit.com/r/toolbox_nxg/wiki/announcements) and edit it directly. The page must contain valid JSON matching this structure:

```json
{
    "version": 1,
    "notes": [
        {
            "id": "2025-06-toolbox-8-release",
            "title": "Toolbox 8.0 Released",
            "body": "Toolbox 8 brings a new config popup and much faster loading. Thanks for your patience during the beta.",
            "link": "https://www.reddit.com/r/toolbox_nxg/comments/abc123/toolbox_8_release_notes/",
            "linkLabel": "Read the release notes"
        }
    ]
}
```

The `notes` array is ordered but order doesn't matter for display — the extension filters by `id`, not position.

---

## Fields

| Field        | Required | Description                                                                                                                                                                              |
| ------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | **Yes**  | Stable unique slug. Once published, never change it — it's the key used to track whether a user has seen this note. Use a date prefix to keep them sortable: `2025-06-some-description`. |
| `title`      | **Yes**  | Short headline shown in the popup title bar.                                                                                                                                             |
| `body`       | **Yes**  | Plain-text message body (1–3 sentences). No markdown — it renders as-is.                                                                                                                 |
| `link`       | No       | URL opened in a new tab when the user clicks the link button. Must start with `https://` or `/`.                                                                                         |
| `linkLabel`  | No       | Label for the link button. Defaults to `"Read more"` if omitted.                                                                                                                         |
| `buildTypes` | No       | Limits which build types see this note. Omit to show on all builds. See below.                                                                                                           |

### Targeting by build type

To show a note only on specific builds, add a `buildTypes` array:

```json
{
    "id": "2025-07-beta-notice",
    "title": "Beta feedback needed",
    "body": "We're looking for feedback on the new config popup. Please report any issues.",
    "buildTypes": ["beta"]
}
```

Valid values: `"stable"`, `"beta"`, `"dev"`. Omitting the field is equivalent to showing it on all builds.

---

## How it works

On every page load, Toolbox:

1. Fetches `r/toolbox_nxg/wiki/announcements` as JSON.
2. Filters notes by `buildTypes` (if set).
3. Skips any note whose `id` is already in the user's local `seenNotes` list.
4. If there are unseen notes, marks them all as seen and shows the popup.

The popup pages through multiple notes if there are more than one. Users cannot un-dismiss a note — once seen, it won't appear again unless the `id` changes (which you should not do).

Dev builds never fetch the wiki and never show the popup.

---

## Adding a new announcement

1. Write a short `body` (1–3 sentences). Keep the `title` under ~60 characters so it fits the popup header without truncation.
2. Choose an `id` that won't collide with past entries. A date-slug like `2025-06-release-8` works well.
3. Add a `link` if there's a post or changelog to point to.
4. Append the new note to the `notes` array in the wiki. Do not remove old entries — users who haven't loaded Toolbox yet still need them.
5. Save the wiki page. The change takes effect immediately on the next page load for anyone who hasn't seen the note.

---

## Retiring old announcements

Old notes stay in the wiki indefinitely — removing them is harmless (users who already saw them won't see them again regardless), but there's no reason to do so either. Trim the list if it grows unwieldy.
