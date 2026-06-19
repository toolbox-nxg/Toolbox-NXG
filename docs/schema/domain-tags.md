# Domain Tags Schema

Domain tags let moderators color-code links by domain so the source of a submission is visible at a glance. Each subreddit's tags are stored on a dedicated wiki page separate from the main config, giving cleaner audit history when tags are added or updated.

| Wiki page (NXG layout)    | Classic layout                                   |
| ------------------------- | ------------------------------------------------ |
| `toolbox-nxg/domain-tags` | _(embedded in `toolbox` config as `domainTags`)_ |

The page is restricted to moderator-only access (`permlevel: 2`).

## Migration from config

Older builds stored domain tags inside the main subreddit config as `domainTags: DomainTag[]` on the `toolbox-nxg` page. On the first read of the dedicated domain-tags page, NXG automatically migrates any tags found there:

1. Reads `ToolboxConfig.domainTags` from the existing config.
2. Creates a new `toolbox-nxg/domain-tags` page seeded with those tags (`approvalCount: 0`, `removalCount: 0`).
3. Removes `domainTags` from the config page and saves.

After migration the `domainTags` field is absent from the config page permanently.

## Schema reference

### Top-level page object (`DomainTagsData`)

```json
{
    "ver": 1,
    "showCounts": false,
    "tags": [ ... ]
}
```

| Field        | Type          | Description                                                                            |
| ------------ | ------------- | -------------------------------------------------------------------------------------- |
| `ver`        | integer       | Schema version; currently `1`                                                          |
| `showCounts` | boolean       | When `true`, approval/removal counts are shown inline in the domain indicator on posts |
| `tags`       | `DomainTag[]` | The list of domain tag entries for this subreddit                                      |

### `DomainTag`

```json
{
    "name": "*.blogspot.com",
    "color": "#ff6600",
    "note": "Blog network; check individually",
    "approvalCount": 12,
    "removalCount": 47,
    "removalThreshold": 70
}
```

| Field              | Required | Type    | Description                                                                                                                                                                    |
| ------------------ | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`             | yes      | string  | Domain pattern to match (see [Pattern matching](#pattern-matching))                                                                                                            |
| `color`            | yes      | string  | CSS color applied to the indicator, e.g. `#ff0000` or `red`. Use `"none"` to mark a domain as explicitly untagged.                                                             |
| `note`             | no       | string  | Optional free-text note displayed in the tag popup and as a tooltip on the indicator                                                                                           |
| `approvalCount`    | yes      | integer | Cumulative number of approvals of posts from this domain in this subreddit; `0` when none recorded                                                                             |
| `removalCount`     | yes      | integer | Cumulative number of removals of posts from this domain in this subreddit; `0` when none recorded                                                                              |
| `removalThreshold` | no       | integer | Removal-rate alert threshold (0–100). When `removalCount / (approvalCount + removalCount) ≥ threshold / 100`, the indicator switches to a warning color regardless of `color`. |

```{note}
`approvalCount` and `removalCount` are managed entirely by the extension. External tools that round-trip this page should preserve the existing values unchanged rather than resetting them to `0`.
```

## Pattern matching

The `name` field on a `DomainTag` is matched against the domain of an incoming post URL. Three matching strategies are tried in priority order:

1. **Exact** — `name` matches the domain exactly, e.g. `i.imgur.com`.
2. **Glob** — `name` contains `*`, which matches any sequence of characters, e.g. `*.blogspot.com` matches `foo.blogspot.com` but not `blogspot.net`.
3. **Suffix** — `name` without `*` is checked as a domain suffix, e.g. `imgur.com` matches `i.imgur.com` and `m.imgur.com`.

The first matching tag wins. To prevent a suffix match from firing on a specific subdomain, add a more-specific exact-match entry for that subdomain.

## Approval/removal tracking

Whenever a moderator approves or removes a post, the extension looks up the post's domain against the subreddit's tag list and increments the matching tag's `approvalCount` or `removalCount`. Writes are queued (one write per subreddit at a time) to avoid concurrent edit conflicts on the wiki page.

The counts are never reset automatically. They can be cleared manually by editing the wiki page directly, or the field can simply be set back to `0`.

## Alert threshold

When a tag has `removalThreshold` set, the indicator color changes to a warning orange (`#ff6600`) whenever the removal rate meets or exceeds the threshold:

```
removalCount / (approvalCount + removalCount) >= removalThreshold / 100
```

The threshold has no effect when both counts are `0`.

## Versioning

`ver` selects the schema version. The only currently defined version is `1`. Future schema changes will bump this value and may add a migration step in the codec.

## Interoperability notes

**Preserve unknown fields.** If your tool reads and writes this page, carry forward any fields it does not recognize so that future schema additions survive the round-trip.

**Do not write `approvalCount` / `removalCount` from external tools.** These fields reflect in-extension mod activity and are managed exclusively by the extension. Overwriting them with computed or estimated values may produce misleading indicator behavior.

**Import strips counts.** When a moderator imports tags from another subreddit using the toolbox settings UI, only `name`, `color`, and `note` are carried over. Counts start at `0` in the destination subreddit.
