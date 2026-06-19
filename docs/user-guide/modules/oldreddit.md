# Old Reddit

**Platforms:** Old Reddit only · **Always on**

The Old Reddit module is the old-Reddit counterpart to the [Shreddit](shreddit.md) module. It is the foundation that every other old-Reddit module builds on, and it activates automatically whenever Toolbox-NXG detects that you are on `old.reddit.com`.

## Overview

Toolbox-NXG renders its buttons and overlays into a set of named UI "location slots" — for example, the action area under each post and comment, or the controls beside each username. The Old Reddit module is responsible for finding those anchor points in the old-Reddit page and registering the slots, so that the other modules have somewhere to render.

Because old Reddit adds content to the page over time (as you scroll, and especially with Reddit Enhancement Suite's never-ending reddit / infinite scroll), the module also watches for newly added posts, comments, and user lists and wires Toolbox into them as they appear. On first load it makes an initial pass over whatever is already on the page.

This is core infrastructure that the rest of Toolbox-NXG depends on, so it is always on and cannot be disabled. It has no user-facing settings.
