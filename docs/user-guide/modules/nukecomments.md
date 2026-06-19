# Comment Nuke

**Platforms:** Old Reddit and New Reddit · **Default:** Disabled

Comment Nuke bulk-removes or bulk-locks entire comment chains, useful for dealing with large-scale rule violations or brigading.

## Overview

Comment Nuke adds a "nuke" button next to each comment. Clicking it removes or locks every reply in that comment's chain in one action, without requiring you to act on each comment individually. The action type (remove or lock) is selectable before confirming.

Distinguished comments from moderators and admins are skipped by default.

## Features

**Chain removal** — removes a comment and all its descendants in one action.

**Chain locking** — locks a comment chain instead of removing, preventing further replies.

**Skip distinguished comments** — by default, comments distinguished by mods or admins are left untouched during a nuke.

**Nuke button placement** — the nuke button can appear either next to the username or below the comment body.

## Settings

| Setting                           | Default | Description                                                                             |
| --------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| Ignore distinguished comments     | On      | Skip mod/admin-distinguished comments when nuking                                       |
| Default nuke type                 | Remove  | Whether to remove or lock the chain by default _(advanced)_                             |
| Show nuke button next to username | On      | Place button next to the username instead of below the comment _(old Reddit, advanced)_ |
