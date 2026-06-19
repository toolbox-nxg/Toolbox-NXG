# Training Mode & Second Opinions

**Platforms:** Old Reddit and New Reddit · **Default:** Enabled (no effect until a subreddit opts in)

Training mode lets a subreddit route a moderator's actions into a review queue instead of performing them, so a more experienced moderator can check the work first. The same machinery powers **second opinions**: any moderator can deliberately send a single action on one item for review rather than performing it immediately.

A captured action is called a **proposal**. Proposals are stored in the subreddit wiki and reviewed from the Modbar.

## What it is — and is not

Training mode routes _supported Toolbox-NXG actions_ into review. It is a **workflow guard, not a permission sandbox.** It does **not** block:

- Native Reddit moderation UI (the post/comment mod menus, the mod queue's own buttons).
- The Reddit mobile apps.
- Original Toolbox 6.x.
- Direct calls to the Reddit API.

A trainee who uses any of those paths still acts directly. Because of this, training mode is only meaningful when the whole mod team is on Toolbox-NXG. When a subreddit still writes Toolbox 6.x compatibility pages, the **Training mode** settings tab shows a warning to that effect.

## Enabling trainees

Open the Toolbox-NXG **Config** overlay and go to the **Training mode** tab. It lists every moderator on the subreddit; tick a moderator to put them in training. While in training, that moderator's in-scope actions (approve, remove, removal reasons, ban/unban, mute/unmute, lock/unlock, distinguish, mark NSFW, sticky, user flair) are captured as proposals instead of taking effect.

Below the trainee list, the **Actions to guard** control narrows which kinds of action are captured. By default every supported action is captured; unchecking an action group lets trainees take those actions directly, without review. This is stored as the [`guardedActions`](../../schema/config.md) config field (absent ⇒ all actions guarded; a list narrows to just those types).

The same tab sets **proposal retention** — how many days a resolved proposal is kept before it is pruned (see [Pruning](#pruning)).

Trainee membership is compared case-insensitively and is stored per subreddit, so a moderator can be a trainee in one subreddit and a full moderator in another.

## What a trainee can and cannot do

| Trainee action                                   | Result                                        |
| ------------------------------------------------ | --------------------------------------------- |
| Approve / remove / removal reason                | Captured as a proposal                        |
| Ban / unban / mute / unmute                      | Captured as a proposal                        |
| Lock / unlock                                    | Captured as a proposal                        |
| Distinguish / mark NSFW / sticky                 | Captured as a proposal                        |
| User flair                                       | Captured as a proposal                        |
| Bulk actions (e.g. mass-moderation, bulk remove) | **Blocked** — bulk actions cannot be proposed |
| Reply-as-subreddit macros                        | **Blocked** in training mode                  |

Bulk actions and reply-as-subreddit macros are blocked rather than captured because they don't map cleanly onto the single-target review flow.

## Reviewing proposals

Open the Modbar's **Proposals** drawer. It has two tabs:

- **Review queue** — proposals other moderators have submitted that are waiting on you.
- **My proposals** — proposals you submitted, so you can track their outcome.

Anywhere a proposal exists for an item, an inline 🎓 badge appears showing how many proposals are open for it. Clicking the badge opens the drawer to that item.

For each pending proposal a reviewer can:

- **Accept** — performs the _real_ action (replaying the captured intent) and marks the proposal accepted. If the real action only partly succeeds, the proposal is flagged **needs attention** instead of accepted, with detail on which step failed.
- **Edit & accept** — only for a removal-reason proposal that captured the trainee's reason selection. Re-opens the full removal-reasons overlay pre-filled with what the trainee composed, so you can adjust the reasons or message before sending. Performing the removal from the overlay marks the proposal accepted.
- **Reject** — declines the proposal; you can attach feedback explaining why.
- **Dismiss** — for a proposal you submitted, acknowledges the outcome so it can be pruned.

A trainee can review their own subreddit's queue but cannot Accept (or Edit & accept) there — those buttons are disabled for a moderator who is themselves a trainee in that subreddit.

## Requesting a second opinion

Second opinions don't require training mode. On a post or comment's moderation action row, Toolbox-NXG adds an inline **Second opinion** toggle. Arm it and your **next** moderation action on that item (approve, remove, lock, a removal-reason send, ban, …) is captured as a proposal instead of being performed. The toggle is one-shot — it clears itself once an action is captured — and only appears for moderators of the subreddit while the item has no open proposal yet (once one exists, the inline 🎓 badge takes its place). Use it when you want another moderator to sign off on a borderline call. The proposal appears in the team's review queue exactly like a trainee's, tagged as a second opinion rather than training.

## Pruning

A resolved proposal (accepted, rejected, or obsolete) is kept until either:

- its proposer dismisses it, or
- the subreddit's **proposal retention** window (default 14 days) elapses.

Pending proposals are never pruned. A proposal whose target goes away on its own — the author deleted it, or it was actioned outside the proposal flow — is auto-resolved as **obsolete** without a verdict.

## See also

- [Proposals Schema](../../schema/proposals.md) — the wiki page format and full proposal shape.
- [Subreddit Config Schema](../../schema/config.md) — the `trainingMods`, `guardedActions`, and `proposalRetentionDays` config fields.
