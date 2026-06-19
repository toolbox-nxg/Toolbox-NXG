# Comment Actions

**Platforms:** New Reddit only · **Default:** Enabled

The Comment Actions module recreates the everyday comment controls inside Toolbox-NXG's flat comment row on new Reddit (Shreddit), keeping each comment to a single compact row.

## Overview

This module runs only on the Shreddit UI; on old Reddit the native comment controls already sit alongside Toolbox's buttons, so the module is skipped there.

When enabled, the everyday controls are rebuilt inside the Toolbox row and the native `<shreddit-comment-action-row>` is collapsed by default. The result is one row of controls per comment, which avoids the layout shift (scroll jump) that the native row can cause.

## Features

**Recreated controls** — upvote and downvote buttons (with the score) and the reply button are rebuilt inside the Toolbox flat-list row, so the actions you use most are always one click away.

**Collapsed native row** — the native Shreddit comment action row is hidden by default to keep each comment to a single row.

**Expand toggle** — an Expand (⋯) toggle reveals the native action row inline for the controls Toolbox does not recreate, such as save, award, share, report, and insights.

## Settings

This module has no user-facing settings beyond the enable/disable toggle.
