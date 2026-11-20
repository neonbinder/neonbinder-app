---
name: insert-vs-parallel-views-and-unchanged-regenerate
description: Set builder - re-picking a selected insert keeps its parallel picked (use Back); prove a Regenerate that leaves the title unchanged through the live "Title built from" chips
metadata:
  type: reference
---

**Insert view after a parallel was picked.** Clicking the insert's selection card
and picking the insert again does NOT clear the Parallels pick: the panel stays on
`Attributes for <parallel> (Parallel)`. The drill is in the URL (`useDrillUrlState`,
`&parallel=<id>`) and every pick is a push, so `page.goBack()` is the way back to the
insert's own checklist and panel; assert `not.toHaveURL(/[?&]parallel=/)` plus the
`Attributes for <insert> (Insert)` heading. It also satisfies the "Back steps through
the views" house rule. Used by `insert-switch-parallels-name-themselves` (NEO-619).

**A Regenerate that changes nothing proves nothing by the field.** When the
regenerated title equals the stored one, the commit no-ops and no
`Saved Card title` is announced, and `toHaveValue` passes before the press. Prove the
generator's answer through the drawer's `list "Title built from"` chips instead:
since NEO-535 they are a LIVE query of the card's current facts (one chip per title
level, labelled with its type name, e.g. "Insert <row>", "Parallel <row>"), so they
follow a switch or rename before any press. Pair a dropped level's
`toHaveCount(0)` chip with the other level's chip visible (R2). For a title that does
change, wait on `drawer.getByText(/Saved Card title/).first()`.

**Server-side plant without touching the shared worktree:** `git archive HEAD apps/web`
into a scratch dir, symlink node_modules, copy `.env.local`, plant, `npx convex dev
--once` there (check its exit code), run the spec from the worktree, restore with a
`cmp` against the worktree file and push again. See [[reference_planted_break_on_convex_code]].
